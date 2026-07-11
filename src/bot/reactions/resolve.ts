/**
 * Reaction-role resolution — the pure logic that decides which role (if any) a reaction should act
 * on, independent of discord.js. The reaction event handler adapts a live reaction onto this and
 * onto the role capability's grant/revoke; a button/select style could reuse the same resolution.
 *
 * A reaction resolves to a role ONLY when all hold: the reactor is not the bot; an operator mapping
 * binds this (message, emoji) to a role; and that role is on the guild's self-assignable whitelist.
 * The mapping is additive configuration — the whitelist is the authorization, so a mapping can never
 * grant a role an operator has not whitelisted. Any miss returns null (a silent no-op).
 */
import type { ReactionRoleMapping } from '../../db/repository.js';

export interface ReactionResolveInput {
  /** The guild's reaction-role mappings (read live per reaction). */
  mappings: ReactionRoleMapping[];
  /** The guild's self-assignable-role whitelist (the authorization). */
  whitelistRoleIds: string[];
  /** The message the reaction is on. */
  messageId: string;
  /** The emoji's stable identity: a custom emoji's id, or a unicode emoji's codepoint string. */
  emojiKey: string;
  /** Whether the reacting user is the bot itself (its own reactions never grant roles). */
  reactorIsBot: boolean;
}

/**
 * Resolve a reaction to the role id it should grant/revoke, or null to ignore it. Pure — no I/O.
 */
export function resolveReactionRole(input: ReactionResolveInput): string | null {
  // The bot's own reactions (e.g. seeding an emoji on a mapping message) never grant roles.
  if (input.reactorIsBot) return null;
  // One (message, emoji) maps to at most one role — a single lookup, not a fan-out.
  const mapping = input.mappings.find(
    (m) => m.messageId === input.messageId && m.emojiKey === input.emojiKey,
  );
  if (!mapping) return null;
  // The whitelist is the whole authorization: a mapping to a non-whitelisted role is a no-op, and
  // the system never auto-adds the role to the whitelist.
  if (!input.whitelistRoleIds.includes(mapping.roleId)) return null;
  return mapping.roleId;
}
