/**
 * Unified bootstrap — the single process entrypoint (the container CMD).
 *
 * Starts both faces of the hub in one Node process: the Express webhook router/HTTP
 * server and the discord.js gateway bot. Liveness must not depend on downstream health,
 * so the HTTP server ALWAYS starts first; the database and the bot are wired only when
 * their config is present, and any failure is logged and reflected in readiness — never
 * fatal. This is what lets the service deploy and stay live before its secrets are set.
 */
import { createApp } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './core/logger.js';
import {
  installShutdownHandlers,
  onShutdown,
  setDbReachable,
  setGatewayConnected,
} from './core/lifecycle.js';
import { setContext } from './core/context.js';
import { createPool } from './db/client.js';
import { PgRepository } from './db/pg-repository.js';
import { DiscordDeliveryService } from './discord/delivery.js';
import { createBotRest } from './discord/rest.js';
import { createBotClient } from './bot/client.js';
import { bindHandlers } from './bot/events/registry.js';
import { Events } from 'discord.js';

// Side-effect imports: register every source adapter, named transform, slash command, and
// event handler.
import './sources/index.js';
import './routing/transforms/index.js';
import './bot/commands/index.js';
import './bot/events/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  installShutdownHandlers();

  // 1) HTTP server first — liveness comes up regardless of downstream state or secrets.
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'http server listening');
  });
  onShutdown(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // 2) Database + delivery (only if configured). Wires the runtime context so inbound
  //    webhooks can be processed; absence/failure leaves readiness "db down", not fatal.
  //    The bot REST client (for mode='bot' targets) is built from the bot token when present;
  //    without it, webhook delivery still works and bot deliveries fail with a clear reason.
  const delivery = new DiscordDeliveryService(
    config.discordBotToken ? createBotRest(config.discordBotToken) : undefined,
  );
  if (config.databaseUrl) {
    try {
      const pool = createPool(config.databaseUrl);
      const repo = new PgRepository(pool);
      setContext({ repo, delivery });
      onShutdown(() => repo.close());
      const reachable = await repo.ping();
      setDbReachable(reachable);
      logger.info({ reachable }, 'database initialized');
    } catch (err) {
      setDbReachable(false);
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'database init failed',
      );
    }
  } else {
    logger.warn('DATABASE_URL not set — inbound webhooks will return 503 until configured');
  }

  // 3) Bot login (only if a token is configured). discord.js auto-reconnects; a login
  //    failure is logged, not fatal — the HTTP face stays up.
  if (config.discordBotToken) {
    try {
      const client = createBotClient();
      client.once(Events.ClientReady, (c) => {
        setGatewayConnected(true);
        logger.info({ user: c.user.tag }, 'bot ready');
      });
      client.on(Events.ShardDisconnect, () => setGatewayConnected(false));
      client.on(Events.ShardResume, () => setGatewayConnected(true));
      bindHandlers(client);
      onShutdown(() => client.destroy());
      await client.login(config.discordBotToken);
    } catch (err) {
      setGatewayConnected(false);
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'bot login failed');
    }
  } else {
    logger.warn('DISCORD_BOT_TOKEN not set — bot is offline until configured');
  }
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'bootstrap failed');
  process.exit(1);
});
