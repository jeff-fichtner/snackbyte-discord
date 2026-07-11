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
