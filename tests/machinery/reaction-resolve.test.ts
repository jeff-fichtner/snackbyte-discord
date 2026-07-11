// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveReactionRole } from '../../src/bot/reactions/resolve.js';
import type { ReactionRoleMapping } from '../../src/db/repository.js';

// The resolver is pure: it decides which role a reaction acts on from the guild's mappings + the
// whitelist, with no discord.js. Authorization is the intersection — a mapping AND a whitelist entry.

function mapping(over: Partial<ReactionRoleMapping> = {}): ReactionRoleMapping {
  return { messageId: 'm1', emojiKey: '🔔', roleId: 'r1', ...over };
}

describe('resolveReactionRole — mapping + whitelist intersection', () => {
  it('resolves a mapped, whitelisted reaction to its role id', () => {
    const roleId = resolveReactionRole({
      mappings: [mapping()],
      whitelistRoleIds: ['r1'],
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: false,
    });
    expect(roleId).toBe('r1');
  });

  it('returns null for a mapped role that is NOT whitelisted (mapping never bypasses whitelist)', () => {
    const roleId = resolveReactionRole({
      mappings: [mapping({ roleId: 'r9' })],
      whitelistRoleIds: ['r1'], // r9 not whitelisted
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: false,
    });
    expect(roleId).toBeNull();
  });

  it('returns null when no mapping matches the message', () => {
    const roleId = resolveReactionRole({
      mappings: [mapping({ messageId: 'other' })],
      whitelistRoleIds: ['r1'],
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: false,
    });
    expect(roleId).toBeNull();
  });

  it('returns null when the emoji is not the mapped one (unmapped emoji ignored)', () => {
    const roleId = resolveReactionRole({
      mappings: [mapping({ emojiKey: '🔔' })],
      whitelistRoleIds: ['r1'],
      messageId: 'm1',
      emojiKey: '🎉', // different emoji
      reactorIsBot: false,
    });
    expect(roleId).toBeNull();
  });

  it("returns null for the bot's own reaction", () => {
    const roleId = resolveReactionRole({
      mappings: [mapping()],
      whitelistRoleIds: ['r1'],
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: true,
    });
    expect(roleId).toBeNull();
  });
});

describe('resolveReactionRole — emoji identity (unicode + custom)', () => {
  it('matches a unicode emoji by its codepoint key', () => {
    const roleId = resolveReactionRole({
      mappings: [mapping({ emojiKey: '🔔', roleId: 'bell' })],
      whitelistRoleIds: ['bell'],
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: false,
    });
    expect(roleId).toBe('bell');
  });

  it('matches a custom emoji by its numeric id key (rename-safe)', () => {
    // A custom emoji is stored/matched by its id, not its (mutable) name.
    const roleId = resolveReactionRole({
      mappings: [mapping({ emojiKey: '123456789012345678', roleId: 'party' })],
      whitelistRoleIds: ['party'],
      messageId: 'm1',
      emojiKey: '123456789012345678',
      reactorIsBot: false,
    });
    expect(roleId).toBe('party');
  });

  it('does not confuse a custom emoji id with a unicode key', () => {
    const roleId = resolveReactionRole({
      mappings: [mapping({ emojiKey: '123456789012345678', roleId: 'party' })],
      whitelistRoleIds: ['party'],
      messageId: 'm1',
      emojiKey: '🔔', // unicode, not the custom id
      reactorIsBot: false,
    });
    expect(roleId).toBeNull();
  });
});

describe('resolveReactionRole — operator config is data-driven (US2)', () => {
  it('the SAME reaction resolves with a mapping present and null with it absent', () => {
    const input = {
      whitelistRoleIds: ['r1'],
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: false,
    };
    expect(resolveReactionRole({ ...input, mappings: [mapping()] })).toBe('r1');
    expect(resolveReactionRole({ ...input, mappings: [] })).toBeNull();
  });

  it('resolves to at most one role for a (message, emoji) — a single lookup', () => {
    // The store's PK guarantees one row per (message, emoji); the resolver returns that one role.
    const roleId = resolveReactionRole({
      mappings: [mapping({ roleId: 'only' })],
      whitelistRoleIds: ['only'],
      messageId: 'm1',
      emojiKey: '🔔',
      reactorIsBot: false,
    });
    expect(roleId).toBe('only');
  });
});
