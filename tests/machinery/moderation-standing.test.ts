// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { isModerator } from '../../src/bot/moderation/standing.js';
import type { PermissionView } from '../../src/bot/moderation/standing.js';

// Moderator standing is the invoker's NATIVE per-capability permission. The check is pure over a
// minimal permission view (a live GuildMember's permissions map onto it), so it is unit-testable
// with plain objects. No moderator-role store — an admin confers standing by granting the ordinary
// Discord permission, and revoking it takes effect on the next invocation.

/** A permission view holding a fixed set of permission flags. */
function withPermissions(...held: bigint[]): PermissionView {
  const set = new Set(held);
  return { has: (permission) => set.has(permission) };
}

describe('isModerator — native per-capability permission gate', () => {
  it('allows nickname moderation when the invoker holds Manage Nicknames', () => {
    expect(isModerator(withPermissions(PermissionFlagsBits.ManageNicknames), 'nickname')).toBe(
      true,
    );
  });

  it('denies nickname moderation when the invoker lacks Manage Nicknames', () => {
    expect(isModerator(withPermissions(), 'nickname')).toBe(false);
    // Holding Manage Roles does not confer nickname standing — it is per-capability.
    expect(isModerator(withPermissions(PermissionFlagsBits.ManageRoles), 'nickname')).toBe(false);
  });

  it('allows role moderation when the invoker holds Manage Roles', () => {
    expect(isModerator(withPermissions(PermissionFlagsBits.ManageRoles), 'role')).toBe(true);
  });

  it('denies role moderation when the invoker lacks Manage Roles', () => {
    expect(isModerator(withPermissions(), 'role')).toBe(false);
    expect(isModerator(withPermissions(PermissionFlagsBits.ManageNicknames), 'role')).toBe(false);
  });

  it('is per-capability: holding one permission does not confer the other', () => {
    const nickOnly = withPermissions(PermissionFlagsBits.ManageNicknames);
    expect(isModerator(nickOnly, 'nickname')).toBe(true);
    expect(isModerator(nickOnly, 'role')).toBe(false);
  });
});

describe('isModerator — sanction & channel/message capabilities (006)', () => {
  it('maps each moderation capability to its native permission', () => {
    const cases: [Parameters<typeof isModerator>[1], bigint][] = [
      ['timeout', PermissionFlagsBits.ModerateMembers],
      ['kick', PermissionFlagsBits.KickMembers],
      ['ban', PermissionFlagsBits.BanMembers],
      ['purge', PermissionFlagsBits.ManageMessages],
      ['pin', PermissionFlagsBits.ManageMessages],
      ['slowmode', PermissionFlagsBits.ManageChannels],
      ['lock', PermissionFlagsBits.ManageChannels],
    ];
    for (const [capability, permission] of cases) {
      expect(isModerator(withPermissions(permission), capability)).toBe(true);
      expect(isModerator(withPermissions(), capability)).toBe(false);
    }
  });

  it('is per-capability across permission families (a moderator is not automatically all-powerful)', () => {
    const kickOnly = withPermissions(PermissionFlagsBits.KickMembers);
    expect(isModerator(kickOnly, 'kick')).toBe(true);
    expect(isModerator(kickOnly, 'ban')).toBe(false);
    expect(isModerator(kickOnly, 'timeout')).toBe(false);
  });

  it('purge and pin share Manage Messages; slowmode and lock share Manage Channels', () => {
    const msgs = withPermissions(PermissionFlagsBits.ManageMessages);
    expect(isModerator(msgs, 'purge')).toBe(true);
    expect(isModerator(msgs, 'pin')).toBe(true);
    expect(isModerator(msgs, 'slowmode')).toBe(false);

    const chans = withPermissions(PermissionFlagsBits.ManageChannels);
    expect(isModerator(chans, 'slowmode')).toBe(true);
    expect(isModerator(chans, 'lock')).toBe(true);
    expect(isModerator(chans, 'purge')).toBe(false);
  });
});
