/**
 * Message & channel moderation capabilities — the logic behind /purge, /slowmode, /lock, /pin, kept
 * independent of any interaction style. Each takes a minimal channel/message view and returns a
 * structured outcome; the command modules adapt a live channel onto them. The caller checks the
 * invoker's native permission first; these enforce action validation and platform limits, and never
 * throw for an expected failure. Stateless — acts on live channel/message state; no bot record.
 */

/** Discord cannot bulk-delete messages older than 14 days. */
export const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Discord slowmode is 0–21600 seconds (6 hours). */
export const MAX_SLOWMODE_SECONDS = 21_600;

export type ChannelOutcome =
  | { outcome: 'done' }
  | { outcome: 'refused'; reason: 'invalid-input' | 'unsupported-channel' | 'failed' };

/** Purge reports how many were deleted and how many were skipped as too old to bulk-delete. */
export type PurgeOutcome =
  | { outcome: 'done'; deleted: number; skippedTooOld: number }
  | { outcome: 'refused'; reason: 'invalid-input' | 'unsupported-channel' | 'failed' };

/** The minimal message-container surface for purge (a live text channel maps on). */
export interface PurgeChannelView {
  /** Whether this channel supports bulk message operations. */
  supportsBulk: boolean;
  /** Fetch up to `limit` recent messages as `{ id, createdTimestamp }`. */
  fetchRecent(limit: number): Promise<{ id: string; createdTimestamp: number }[]>;
  /** Bulk-delete the given message ids; records `reason`. */
  bulkDelete(ids: string[], reason?: string): Promise<void>;
}

/** The minimal channel surface for slowmode/lock (a live guild channel maps on). */
export interface ManageableChannelView {
  supportsSlowmode: boolean;
  supportsLock: boolean;
  setRateLimit(seconds: number, reason?: string): Promise<void>;
  /** Deny (lock) or allow (unlock) the send-messages permission for @everyone; records `reason`. */
  setLocked(locked: boolean, reason?: string): Promise<void>;
}

/** The minimal message surface for pin/unpin. */
export interface PinMessageView {
  pin(): Promise<void>;
  unpin(): Promise<void>;
}

/** Now, injected so the capability stays pure/testable (no ambient clock). */
export interface Clock {
  now(): number;
}

/**
 * Bulk-delete up to `count` recent messages. Messages older than the 14-day bulk limit are reported
 * as skipped, not errored. `count` must be 1–100 (the platform's bulk-fetch cap).
 */
export async function purgeMessages(
  channel: PurgeChannelView,
  count: number,
  clock: Clock,
  opts: { reason?: string } = {},
): Promise<PurgeOutcome> {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return { outcome: 'refused', reason: 'invalid-input' };
  }
  if (!channel.supportsBulk) return { outcome: 'refused', reason: 'unsupported-channel' };
  try {
    const recent = await channel.fetchRecent(count);
    const cutoff = clock.now() - BULK_DELETE_MAX_AGE_MS;
    const deletable = recent.filter((m) => m.createdTimestamp >= cutoff);
    const skippedTooOld = recent.length - deletable.length;
    if (deletable.length > 0)
      await channel.bulkDelete(
        deletable.map((m) => m.id),
        opts.reason,
      );
    return { outcome: 'done', deleted: deletable.length, skippedTooOld };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** Set (or clear, with 0) a channel's slowmode interval in seconds. */
export async function setSlowmode(
  channel: ManageableChannelView,
  seconds: number,
  opts: { reason?: string } = {},
): Promise<ChannelOutcome> {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SLOWMODE_SECONDS) {
    return { outcome: 'refused', reason: 'invalid-input' };
  }
  if (!channel.supportsSlowmode) return { outcome: 'refused', reason: 'unsupported-channel' };
  try {
    await channel.setRateLimit(seconds, opts.reason);
    return { outcome: 'done' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** Lock a channel (deny member sends) or unlock it. */
export async function setChannelLock(
  channel: ManageableChannelView,
  locked: boolean,
  opts: { reason?: string } = {},
): Promise<ChannelOutcome> {
  if (!channel.supportsLock) return { outcome: 'refused', reason: 'unsupported-channel' };
  try {
    await channel.setLocked(locked, opts.reason);
    return { outcome: 'done' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}

/** Pin or unpin a message. */
export async function setMessagePinned(
  message: PinMessageView,
  pinned: boolean,
): Promise<ChannelOutcome> {
  try {
    if (pinned) await message.pin();
    else await message.unpin();
    return { outcome: 'done' };
  } catch {
    return { outcome: 'refused', reason: 'failed' };
  }
}
