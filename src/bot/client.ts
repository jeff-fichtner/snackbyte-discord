/**
 * The discord.js gateway client.
 *
 * Intents follow least privilege: only what the registered handlers need — Guilds (slash
 * interactions + components), GuildMembers (observe member-join, resolve members for role/nickname
 * and moderation), and GuildMessageReactions (reaction-roles). The Message and Reaction partials let
 * a reaction on a message the bot has not cached this session still be resolved.
 *
 * The privileged Message Content intent is requested ONLY when the text-prefix style is enabled
 * (a process-wide opt-in, off by default). With it off — the default — the bot boots and every other
 * style (slash, reaction, components) works without it; nothing else reads message text (reactions
 * carry the emoji + message id; moderation reads command options). discord.js handles reconnection.
 */
import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Build the gateway client. `textPrefixEnabled` (from config) is the one lever that adds the
 * privileged Message Content intent — when false (default), it is not requested at all.
 */
export function createBotClient(opts: { textPrefixEnabled?: boolean } = {}): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ];
  if (opts.textPrefixEnabled) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  return new Client({
    intents,
    partials: [Partials.Message, Partials.Reaction],
  });
}
