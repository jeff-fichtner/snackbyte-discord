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
  | { outcome: 'added' | 'removed' | 'unchanged' }
  | { outcome: 'refused'; reason: 'not-whitelisted' | 'bot-cannot-manage' | 'role-not-found' };

/**
 * The self-service authorization gate: a self-assignable role must be on the guild's whitelist AND
 * the bot must be positioned above it and hold Manage Roles. Returns a refusal outcome when a gate
 * fails, or null when both gates pass. Shared by every self-service entry point (toggle from the
 * command, grant/revoke from a reaction) so the two paths cannot drift.
 */
function selfRoleGate(
  member: MemberView,
  role: RoleView,
  whitelistRoleIds: string[],
): RoleOutcome | null {
  // Gate 1 — the whitelist is the whole authorization.
  if (!whitelistRoleIds.includes(role.id)) {
    return { outcome: 'refused', reason: 'not-whitelisted' };
  }
  // Gate 2 — the bot must be able to manage the role (above it, and holding Manage Roles).
  if (!member.botCanManageRoles || role.position >= member.botHighestPosition) {
    return { outcome: 'refused', reason: 'bot-cannot-manage' };
  }
  return null;
}

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
  const refused = selfRoleGate(member, role, whitelistRoleIds);
  if (refused) return refused;
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
 * Grant a self-assignable role to the member (the reaction-add path). Directed, not a toggle: a
 * repeated grant on a role the member already has is a no-op ('unchanged'), never a toggle-off — the
 * reaction state, not the prior membership, is authoritative. Shares the whitelist + bot-position
 * gate with toggleSelfRole so a reaction honors the whitelist exactly as the command does.
 */
export async function grantSelfRole(
  member: MemberView,
  role: RoleView,
  whitelistRoleIds: string[],
): Promise<RoleOutcome> {
  const refused = selfRoleGate(member, role, whitelistRoleIds);
  if (refused) return refused;
  if (member.hasRole(role.id)) return { outcome: 'unchanged' };
  try {
    await member.addRole(role.id);
    return { outcome: 'added' };
  } catch {
    return { outcome: 'refused', reason: 'role-not-found' };
  }
}

/**
 * Revoke a self-assignable role from the member (the reaction-remove path). Directed: a revoke on a
 * role the member does not have is a no-op ('unchanged'). Removal is unconditional with respect to
 * how the member obtained the role — the reaction is the source of truth (no provenance tracked).
 * Shares the same gate as grant/toggle.
 */
export async function revokeSelfRole(
  member: MemberView,
  role: RoleView,
  whitelistRoleIds: string[],
): Promise<RoleOutcome> {
  const refused = selfRoleGate(member, role, whitelistRoleIds);
  if (refused) return refused;
  if (!member.hasRole(role.id)) return { outcome: 'unchanged' };
  try {
    await member.removeRole(role.id);
    return { outcome: 'removed' };
  } catch {
    return { outcome: 'refused', reason: 'role-not-found' };
  }
}

export type MemberRoleOutcome =
  | { outcome: 'added' | 'removed' }
  | {
      outcome: 'refused';
      reason: 'bot-cannot-manage' | 'invoker-outranked' | 'role-not-found';
    };

/**
 * Toggle a role on ANOTHER member (the moderation path). Unlike the self-service path this is NOT
 * whitelist-bound — a moderator manages roles a member could not self-assign. Two guards still apply:
 *
 *  - the bot-position guard (add AND remove): the bot must be above the role and hold Manage Roles;
 *  - the invoker-position guard (GRANT only): the role must be below the invoking moderator's own
 *    highest role. Manage Roles permission does not let a user assign a role above their own highest
 *    role, so enforcing only the bot guard would let a moderator hand out a role they could not
 *    assign in the Discord UI — an escalation path. It does NOT apply to removal, which is
 *    de-escalation (a moderator may strip a role above their own position).
 *
 * The caller checks moderator standing before invoking this. Never throws for an expected failure.
 */
export async function setMemberRole(
  member: MemberView,
  role: RoleView,
  opts: { invokerHighestPosition: number },
): Promise<MemberRoleOutcome> {
  // Bot-position guard — the bot must be able to manage the role (applies to add AND remove).
  if (!member.botCanManageRoles || role.position >= member.botHighestPosition) {
    return { outcome: 'refused', reason: 'bot-cannot-manage' };
  }
  try {
    if (member.hasRole(role.id)) {
      // Removal is de-escalation — the invoker-position guard does NOT apply. A moderator may
      // strip a role at/above their own highest role (e.g. one an admin mistakenly granted); the
      // bot-position guard above is the only ceiling on removal.
      await member.removeRole(role.id);
      return { outcome: 'removed' };
    }
    // Invoker-position guard — a moderator may not GRANT a role at/above their own highest role.
    // Manage Roles permission does not let a user assign a role above their own highest role, so
    // this closes the escalation path the bot-position guard alone would leave open. It gates only
    // the grant path (a remove is de-escalation, guarded above).
    if (role.position >= opts.invokerHighestPosition) {
      return { outcome: 'refused', reason: 'invoker-outranked' };
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
