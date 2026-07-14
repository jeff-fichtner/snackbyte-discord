// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveComponentRole } from '../../src/bot/components/resolve.js';
import type { ComponentRoleBinding } from '../../src/db/repository.js';

// Pure resolver: a component toggles a role only when a binding maps it AND the role is whitelisted.

function binding(over: Partial<ComponentRoleBinding> = {}): ComponentRoleBinding {
  return { componentKey: 'role:announcements', roleId: 'r1', ...over };
}

describe('resolveComponentRole — binding + whitelist intersection', () => {
  it('resolves a bound, whitelisted component to its role', () => {
    expect(
      resolveComponentRole({
        bindings: [binding()],
        whitelistRoleIds: ['r1'],
        componentKey: 'role:announcements',
      }),
    ).toBe('r1');
  });

  it('returns null for a bound role that is not whitelisted (never bypasses the whitelist)', () => {
    expect(
      resolveComponentRole({
        bindings: [binding({ roleId: 'r9' })],
        whitelistRoleIds: ['r1'],
        componentKey: 'role:announcements',
      }),
    ).toBeNull();
  });

  it('returns null when no binding matches the component key', () => {
    expect(
      resolveComponentRole({
        bindings: [binding()],
        whitelistRoleIds: ['r1'],
        componentKey: 'role:unknown',
      }),
    ).toBeNull();
  });

  it('matches a select-option key (customId + value) distinctly from a button key', () => {
    const bindings = [
      binding({ componentKey: 'menu:roles::events', roleId: 'events' }),
      binding({ componentKey: 'menu:roles::news', roleId: 'news' }),
    ];
    expect(
      resolveComponentRole({
        bindings,
        whitelistRoleIds: ['events', 'news'],
        componentKey: 'menu:roles::news',
      }),
    ).toBe('news');
    expect(
      resolveComponentRole({
        bindings,
        whitelistRoleIds: ['events', 'news'],
        componentKey: 'menu:roles::gone',
      }),
    ).toBeNull();
  });

  it('is data-driven: the same key resolves with a binding and null without one', () => {
    const input = { whitelistRoleIds: ['r1'], componentKey: 'role:announcements' };
    expect(resolveComponentRole({ ...input, bindings: [binding()] })).toBe('r1');
    expect(resolveComponentRole({ ...input, bindings: [] })).toBeNull();
  });
});
