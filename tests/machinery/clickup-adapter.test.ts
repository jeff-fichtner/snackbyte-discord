// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { clickupAdapter } from '../../src/sources/clickup/adapter.js';

const SECRET = 'test-signing-secret';

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('clickup adapter — verify', () => {
  it('accepts a request with a valid X-Signature', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'taskStatusUpdated', task_id: 'abc' }));
    const ok = clickupAdapter.verify({
      rawBody: raw,
      headers: { 'x-signature': sign(raw) },
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'taskStatusUpdated', task_id: 'abc' }));
    const signature = sign(raw);
    const tampered = Buffer.from(JSON.stringify({ event: 'taskStatusUpdated', task_id: 'EVIL' }));
    const ok = clickupAdapter.verify({
      rawBody: tampered,
      headers: { 'x-signature': signature },
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it('rejects a missing signature', () => {
    const raw = Buffer.from('{}');
    expect(clickupAdapter.verify({ rawBody: raw, headers: {}, secret: SECRET })).toBe(false);
  });

  it('rejects when signed with the wrong secret', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'taskCreated' }));
    const ok = clickupAdapter.verify({
      rawBody: raw,
      headers: { 'x-signature': sign(raw, 'wrong-secret') },
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });
});

describe('clickup adapter — parse', () => {
  it('produces a canonical event with type, title, url and dedupe key', async () => {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'taskStatusUpdated',
        task_id: 'abc123',
        webhook_id: 'wh1',
        history_items: [{ id: 'h1' }],
      }),
    );
    const events = await clickupAdapter.parse(raw, {});
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.source).toBe('clickup');
    expect(e.eventType).toBe('taskStatusUpdated');
    expect(e.url).toBe('https://app.clickup.com/t/abc123');
    expect(e.dedupeKey).toBe('wh1:h1');
    expect(e.title).toContain('abc123');
  });

  it('falls back to a body hash for the dedupe key when no provider ids exist', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'taskCreated', task_id: 'x' }));
    const events = await clickupAdapter.parse(raw, {});
    expect(events[0].dedupeKey).toMatch(/^[a-f0-9]{64}$/);
  });
});
