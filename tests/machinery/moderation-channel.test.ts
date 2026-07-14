// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  purgeMessages,
  setSlowmode,
  setChannelLock,
  setMessagePinned,
  BULK_DELETE_MAX_AGE_MS,
  MAX_SLOWMODE_SECONDS,
  type PurgeChannelView,
  type ManageableChannelView,
  type Clock,
} from '../../src/bot/moderation/channel.js';

const NOW = 1_000_000_000_000;
const clock: Clock = { now: () => NOW };

function refusedReason(o: { outcome: string; reason?: string }): string | undefined {
  return o.outcome === 'refused' ? o.reason : undefined;
}

describe('purgeMessages — count + 14-day age skip', () => {
  function channel(over: Partial<PurgeChannelView> = {}): PurgeChannelView {
    return {
      supportsBulk: true,
      fetchRecent: vi.fn(async () => []),
      bulkDelete: vi.fn(async () => {}),
      ...over,
    };
  }

  it('deletes recent messages and reports the count', async () => {
    const msgs = [
      { id: 'a', createdTimestamp: NOW - 1000 },
      { id: 'b', createdTimestamp: NOW - 2000 },
    ];
    const ch = channel({ fetchRecent: vi.fn(async () => msgs) });
    const out = await purgeMessages(ch, 50, clock);
    expect(out).toMatchObject({ outcome: 'done', deleted: 2, skippedTooOld: 0 });
    expect(ch.bulkDelete).toHaveBeenCalledWith(['a', 'b'], undefined);
  });

  it('skips (does not error) messages older than the 14-day bulk limit', async () => {
    const msgs = [
      { id: 'new', createdTimestamp: NOW - 1000 },
      { id: 'old', createdTimestamp: NOW - BULK_DELETE_MAX_AGE_MS - 1000 },
    ];
    const ch = channel({ fetchRecent: vi.fn(async () => msgs) });
    const out = await purgeMessages(ch, 50, clock);
    expect(out).toMatchObject({ outcome: 'done', deleted: 1, skippedTooOld: 1 });
    expect(ch.bulkDelete).toHaveBeenCalledWith(['new'], undefined);
  });

  it('refuses an out-of-range count', async () => {
    expect(refusedReason(await purgeMessages(channel(), 0, clock))).toBe('invalid-input');
    expect(refusedReason(await purgeMessages(channel(), 101, clock))).toBe('invalid-input');
  });

  it('refuses an unsupported channel type', async () => {
    expect(refusedReason(await purgeMessages(channel({ supportsBulk: false }), 10, clock))).toBe(
      'unsupported-channel',
    );
  });

  it('threads a reason to bulkDelete', async () => {
    const ch = channel({ fetchRecent: vi.fn(async () => [{ id: 'a', createdTimestamp: NOW }]) });
    await purgeMessages(ch, 5, clock, { reason: 'cleanup' });
    expect(ch.bulkDelete).toHaveBeenCalledWith(['a'], 'cleanup');
  });
});

describe('setSlowmode', () => {
  function channel(over: Partial<ManageableChannelView> = {}): ManageableChannelView {
    return {
      supportsSlowmode: true,
      supportsLock: true,
      setRateLimit: vi.fn(async () => {}),
      setLocked: vi.fn(async () => {}),
      ...over,
    };
  }

  it('sets an in-range interval and clears with 0', async () => {
    const ch = channel();
    expect((await setSlowmode(ch, 10)).outcome).toBe('done');
    expect((await setSlowmode(ch, 0)).outcome).toBe('done');
    expect(ch.setRateLimit).toHaveBeenCalledWith(0, undefined);
  });

  it('refuses out-of-range and unsupported channel', async () => {
    expect(refusedReason(await setSlowmode(channel(), MAX_SLOWMODE_SECONDS + 1))).toBe(
      'invalid-input',
    );
    expect(refusedReason(await setSlowmode(channel(), -1))).toBe('invalid-input');
    expect(refusedReason(await setSlowmode(channel({ supportsSlowmode: false }), 10))).toBe(
      'unsupported-channel',
    );
  });
});

describe('setChannelLock', () => {
  function channel(over: Partial<ManageableChannelView> = {}): ManageableChannelView {
    return {
      supportsSlowmode: true,
      supportsLock: true,
      setRateLimit: vi.fn(async () => {}),
      setLocked: vi.fn(async () => {}),
      ...over,
    };
  }

  it('locks and unlocks a channel', async () => {
    const ch = channel();
    expect((await setChannelLock(ch, true, { reason: 'raid' })).outcome).toBe('done');
    expect(ch.setLocked).toHaveBeenCalledWith(true, 'raid');
    expect((await setChannelLock(ch, false)).outcome).toBe('done');
    expect(ch.setLocked).toHaveBeenCalledWith(false, undefined);
  });

  it('refuses an unsupported channel type', async () => {
    expect(refusedReason(await setChannelLock(channel({ supportsLock: false }), true))).toBe(
      'unsupported-channel',
    );
  });
});

describe('setMessagePinned', () => {
  it('pins a not-pinned message and unpins a pinned one', async () => {
    const unpinnedMsg = { pinned: false, pin: vi.fn(async () => {}), unpin: vi.fn(async () => {}) };
    expect((await setMessagePinned(unpinnedMsg, true)).outcome).toBe('done');
    expect(unpinnedMsg.pin).toHaveBeenCalled();

    const pinnedMsg = { pinned: true, pin: vi.fn(async () => {}), unpin: vi.fn(async () => {}) };
    expect((await setMessagePinned(pinnedMsg, false)).outcome).toBe('done');
    expect(pinnedMsg.unpin).toHaveBeenCalled();
  });

  it('is idempotent — pinning an already-pinned message (or unpinning a not-pinned one) is a no-op', async () => {
    const pinnedMsg = { pinned: true, pin: vi.fn(async () => {}), unpin: vi.fn(async () => {}) };
    expect((await setMessagePinned(pinnedMsg, true)).outcome).toBe('unchanged');
    expect(pinnedMsg.pin).not.toHaveBeenCalled();

    const unpinnedMsg = { pinned: false, pin: vi.fn(async () => {}), unpin: vi.fn(async () => {}) };
    expect((await setMessagePinned(unpinnedMsg, false)).outcome).toBe('unchanged');
    expect(unpinnedMsg.unpin).not.toHaveBeenCalled();
  });

  it('surfaces an API failure as a refusal', async () => {
    const bad = {
      pinned: false,
      pin: vi.fn(async () => {
        throw new Error('x');
      }),
      unpin: vi.fn(async () => {}),
    };
    expect(refusedReason(await setMessagePinned(bad, true))).toBe('failed');
  });
});
