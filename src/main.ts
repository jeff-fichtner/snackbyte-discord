/**
 * Unified bootstrap — the single process entrypoint (the container CMD).
 *
 * Starts both faces of the hub in one Node process: the Express webhook router/HTTP
 * server and the discord.js gateway bot. Liveness must not depend on downstream health,
 * so the HTTP server always starts; the database and the bot login are attempted and
 * their failures are logged and reflected in readiness, not fatal to the process.
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
import { WebhookDeliveryService } from './discord/delivery.js';
import { createBotClient } from './bot/client.js';
import { bindHandlers } from './bot/events/registry.js';
import { Events } from 'discord.js';

// Side-effect imports: register every source adapter, slash command, and event handler.
import './sources/index.js';
import './bot/commands/index.js';
import './bot/events/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  installShutdownHandlers();

  // HTTP server first — liveness comes up regardless of downstream state.
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'http server listening');
  });
  onShutdown(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // Database + delivery: wire the runtime context so inbound webhooks can be processed.
  // A failure here is logged and leaves readiness "db down"; the process stays alive.
  const delivery = new WebhookDeliveryService();
  try {
    const pool = createPool(config.databaseUrl);
    const repo = new PgRepository(pool);
    setContext({ repo, delivery });
    onShutdown(() => repo.close());
    setDbReachable(await repo.ping());
    logger.info('database connected');
  } catch (err) {
    setDbReachable(false);
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'database init failed');
  }

  // Bot login. discord.js auto-reconnects; a login failure is logged, not fatal.
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
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'bootstrap failed');
  process.exit(1);
});
