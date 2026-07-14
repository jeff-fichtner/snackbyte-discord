// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  timeoutMember,
  kickMember,
  banMember,
  banUserId,
  unbanUserId,
  listBans,
  bulkBanUserIds,
  MAX_TIMEOUT_MS,
  type SanctionMemberView,
  type GuildBanView,
} from '../../src/bot/moderation/sanctions.js';

// Sanction capabilities operate on minimal views, so the guards + validation are unit-testable with
// plain objects. The command adapters map a live GuildMember / Guild onto these.

function member(over: Partial<SanctionMemberView> = {}): SanctionMemberView {
  return {
    isSelf: false,
    isBot: false,
    botHasPermission: true,
    botHighestPosition: 100,
    targetHighestPosition: 10,
    invokerHighestPosition: 50,
    timeout: vi.fn(async () => {}),
    kick: vi.fn(async () => {}),
    ban: vi.fn(async () => {}),
    ...over,
  };
}

function refusedReason(o: { outcome: string; reason?: string }): string | undefined {
  return o.outcome === 'refused' ? o.reason : undefined;
}

describe('timeoutMember — validation + guards (US1)', () => {
  it('applies an in-range timeout and records the reason', async () => {
    const m = member();
    const out = await timeoutMember(m, 10 * 60 * 1000, { reason: 'spam' });
    expect(out.outcome).toBe('done');
    expect(m.timeout).toHaveBeenCalledWith(10 * 60 * 1000, 'spam');
  });

  it('clears a timeout on duration 0 or null', async () => {
    const m = member();
    expect((await timeoutMember(m, 0)).outcome).toBe('done');
    expect((await timeoutMember(m, null)).outcome).toBe('done');
    expect(m.timeout).toHaveBeenCalledWith(null, undefined);
  });

  it('refuses a duration above the 28-day maximum — no call', async () => {
    const m = member();
    const out = await timeoutMember(m, MAX_TIMEOUT_MS + 1);
    expect(out.outcome).toBe('refused');
    expect(refusedReason(out)).toBe('invalid-input');
    expect(m.timeout).not.toHaveBeenCalled();
  });

  it('refuses a negative duration', async () => {
    const out = await timeoutMember(member(), -5);
    expect(refusedReason(out)).toBe('invalid-input');
  });

  it('refuses when the target outranks the bot (bot-cannot-manage)', async () => {
    const out = await timeoutMember(member({ targetHighestPosition: 100 }), 1000);
    expect(refusedReason(out)).toBe('bot-cannot-manage');
  });

  it('refuses when the target outranks the invoker (invoker-outranked)', async () => {
    const out = await timeoutMember(member({ targetHighestPosition: 60 }), 1000);
    expect(refusedReason(out)).toBe('invoker-outranked');
  });

  it('refuses a self-target and a bot-target', async () => {
    expect(refusedReason(await timeoutMember(member({ isSelf: true }), 1000))).toBe('self-target');
    expect(refusedReason(await timeoutMember(member({ isBot: true }), 1000))).toBe('bot-target');
  });

  it('surfaces an API failure as a clean refusal, not a throw', async () => {
    const m = member({
      timeout: vi.fn(async () => {
        throw new Error('Missing Permissions');
      }),
    });
    expect(refusedReason(await timeoutMember(m, 1000))).toBe('failed');
  });
});

describe('kickMember / banMember — present-member sanctions (US2)', () => {
  it('kicks a manageable member with a reason', async () => {
    const m = member();
    expect((await kickMember(m, { reason: 'rule break' })).outcome).toBe('done');
    expect(m.kick).toHaveBeenCalledWith('rule break');
  });

  it('bans a manageable member with an optional delete window', async () => {
    const m = member();
    const out = await banMember(m, { reason: 'raid', deleteMessageSeconds: 86400 });
    expect(out.outcome).toBe('done');
    expect(m.ban).toHaveBeenCalledWith({ reason: 'raid', deleteMessageSeconds: 86400 });
  });

  it('applies the hierarchy guard + self/bot refusal to kick and ban', async () => {
    expect(refusedReason(await kickMember(member({ botHasPermission: false })))).toBe(
      'bot-cannot-manage',
    );
    expect(refusedReason(await banMember(member({ targetHighestPosition: 60 })))).toBe(
      'invoker-outranked',
    );
    expect(refusedReason(await kickMember(member({ isSelf: true })))).toBe('self-target');
    expect(refusedReason(await banMember(member({ isBot: true })))).toBe('bot-target');
  });

  it('surfaces kick/ban API failures as clean refusals', async () => {
    const km = member({
      kick: vi.fn(async () => {
        throw new Error('x');
      }),
    });
    expect(refusedReason(await kickMember(km))).toBe('failed');
  });
});

// ── Ban-list management (US3) ────────────────────────────────────────────────────────────────

function guild(over: Partial<GuildBanView> & { banned?: Set<string> } = {}): GuildBanView {
  const banned = over.banned ?? new Set<string>();
  return {
    banUser: vi.fn(async (id: string) => {
      banned.add(id);
    }),
    unbanUser: vi.fn(async (id: string) => {
      banned.delete(id);
    }),
    isBanned: vi.fn(async (id: string) => banned.has(id)),
    listBans: vi.fn(async () => [...banned].map((userId) => ({ userId, reason: null }))),
    ...over,
  };
}

const ID_A = '123456789012345678';
const ID_B = '223456789012345678';

describe('ban-list management (US3)', () => {
  it('pre-emptively bans a user id not in the guild', async () => {
    const g = guild();
    const out = await banUserId(g, ID_A, { reason: 'preemptive' });
    expect(out.outcome).toBe('banned');
    expect(g.banUser).toHaveBeenCalledWith(ID_A, { reason: 'preemptive' });
  });

  it('is idempotent — re-banning an already-banned id reports already-banned, no second call', async () => {
    const g = guild({ banned: new Set([ID_A]) });
    const out = await banUserId(g, ID_A);
    expect(out.outcome).toBe('already-banned');
    expect(g.banUser).not.toHaveBeenCalled();
  });

  it('unbans a banned id, and reports not-banned for one that is not', async () => {
    const g = guild({ banned: new Set([ID_A]) });
    expect((await unbanUserId(g, ID_A)).outcome).toBe('unbanned');
    expect((await unbanUserId(g, ID_B)).outcome).toBe('not-banned');
  });

  it('refuses a non-snowflake id without hitting the API', async () => {
    const g = guild();
    expect(refusedReason(await banUserId(g, 'not-an-id'))).toBe('invalid-input');
    expect(g.banUser).not.toHaveBeenCalled();
  });

  it('lists current bans with reasons', async () => {
    const g = guild({ banned: new Set([ID_A, ID_B]) });
    const bans = await listBans(g);
    expect(bans.map((b) => b.userId).sort()).toEqual([ID_A, ID_B].sort());
  });

  it('bulk-bans many ids with per-id outcomes and never aborts on one bad id', async () => {
    const g = guild({ banned: new Set([ID_B]) });
    const results = await bulkBanUserIds(g, [ID_A, ID_B, 'bad-id']);
    expect(results).toEqual([
      { userId: ID_A, outcome: 'banned' },
      { userId: ID_B, outcome: 'already-banned' },
      // A refused id carries WHY so the report can distinguish an invalid id from a failed one.
      { userId: 'bad-id', outcome: 'refused', reason: 'invalid-input' },
    ]);
  });
});
