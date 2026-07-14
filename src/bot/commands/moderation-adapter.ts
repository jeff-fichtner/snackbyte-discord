/**
 * Shared adapters mapping a live discord.js interaction onto the sanction capabilities. Keeps the
 * sanction command modules (timeout/kick/ban) thin and consistent: build the member/guild view,
 * parse a duration, and render a structured outcome as an ephemeral reply.
 */
import { PermissionFlagsBits, type GuildMember, type Guild } from 'discord.js';
import type { SanctionMemberView, GuildBanView, BanEntry } from '../moderation/sanctions.js';

/**
 * Build the sanction view for a target member. Positions come from the live guild; `botHasPermission`
 * is the specific native permission the action needs (passed by the command). `invoker` is the
 * moderator running the command (for the invoker-position guard).
 */
export function sanctionMemberView(
  target: GuildMember,
  invoker: GuildMember,
  botPermission: bigint,
): SanctionMemberView {
  const me = target.guild.members.me;
  return {
    isSelf: target.id === invoker.id,
    isBot: target.id === target.guild.members.me?.id,
    botHasPermission: me?.permissions.has(botPermission) ?? false,
    botHighestPosition: me?.roles.highest.position ?? 0,
    targetHighestPosition: target.roles.highest.position,
    invokerHighestPosition: invoker.roles.highest.position,
    timeout: async (ms, reason) => {
      await target.timeout(ms, reason);
    },
    kick: async (reason) => {
      await target.kick(reason);
    },
    ban: async ({ reason, deleteMessageSeconds }) => {
      await target.ban({ reason, deleteMessageSeconds });
    },
  };
}

/** Build the guild ban-list view from a live Guild. */
export function guildBanView(guild: Guild): GuildBanView {
  return {
    banUser: async (userId, { reason, deleteMessageSeconds }) => {
      await guild.bans.create(userId, { reason, deleteMessageSeconds });
    },
    unbanUser: async (userId, reason) => {
      await guild.bans.remove(userId, reason);
    },
    isBanned: async (userId) => {
      const ban = await guild.bans.fetch(userId).catch(() => null);
      return ban !== null;
    },
    listBans: async (): Promise<BanEntry[]> => {
      const bans = await guild.bans.fetch();
      return bans.map((b) => ({ userId: b.user.id, reason: b.reason ?? null }));
    },
  };
}

/**
 * Parse a human duration like "10m", "2h", "7d", "30s" (or a bare number = minutes) into
 * milliseconds. Returns null when unparseable, so the command can refuse with a clear message.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '0') return 0;
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] ?? 'm';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * factor;
}

/** The native permissions the sanction commands guard the bot on. */
export const BOT_PERMISSION = {
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
} as const;
