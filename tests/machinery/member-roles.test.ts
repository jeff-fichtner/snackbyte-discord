// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { toggleSelfRole, listSelfAssignableRoles } from '../../src/bot/members/roles.js';
import type { MemberView, RoleView } from '../../src/bot/members/roles.js';

// The capability operates on a minimal member/role view, not a live discord.js GuildMember, so the
// authorization gate is unit-testable with plain objects. The /role command adapter maps a real
// GuildMember onto this shape.

function role(id: string, name = `role-${id}`, position = 1): RoleView {
  return { id, name, position };
}

function member(opts: { currentRoleIds?: string[] } & Partial<MemberView> = {}): MemberView {
  const { currentRoleIds = [], ...overrides } = opts;
  return {
    hasRole: (id) => currentRoleIds.includes(id),
    addRole: vi.fn(async () => {}),
    removeRole: vi.fn(async () => {}),
    botHighestPosition: 100, // bot sits high by default; individual tests lower it
    botCanManageRoles: true,
    ...overrides,
  };
}

/** Narrow a refused outcome so its reason is typed. */
function refusedReason(out: { outcome: string; reason?: string }): string | undefined {
  return out.outcome === 'refused' ? out.reason : undefined;
}

describe('toggleSelfRole — the authorization gate + toggle', () => {
  it('adds a whitelisted role the member lacks', async () => {
    const m = member({ currentRoleIds: [] });
    const r = role('r1', 'Notifications', 5);
    const out = await toggleSelfRole(m, r, ['r1']);
    expect(out.outcome).toBe('added');
    expect(m.addRole).toHaveBeenCalledWith('r1');
    expect(m.removeRole).not.toHaveBeenCalled();
  });

  it('removes a whitelisted role the member has (toggle)', async () => {
    const m = member({ currentRoleIds: ['r1'] });
    const out = await toggleSelfRole(m, role('r1', 'Notifications', 5), ['r1']);
    expect(out.outcome).toBe('removed');
    expect(m.removeRole).toHaveBeenCalledWith('r1');
    expect(m.addRole).not.toHaveBeenCalled();
  });

  it('refuses a role not on the whitelist — no mutation (FR-002/SC-002)', async () => {
    const m = member({ currentRoleIds: [] });
    const out = await toggleSelfRole(m, role('r9', 'Admin', 5), ['r1', 'r2']);
    expect(out.outcome).toBe('refused');
    expect(refusedReason(out)).toBe('not-whitelisted');
    expect(m.addRole).not.toHaveBeenCalled();
    expect(m.removeRole).not.toHaveBeenCalled();
  });

  it('refuses when the role is at/above the bot position — no mutation (FR-007/SC-006)', async () => {
    const m = member({ currentRoleIds: [], botHighestPosition: 3 });
    const out = await toggleSelfRole(m, role('r1', 'Staff', 5), ['r1']);
    expect(out.outcome).toBe('refused');
    expect(refusedReason(out)).toBe('bot-cannot-manage');
    expect(m.addRole).not.toHaveBeenCalled();
  });

  it('refuses when the bot lacks Manage Roles — no mutation (FR-007)', async () => {
    const m = member({ currentRoleIds: [], botCanManageRoles: false });
    const out = await toggleSelfRole(m, role('r1', 'Notifications', 5), ['r1']);
    expect(out.outcome).toBe('refused');
    expect(refusedReason(out)).toBe('bot-cannot-manage');
    expect(m.addRole).not.toHaveBeenCalled();
  });

  it('surfaces a mutation failure (e.g. role deleted mid-op) as a clean refusal, not a throw', async () => {
    const m = member({
      currentRoleIds: [],
      addRole: vi.fn(async () => {
        throw new Error('Unknown Role');
      }),
    });
    const out = await toggleSelfRole(m, role('r1', 'Notifications', 5), ['r1']);
    expect(out.outcome).toBe('refused');
    expect(refusedReason(out)).toBe('role-not-found');
  });
});

describe('the whitelist is data-driven (US4) — authorization follows the operator-edited set', () => {
  it('the SAME role is assignable with one whitelist and refused with another', async () => {
    const r = role('r1', 'Notifications', 5);
    // Operator has whitelisted r1 → assignable.
    const allowed = await toggleSelfRole(member({ currentRoleIds: [] }), r, ['r1']);
    expect(allowed.outcome).toBe('added');
    // Operator has NOT whitelisted r1 (removed it) → refused. Same role, only the data differs.
    const denied = await toggleSelfRole(member({ currentRoleIds: [] }), r, []);
    expect(denied.outcome).toBe('refused');
    expect(refusedReason(denied)).toBe('not-whitelisted');
  });

  it('never self-assigns a role absent from the whitelist — no auto-add path (FR-006)', async () => {
    const m = member({ currentRoleIds: [] });
    // An empty whitelist authorizes nothing, whatever the role.
    const out = await toggleSelfRole(m, role('anything', 'Anything', 2), []);
    expect(out.outcome).toBe('refused');
    expect(m.addRole).not.toHaveBeenCalled();
  });
});

describe('listSelfAssignableRoles — resolve whitelisted ids to live roles', () => {
  it('returns the live roles whose ids are whitelisted, omitting stale ids', () => {
    const live = [role('r1', 'Notifications'), role('r2', 'She/Her')]; // r3 deleted
    const result = listSelfAssignableRoles(live, ['r1', 'r2', 'r3']);
    expect(result.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(result.map((r) => r.name)).toContain('Notifications');
  });

  it('returns an empty list for an empty whitelist', () => {
    expect(listSelfAssignableRoles([role('r1')], [])).toEqual([]);
  });

  it('returns an empty list when all whitelisted ids are stale', () => {
    expect(listSelfAssignableRoles([role('r1')], ['gone1', 'gone2'])).toEqual([]);
  });
});
