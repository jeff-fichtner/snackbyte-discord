/**
 * Moderator standing — whether an invoker may act on ANOTHER member. Standing is the invoker's
 * NATIVE platform permission for the capability being exercised: Manage Nicknames gates cross-member
 * nickname changes, Manage Roles gates cross-member role changes. Evaluated per invocation from the
 * invoker's live permissions, so revoking the permission takes effect on the next command — there is
 * no separate moderator-role store.
 *
 * Pure over a minimal permission view (a live GuildMember's permissions map onto it), so the gate is
 * unit-testable with plain objects, like the role/nickname capability.
 */
import { PermissionFlagsBits } from 'discord.js';

/**
 * The moderation capabilities and the native permission each requires. `nickname`/`role` gate the
 * cross-member role/nickname commands (005); the sanction/channel/message capabilities gate the
 * moderation commands (006). `unlock` reuses `lock` and `unpin` reuses `pin` — they are the same
 * native permission, so no separate keys exist for them.
 */
export type ModeratedCapability =
  | 'nickname'
  | 'role'
  | 'timeout'
  | 'kick'
  | 'ban'
  | 'purge'
  | 'pin'
  | 'slowmode'
  | 'lock';

const REQUIRED_PERMISSION: Record<ModeratedCapability, bigint> = {
  nickname: PermissionFlagsBits.ManageNicknames,
  role: PermissionFlagsBits.ManageRoles,
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  purge: PermissionFlagsBits.ManageMessages,
  pin: PermissionFlagsBits.ManageMessages,
  slowmode: PermissionFlagsBits.ManageChannels,
  lock: PermissionFlagsBits.ManageChannels,
};

/** The minimal permission surface the standing check needs (a GuildMember's permissions map on). */
export interface PermissionView {
  has(permission: bigint): boolean;
}

/**
 * True if the invoker holds the native permission for `capability`, i.e. may act on other members.
 */
export function isModerator(view: PermissionView, capability: ModeratedCapability): boolean {
  return view.has(REQUIRED_PERMISSION[capability]);
}
