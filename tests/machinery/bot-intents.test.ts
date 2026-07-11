// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GatewayIntentBits, IntentsBitField, Partials } from 'discord.js';
import { createBotClient } from '../../src/bot/client.js';

// Least-privilege guard: the bot needs Guilds + GuildMembers (slash + member management) and
// GuildMessageReactions (reaction-roles). Reactions on un-cached messages need the Message and
// Reaction partials. Message Content is privileged and MUST stay off — the bot boots and functions
// without it (reactions carry the emoji + message id; moderation reads command options, not text).
// This asserts exactly those intents/partials and no creep to Message Content.

describe('bot client intents — least privilege, no Message Content', () => {
  it('requests Guilds + GuildMembers + GuildMessageReactions', () => {
    const client = createBotClient();
    const intents = new IntentsBitField(client.options.intents);
    expect(intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(intents.has(GatewayIntentBits.GuildMembers)).toBe(true);
    expect(intents.has(GatewayIntentBits.GuildMessageReactions)).toBe(true);
  });

  it('does NOT request the privileged Message Content intent', () => {
    const client = createBotClient();
    const intents = new IntentsBitField(client.options.intents);
    expect(intents.has(GatewayIntentBits.MessageContent)).toBe(false);
  });

  it('requests no intents beyond Guilds + GuildMembers + GuildMessageReactions', () => {
    const client = createBotClient();
    const intents = new IntentsBitField(client.options.intents);
    const expected = new IntentsBitField([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ]);
    expect(intents.bitfield).toBe(expected.bitfield);
  });

  it('enables the Message + Reaction partials (reactions on un-cached messages resolve)', () => {
    const client = createBotClient();
    expect(client.options.partials).toContain(Partials.Message);
    expect(client.options.partials).toContain(Partials.Reaction);
  });
});
