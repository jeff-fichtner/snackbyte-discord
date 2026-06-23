/**
 * The discord.js gateway client.
 *
 * Intents follow least privilege: only what the registered handlers need — Guilds (slash
 * interactions) and GuildMembers (observe member-join). The privileged Message Content
 * intent is deliberately NOT requested; nothing in this slice reads message text, and the
 * bot must boot and function without it. discord.js handles gateway reconnection itself.
 */
import { Client, GatewayIntentBits } from 'discord.js';

export function createBotClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
}
