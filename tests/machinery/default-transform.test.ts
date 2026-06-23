// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveTransform } from '../../src/routing/transforms/registry.js';
import type { CanonicalEvent } from '../../src/sources/types.js';

const event: CanonicalEvent = {
  source: 'clickup',
  eventType: 'taskStatusUpdated',
  dedupeKey: 'dk',
  occurredAt: new Date(0).toISOString(),
  title: 'Task moved to In Progress',
  url: 'https://app.clickup.com/t/abc',
  actor: { displayName: 'Jeff' },
  data: {},
  raw: {},
};

describe('default transform', () => {
  it('renders an embed with the summary and link', () => {
    const transform = resolveTransform(null);
    const msg = transform(event, {});
    expect(msg.embeds).toHaveLength(1);
    const embed = msg.embeds![0] as Record<string, unknown>;
    expect(embed.title).toBe('Task moved to In Progress');
    expect(embed.url).toBe('https://app.clickup.com/t/abc');
    expect(embed.author).toMatchObject({ name: 'Jeff' });
  });

  it('falls back to the default for an unknown transform key', () => {
    const transform = resolveTransform('does-not-exist');
    const msg = transform(event, {});
    expect(msg.embeds).toHaveLength(1);
  });
});
