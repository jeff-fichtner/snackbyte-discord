// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkHierarchy } from '../../src/bot/moderation/guards.js';
import type { HierarchyView } from '../../src/bot/moderation/guards.js';

// The shared member-hierarchy guard: bot-position AND invoker-position, both before any mutation.
// Pure over minimal position/flag views, so it is unit-testable with plain objects.

function view(over: Partial<HierarchyView> = {}): HierarchyView {
  return {
    botHasPermission: true,
    botHighestPosition: 100,
    targetHighestPosition: 10,
    invokerHighestPosition: 50,
    ...over,
  };
}

describe('checkHierarchy — bot-position + invoker-position guard', () => {
  it('passes when the bot outranks the target and the invoker outranks the target', () => {
    expect(checkHierarchy(view())).toBeNull();
  });

  it('refuses bot-cannot-manage when the bot lacks the permission', () => {
    expect(checkHierarchy(view({ botHasPermission: false }))).toBe('bot-cannot-manage');
  });

  it('refuses bot-cannot-manage when the target is at/above the bot position', () => {
    expect(checkHierarchy(view({ targetHighestPosition: 100 }))).toBe('bot-cannot-manage');
    expect(checkHierarchy(view({ targetHighestPosition: 120 }))).toBe('bot-cannot-manage');
  });

  it('refuses invoker-outranked when the target is at/above the invoking moderator', () => {
    // Target below the bot (100) but at/above the moderator (50) → escalation, refused.
    expect(checkHierarchy(view({ targetHighestPosition: 50 }))).toBe('invoker-outranked');
    expect(checkHierarchy(view({ targetHighestPosition: 60 }))).toBe('invoker-outranked');
  });

  it('checks bot-position before invoker-position (a role above the bot is bot-cannot-manage)', () => {
    // Target above BOTH bot and invoker → the bot guard wins (reported first).
    expect(checkHierarchy(view({ targetHighestPosition: 200, invokerHighestPosition: 50 }))).toBe(
      'bot-cannot-manage',
    );
  });
});
