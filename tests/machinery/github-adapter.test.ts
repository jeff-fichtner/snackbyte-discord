// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { githubAdapter } from '../../src/sources/github/adapter.js';

const SECRET = 'gh-signing-secret';

function sign(body: Buffer, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function ctx(body: Buffer, headers: Record<string, string>, secret = SECRET) {
  return { rawBody: body, headers, secret };
}

describe('github adapter — verify', () => {
  it('accepts a valid X-Hub-Signature-256', () => {
    const raw = Buffer.from(JSON.stringify({ action: 'opened' }));
    expect(githubAdapter.verify(ctx(raw, { 'x-hub-signature-256': sign(raw) }))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const raw = Buffer.from(JSON.stringify({ action: 'opened' }));
    const sig = sign(raw);
    const tampered = Buffer.from(JSON.stringify({ action: 'EVIL' }));
    expect(githubAdapter.verify(ctx(tampered, { 'x-hub-signature-256': sig }))).toBe(false);
  });

  it('rejects a missing signature', () => {
    const raw = Buffer.from('{}');
    expect(githubAdapter.verify(ctx(raw, {}))).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const raw = Buffer.from(JSON.stringify({ action: 'opened' }));
    const ok = githubAdapter.verify(ctx(raw, { 'x-hub-signature-256': sign(raw, 'wrong') }));
    expect(ok).toBe(false);
  });
});

describe('github adapter — parse', () => {
  async function parse(type: string, body: object, delivery = 'guid-1') {
    const raw = Buffer.from(JSON.stringify(body));
    return Promise.resolve(
      githubAdapter.parse(raw, { 'x-github-event': type, 'x-github-delivery': delivery }),
    );
  }

  it('ignores ping and unmapped events', async () => {
    expect(await parse('ping', { zen: 'hi' })).toHaveLength(0);
    expect(await parse('star', { action: 'created' })).toHaveLength(0);
  });

  it('maps pull_request.opened with type.action, title, url, dedupe key', async () => {
    const events = await parse('pull_request', {
      action: 'opened',
      pull_request: { number: 7, title: 'Fix it', html_url: 'https://github.com/x/y/pull/7' },
      sender: { login: 'octocat', avatar_url: 'a' },
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.source).toBe('github');
    expect(e.eventType).toBe('pull_request.opened');
    expect(e.dedupeKey).toBe('guid-1');
    expect(e.url).toBe('https://github.com/x/y/pull/7');
    expect(e.title).toContain('#7');
    expect(e.actor?.displayName).toBe('octocat');
  });

  it('maps a merged PR as pull_request.closed with merged + subtype in data', async () => {
    const events = await parse('pull_request', {
      action: 'closed',
      pull_request: { number: 9, title: 'Done', merged: true, html_url: 'u' },
    });
    expect(events[0].eventType).toBe('pull_request.closed');
    expect(events[0].data.merged).toBe(true);
    expect(events[0].data.subtype).toBe('pull_request.merged');
    expect(events[0].title).toContain('merged');
  });

  it('maps a closed-not-merged PR with the unmerged subtype', async () => {
    const events = await parse('pull_request', {
      action: 'closed',
      pull_request: { number: 9, title: 'Nope', merged: false, html_url: 'u' },
    });
    expect(events[0].data.subtype).toBe('pull_request.unmerged');
  });

  it('maps push with a branch subtype', async () => {
    const events = await parse('push', {
      ref: 'refs/heads/main',
      repository: { full_name: 'x/y', html_url: 'https://github.com/x/y' },
      commits: [{}, {}],
    });
    expect(events[0].eventType).toBe('push');
    expect(events[0].data.subtype).toBe('branch:main');
    expect(events[0].data.branch).toBe('main');
  });

  it('maps issues.opened', async () => {
    const events = await parse('issues', {
      action: 'opened',
      issue: { number: 3, title: 'Bug', html_url: 'https://github.com/x/y/issues/3' },
    });
    expect(events[0].eventType).toBe('issues.opened');
    expect(events[0].url).toContain('/issues/3');
  });

  it('falls back to a body hash dedupe key when delivery id is absent', async () => {
    const raw = Buffer.from(JSON.stringify({ action: 'opened', pull_request: { number: 1 } }));
    const events = await Promise.resolve(
      githubAdapter.parse(raw, { 'x-github-event': 'pull_request' }),
    );
    expect(events[0].dedupeKey).toMatch(/^[a-f0-9]{64}$/);
  });
});
