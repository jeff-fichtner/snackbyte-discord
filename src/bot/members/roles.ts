/**
 * Self-service role capabilities — the logic behind the /role and /roles commands, kept
 * independent of any interaction style. A capability takes plain views (not a live discord.js
 * interaction) and returns a structured outcome; the command modules adapt a slash interaction
 * onto it, and a future button/reaction style can reuse the same logic unchanged.
 *
 * The authorization gate lives here and runs before any mutation: a role must be on the guild's
 * operator-curated whitelist, and the bot must be positioned above it and hold Manage Roles.
 * The whitelist is the whole authorization — no entry means the role is not self-assignable.
 */

/** The minimal role facts the capability needs (a live discord.js Role maps onto this). */
export interface RoleView {
  id: string;
  name: string;
  position: number;
}

/** The minimal member surface the capability acts on (a live GuildMember maps onto this). */
export interface MemberView {
  hasRole(roleId: string): boolean;
  addRole(roleId: string): Promise<void>;
  removeRole(roleId: string): Promise<void>;
  /** Position of the bot's own highest role in this guild. */
  botHighestPosition: number;
  /** Whether the bot holds the Manage Roles permission in this guild. */
  botCanManageRoles: boolean;
}

export type RoleOutcome =
  | { outcome: 'added' | 'removed' }
  | { outcome: 'refused'; reason: 'not-whitelisted' | 'bot-cannot-manage' | 'role-not-found' };

/**
 * Toggle a self-assignable role on the invoking member: add if absent, remove if present.
 * Acts only on the member passed in (self-only is structural — no other member is reachable).
 * Returns a structured outcome; never throws for an expected failure.
 */
export async function toggleSelfRole(
  member: MemberView,
  role: RoleView,
  whitelistRoleIds: string[],
): Promise<RoleOutcome> {
  // Gate 1 — the whitelist is the whole authorization.
  if (!whitelistRoleIds.includes(role.id)) {
    return { outcome: 'refused', reason: 'not-whitelisted' };
  }
  // Gate 2 — the bot must be able to manage the role (above it, and holding Manage Roles).
  if (!member.botCanManageRoles || role.position >= member.botHighestPosition) {
    return { outcome: 'refused', reason: 'bot-cannot-manage' };
  }
  // Toggle. A mutation failure (e.g. the role was deleted between the gate and the call) is a
  // clean refusal, never a throw to the caller.
  try {
    if (member.hasRole(role.id)) {
      await member.removeRole(role.id);
      return { outcome: 'removed' };
    }
    await member.addRole(role.id);
    return { outcome: 'added' };
  } catch {
    return { outcome: 'refused', reason: 'role-not-found' };
  }
}

/**
 * Resolve the guild's whitelisted role ids to the live roles that still exist, for display.
 * Ids with no matching live role (a deleted role left in the whitelist) are omitted, so a stale
 * entry never shows up as a broken listing.
 */
export function listSelfAssignableRoles(
  liveRoles: RoleView[],
  whitelistRoleIds: string[],
): RoleView[] {
  const allowed = new Set(whitelistRoleIds);
  return liveRoles.filter((r) => allowed.has(r.id));
}
