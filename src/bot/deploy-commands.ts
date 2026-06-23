/**
 * Registers the bot's slash-command definitions with Discord. Run via tsx:
 *
 *   npm run deploy:commands
 *
 * Guild-scoped when DISCORD_DEV_GUILD_ID is set (instant updates — use in dev); global
 * otherwise (production reach; up to ~1h to propagate). Separate from the running bot,
 * which only dispatches commands; this is how their definitions reach Discord.
 */
import { REST, Routes } from 'discord.js';
import { allCommands } from './commands/registry.js';
// Side effect: register every command into the registry.
import './commands/index.js';

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_DEV_GUILD_ID;

if (!token || !appId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_APP_ID (see .env.example) before running.');
  process.exit(1);
}

const body = allCommands().map((c) => c.data.toJSON());
const rest = new REST({ version: '10' }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(appId, guildId)
  : Routes.applicationCommands(appId);

await rest.put(route, { body });
console.log(
  `Registered ${body.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}.`,
);
