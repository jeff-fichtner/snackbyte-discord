// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { githubTransform } from '../../src/routing/transforms/github.js';
import { resolveTransform } from '../../src/routing/transforms/registry.js';
import { defaultTransform } from '../../src/routing/transforms/default.js';
import '../../src/routing/transforms/index.js'; // register named transforms
import type { CanonicalEvent } from '../../src/sources/types.js';

function ghEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    source: 'github',
    eventType: 'pull_request.opened',
    dedupeKey: 'd',
    occurredAt: new Date(0).toISOString(),
    title: 'PR #1 opened: Hello',
    url: 'https://github.com/x/y/pull/1',
    actor: { displayName: 'octocat', avatarUrl: 'a' },
    data: {},
    raw: {},
    ...overrides,
  };
}

describe('github transform', () => {
  it('renders an embed with title + url + author', () => {
    const msg = githubTransform(ghEvent(), {});
    expect(msg.embeds).toHaveLength(1);
    const embed = msg.embeds![0] as Record<string, unknown>;
    expect(embed.title).toBe('PR #1 opened: Hello');
    expect(embed.url).toBe('https://github.com/x/y/pull/1');
    expect((embed.author as Record<string, unknown>).name).toBe('octocat');
  });

  it('is selectable by name via the registry; null falls back to default', () => {
    expect(resolveTransform('github')).toBe(githubTransform);
    expect(resolveTransform(null)).toBe(defaultTransform);
    expect(resolveTransform('nope')).toBe(defaultTransform);
  });

  it('applies mentionRoleIds as content', () => {
    const msg = githubTransform(ghEvent(), { mentionRoleIds: ['111', '222'] });
    expect(msg.content).toBe('<@&111> <@&222>');
  });

  it('omits unresolvable / empty mention ids without erroring', () => {
    const msg = githubTransform(ghEvent(), { mentionRoleIds: ['', 123, null] as unknown[] });
    expect(msg.content).toBeUndefined();
  });

  it('reflects accentColor on the embed', () => {
    const msg = githubTransform(ghEvent(), { accentColor: 5814783 });
    expect((msg.embeds![0] as Record<string, unknown>).color).toBe(5814783);
  });

  it('same transform + two configs → two different outputs', () => {
    const a = githubTransform(ghEvent(), { mentionRoleIds: ['1'] });
    const b = githubTransform(ghEvent(), { accentColor: 42 });
    expect(a.content).toBe('<@&1>');
    expect(b.content).toBeUndefined();
    expect((b.embeds![0] as Record<string, unknown>).color).toBe(42);
  });

  it('with empty config produces no content and no color (no-regression baseline)', () => {
    const msg = githubTransform(ghEvent(), {});
    expect(msg.content).toBeUndefined();
    expect((msg.embeds![0] as Record<string, unknown>).color).toBeUndefined();
  });
});

describe('default transform unchanged by the format helper', () => {
  it('renders identically with empty config (ClickUp no-regression)', () => {
    const event = ghEvent({ source: 'clickup', eventType: 'taskStatusUpdated' });
    const msg = defaultTransform(event, {});
    // The default transform never adds content or color — exactly today's behavior.
    expect((msg as { content?: string }).content).toBeUndefined();
    const embed = msg.embeds![0] as Record<string, unknown>;
    expect(embed.color).toBeUndefined();
    expect(embed.title).toBe(event.title);
  });
});
