/**
 * The discord.js gateway client.
 *
 * Intents follow least privilege: only what the registered handlers need — Guilds (slash
 * interactions), GuildMembers (observe member-join, resolve members for role/nickname management),
 * and GuildMessageReactions (reaction-roles: grant/remove a role when a member reacts). The
 * Message and Reaction partials let a reaction on a message the bot has not cached this session
 * (an older message, or after a restart) still be resolved — the event carries the message id and
 * emoji without the full cached message.
 *
 * The privileged Message Content intent is deliberately NOT requested: nothing reads message text
 * (reactions carry the emoji and message id; moderation reads command options), and the bot must
 * boot and function without it. discord.js handles gateway reconnection itself.
 */
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createBotClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction],
  });
}
