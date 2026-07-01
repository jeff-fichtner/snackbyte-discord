// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { setOwnNickname } from '../../src/bot/members/nickname.js';
import type { NicknameMemberView } from '../../src/bot/members/nickname.js';

function member(overrides: Partial<NicknameMemberView> = {}): NicknameMemberView {
  return {
    setNickname: vi.fn(async () => {}),
    botOutranksMember: true, // bot can manage this member by default
    botCanManageNicknames: true,
    ...overrides,
  };
}

describe('setOwnNickname — validation + bot-position guard', () => {
  it('sets a valid nickname', async () => {
    const m = member();
    const out = await setOwnNickname(m, 'Cool Name');
    expect(out.outcome).toBe('set');
    expect(m.setNickname).toHaveBeenCalledWith('Cool Name');
  });

  it('clears the nickname on reset (undefined)', async () => {
    const m = member();
    const out = await setOwnNickname(m, undefined);
    expect(out.outcome).toBe('cleared');
    expect(m.setNickname).toHaveBeenCalledWith(null);
  });

  it('refuses a nickname over 32 characters — no change (FR-004/SC-004)', async () => {
    const m = member();
    const out = await setOwnNickname(m, 'x'.repeat(33));
    expect(out.outcome).toBe('refused');
    expect(out.outcome === 'refused' && out.reason).toBe('invalid-input');
    expect(m.setNickname).not.toHaveBeenCalled();
  });

  it('accepts exactly 32 characters', async () => {
    const m = member();
    const out = await setOwnNickname(m, 'x'.repeat(32));
    expect(out.outcome).toBe('set');
  });

  it('refuses a whitespace-only value — no change', async () => {
    const m = member();
    const out = await setOwnNickname(m, '   ');
    expect(out.outcome).toBe('refused');
    expect(m.setNickname).not.toHaveBeenCalled();
  });

  it('refuses when the member outranks the bot — no change (FR-008/SC-006)', async () => {
    const m = member({ botOutranksMember: false });
    const out = await setOwnNickname(m, 'Nope');
    expect(out.outcome).toBe('refused');
    expect(out.outcome === 'refused' && out.reason).toBe('bot-cannot-manage');
    expect(m.setNickname).not.toHaveBeenCalled();
  });

  it('refuses when the bot lacks Manage Nicknames — no change (FR-008)', async () => {
    const m = member({ botCanManageNicknames: false });
    const out = await setOwnNickname(m, 'Nope');
    expect(out.outcome).toBe('refused');
    expect(m.setNickname).not.toHaveBeenCalled();
  });

  it('honors the bot-position guard on a RESET too, not just a set (U1)', async () => {
    const m = member({ botOutranksMember: false });
    const out = await setOwnNickname(m, undefined); // reset attempt
    expect(out.outcome).toBe('refused');
    expect(out.outcome === 'refused' && out.reason).toBe('bot-cannot-manage');
    expect(m.setNickname).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected API error as a clean refusal, not a throw', async () => {
    const m = member({
      setNickname: vi.fn(async () => {
        throw new Error('Missing Permissions');
      }),
    });
    const out = await setOwnNickname(m, 'Valid');
    expect(out.outcome).toBe('refused');
  });
});
