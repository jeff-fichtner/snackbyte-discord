/**
 * Member-sanction capabilities — the logic behind the /timeout, /kick, and /ban commands, kept
 * independent of any interaction style. Each takes a minimal view (not a live discord.js member),
 * runs the shared hierarchy guard, and returns a structured outcome; the command modules adapt a
 * live interaction onto them. The caller checks the invoker's native permission (via isModerator)
 * before invoking; these functions enforce the bot-position + invoker-position guards and the
 * action-specific validation, and never throw for an expected failure.
 *
 * Stateless: reasons flow to the platform's audit log (via the view's action call), bans live on the
 * platform's ban list — no bot-owned durable record (that is the deferred infractions feature).
 */
import { checkHierarchy, type HierarchyView, type HierarchyRefusal } from './guards.js';

/** Discord caps a timeout at 28 days. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export type SanctionOutcome =
  | { outcome: 'done' }
  | {
      outcome: 'refused';
      reason: HierarchyRefusal | 'invalid-input' | 'self-target' | 'bot-target' | 'failed';
    };

/** The minimal member surface a sanction acts on (a live GuildMember + guild context map on). */
export interface SanctionMemberView extends HierarchyView {
  /** True when the target is the invoking moderator themselves. */
  isSelf: boolean;
  /** True when the target is the bot itself. */
  isBot: boolean;
  /** Apply a timeout of `ms` (or clear it when ms is null); records `reason` in the audit log. */
  timeout(ms: number | null, reason?: string): Promise<void>;
  /** Remove the member from the guild (kick), recording `reason`. */
  kick(reason?: string): Promise<void>;
  /** Ban the member, optionally purging `deleteMessageSeconds` of recent messages; records `reason`. */
  ban(opts: { reason?: string; deleteMessageSeconds?: number }): Promise<void>;
}

/** Refuse self/bot targets before anything else, then the hierarchy guard; null when clear to act. */
function pre(member: SanctionMemberView): SanctionOutcome | null {
  if (member.isBot) return { outcome: 'refused', reason: 'bot-target' };
  if (member.isSelf) return { outcome: 'refused', reason: 'self-target' };
  const refusal = checkHierarchy(member);
  if (refusal) return { outcome: 'refused', reason: refusal };
  return null;
}

/**
 * Time a member out for `durationMs`, or clear an active timeout when `durationMs` is 0 (or null).
 * A positive duration must be within the platform's 28-day maximum. Guarded and fail-safe.
 */
export async function timeoutMember(
  member: SanctionMemberView,
  durationMs: number | null,
  opts: { reason?: string } = {},
): Promise<SanctionOutcome> {
  const clearing = durationMs === null || durationMs === 0;
  if (!clearing && (durationMs! < 0 || durationMs! > MAX_TIMEOUT_MS)) {
    return { outcome: 'refused', reason: 'invalid-input' };
  }
  const refused = pre(member);
  if (refused) return refused;
  try {
    await member.timeout(clearing ? null : durationMs!, opts.reason);
    return { outcome: 'done' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** Kick a present member. Guarded and fail-safe. */
export async function kickMember(
  member: SanctionMemberView,
  opts: { reason?: string } = {},
): Promise<SanctionOutcome> {
  const refused = pre(member);
  if (refused) return refused;
  try {
    await member.kick(opts.reason);
    return { outcome: 'done' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** Ban a present member, optionally purging recent messages. Guarded and fail-safe. */
export async function banMember(
  member: SanctionMemberView,
  opts: { reason?: string; deleteMessageSeconds?: number } = {},
): Promise<SanctionOutcome> {
  const refused = pre(member);
  if (refused) return refused;
  try {
    await member.ban({ reason: opts.reason, deleteMessageSeconds: opts.deleteMessageSeconds });
    return { outcome: 'done' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

// ── Ban-list management (US3) — acts on the guild ban list, not a present member ────────────────

export type BanListOutcome =
  | { outcome: 'banned' | 'unbanned' | 'already-banned' | 'not-banned' }
  | { outcome: 'refused'; reason: 'invalid-input' | 'failed' };

export interface BanEntry {
  userId: string;
  reason: string | null;
}

/** The minimal guild ban-list surface (a live Guild's bans manager maps on). */
export interface GuildBanView {
  /** Ban a user id (present or not); records `reason`. Rejects if already banned (surfaced as such). */
  banUser(userId: string, opts: { reason?: string; deleteMessageSeconds?: number }): Promise<void>;
  /** Unban a user id; records `reason`. */
  unbanUser(userId: string, reason?: string): Promise<void>;
  /** Whether a user id is currently banned. */
  isBanned(userId: string): Promise<boolean>;
  /** The current ban list. */
  listBans(): Promise<BanEntry[]>;
}

/** A rough Discord snowflake check — 17–20 digits. Keeps a bad id from reaching the API. */
function isSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

/** Pre-emptively ban a user id (may not be in the guild). Idempotent on an already-banned id. */
export async function banUserId(
  guild: GuildBanView,
  userId: string,
  opts: { reason?: string; deleteMessageSeconds?: number } = {},
): Promise<BanListOutcome> {
  if (!isSnowflake(userId)) return { outcome: 'refused', reason: 'invalid-input' };
  try {
    if (await guild.isBanned(userId)) return { outcome: 'already-banned' };
    await guild.banUser(userId, opts);
    return { outcome: 'banned' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** Unban a user id. Idempotent on a not-banned id. */
export async function unbanUserId(
  guild: GuildBanView,
  userId: string,
  opts: { reason?: string } = {},
): Promise<BanListOutcome> {
  if (!isSnowflake(userId)) return { outcome: 'refused', reason: 'invalid-input' };
  try {
    if (!(await guild.isBanned(userId))) return { outcome: 'not-banned' };
    await guild.unbanUser(userId, opts.reason);
    return { outcome: 'unbanned' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** List current bans. */
export async function listBans(guild: GuildBanView): Promise<BanEntry[]> {
  return guild.listBans();
}

/** Per-id outcome for a bulk ban — carries the refusal reason so an invalid id reads differently
 * from a failed one in the report. */
export interface BulkBanResult {
  userId: string;
  outcome: BanListOutcome['outcome'];
  reason?: 'invalid-input' | 'failed';
}

/**
 * Bulk-ban many user ids. Each id gets its own outcome; one bad id never aborts the batch.
 */
export async function bulkBanUserIds(
  guild: GuildBanView,
  userIds: string[],
  opts: { reason?: string; deleteMessageSeconds?: number } = {},
): Promise<BulkBanResult[]> {
  const results: BulkBanResult[] = [];
  for (const userId of userIds) {
    const r = await banUserId(guild, userId, opts);
    results.push({
      userId,
      outcome: r.outcome,
      ...(r.outcome === 'refused' ? { reason: r.reason } : {}),
    });
  }
  return results;
}
