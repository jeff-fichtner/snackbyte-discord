/**
 * The shared member-hierarchy guard for cross-member moderation — the check that runs before any
 * sanction (timeout / kick / ban) or cross-member role change mutates a target. Two rules, both
 * mirroring the platform's own:
 *
 *  - bot-position: the bot must hold the required permission AND outrank the target (the target's
 *    highest role below the bot's highest role);
 *  - invoker-position: the target must be below the invoking moderator's own highest role — Manage-*
 *    permissions do not let a moderator act on someone at or above their own top role, so enforcing
 *    only the bot guard would let a moderator act beyond what the platform UI allows (an escalation).
 *
 * Pure over minimal position/flag views, so it is unit-testable with plain objects. Returns a refusal
 * reason when a rule fails, or null when both pass.
 */

/** The minimal target view the guard needs (a live GuildMember + guild context map onto this). */
export interface HierarchyView {
  /** The bot holds the native permission required for this action in this guild. */
  botHasPermission: boolean;
  /** The bot's own highest role position. */
  botHighestPosition: number;
  /** The target member's highest role position. */
  targetHighestPosition: number;
  /** The invoking moderator's own highest role position. */
  invokerHighestPosition: number;
}

export type HierarchyRefusal = 'bot-cannot-manage' | 'invoker-outranked';

/**
 * Check the hierarchy guards. Returns a refusal reason, or null when the action may proceed.
 */
export function checkHierarchy(view: HierarchyView): HierarchyRefusal | null {
  // Bot-position — the bot must be able to manage the target at all.
  if (!view.botHasPermission || view.targetHighestPosition >= view.botHighestPosition) {
    return 'bot-cannot-manage';
  }
  // Invoker-position — a moderator may not act on someone at/above their own highest role.
  if (view.targetHighestPosition >= view.invokerHighestPosition) {
    return 'invoker-outranked';
  }
  return null;
}
