// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GatewayIntentBits, IntentsBitField } from 'discord.js';
import { createBotClient } from '../../src/bot/client.js';

// Least-privilege guard: role/nickname management (and everything the bot does) needs only the
// Guilds + GuildMembers intents. Message Content is privileged and MUST stay off — the bot boots
// and functions without it. This asserts no intent creep beyond those two.

describe('bot client intents — least privilege, no Message Content', () => {
  it('requests exactly Guilds + GuildMembers', () => {
    const client = createBotClient();
    const intents = new IntentsBitField(client.options.intents);
    expect(intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(intents.has(GatewayIntentBits.GuildMembers)).toBe(true);
  });

  it('does NOT request the privileged Message Content intent', () => {
    const client = createBotClient();
    const intents = new IntentsBitField(client.options.intents);
    expect(intents.has(GatewayIntentBits.MessageContent)).toBe(false);
  });

  it('requests no intents beyond Guilds + GuildMembers', () => {
    const client = createBotClient();
    const intents = new IntentsBitField(client.options.intents);
    const expected = new IntentsBitField([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ]);
    expect(intents.bitfield).toBe(expected.bitfield);
  });
});
