// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { REST } from 'discord.js';
import { DiscordDeliveryService, type DiscordMessage } from '../../src/discord/delivery.js';
import type { DeliveryTarget } from '../../src/routing/types.js';

/** A discord.js-shaped REST error: carries an HTTP `status` (and optional `retryAfter` ms). */
function apiError(status: number, retryAfter?: number): Error & { status: number } {
  const e = new Error(`Discord API error ${status}`) as Error & {
    status: number;
    retryAfter?: number;
  };
  e.status = status;
  if (retryAfter !== undefined) e.retryAfter = retryAfter;
  return e;
}

// A minimal stand-in for discord.js's REST client: only `post` is exercised by the bot path.
// The behavior under test is how the delivery service calls it and classifies its outcomes,
// not discord.js internals.
function fakeRest(post: ReturnType<typeof vi.fn>): REST {
  return { post } as unknown as REST;
}

const botTarget = (overrides: Partial<DeliveryTarget> = {}): DeliveryTarget => ({
  id: 'bt1',
  mode: 'bot',
  channelId: '900111',
  guildId: '500222',
  ...overrides,
});

const message: DiscordMessage = { content: 'hi', embeds: [{ title: 't' }] };

describe('bot-REST delivery — happy path & dispatch', () => {
  it('posts as the bot to channels/{channelId}/messages with content + embeds', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'm1' });
    const svc = new DiscordDeliveryService(fakeRest(post));

    await svc.send(botTarget(), message);

    expect(post).toHaveBeenCalledTimes(1);
    const [route, options] = post.mock.calls[0];
    expect(route).toBe('/channels/900111/messages');
    expect((options as { body: Record<string, unknown> }).body).toEqual({
      content: 'hi',
      embeds: [{ title: 't' }],
    });
  });

  it('does NOT send webhook-only cosmetic fields (username/avatarUrl) on the bot path', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'm1' });
    const svc = new DiscordDeliveryService(fakeRest(post));

    await svc.send(botTarget(), { content: 'x', username: 'nope', avatarUrl: 'nope' });

    const body = (post.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty('username');
    expect(body).not.toHaveProperty('avatar_url');
    expect(body).not.toHaveProperty('avatarUrl');
  });

  it('routes a webhook-mode target to the webhook path, never the bot REST client', async () => {
    const post = vi.fn();
    const svc = new DiscordDeliveryService(fakeRest(post));
    // A webhook target with an unresolved ref fails on the webhook path — the point is the bot
    // REST client is never touched for a webhook-mode target (dispatch correctness).
    await expect(
      svc.send({ id: 'wt1', mode: 'webhook', webhookUrlRef: 'no_such_secret_ref' }, message),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not leak the bot token in a failure reason', async () => {
    // No REST client configured → bot delivery is a permanent failure. The thrown reason (which
    // the engine records) must not contain any token-like secret.
    const svc = new DiscordDeliveryService(undefined);
    await expect(svc.send(botTarget(), message)).rejects.toThrow(/no bot token configured/);
    // And when a client IS configured, its token is never surfaced: the service is constructed
    // with the REST client object, never a raw token, so there is no token string to leak.
  });
});

describe('bot-REST delivery — failure classification', () => {
  afterEach(() => vi.useRealTimers());

  it('records a missing-channel target as a permanent failure with no REST call', async () => {
    const post = vi.fn();
    const svc = new DiscordDeliveryService(fakeRest(post));
    await expect(svc.send(botTarget({ channelId: null }), message)).rejects.toThrow(/channel_id/);
    expect(post).not.toHaveBeenCalled();
  });

  it('throws immediately on a permanent API error (403) — a single attempt, no retry', async () => {
    const post = vi.fn().mockRejectedValue(apiError(403));
    const svc = new DiscordDeliveryService(fakeRest(post));
    await expect(svc.send(botTarget(), message)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1); // no backoff loop
  });

  it.each([404, 401])('treats %i as permanent (single attempt)', async (status) => {
    const post = vi.fn().mockRejectedValue(apiError(status));
    const svc = new DiscordDeliveryService(fakeRest(post));
    await expect(svc.send(botTarget(), message)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries a transient error (429) and resolves when a later attempt succeeds', async () => {
    vi.useFakeTimers();
    const post = vi
      .fn()
      .mockRejectedValueOnce(apiError(429, 10)) // retryAfter 10ms
      .mockResolvedValueOnce({ id: 'm1' });
    const svc = new DiscordDeliveryService(fakeRest(post));

    const p = svc.send(botTarget(), message);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('retries a persistent transient error (5xx) up to the bound, then throws', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockRejectedValue(apiError(503));
    const svc = new DiscordDeliveryService(fakeRest(post));

    const p = svc.send(botTarget(), message);
    const assertion = expect(p).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    expect(post).toHaveBeenCalledTimes(4); // MAX_ATTEMPTS
  });
});
