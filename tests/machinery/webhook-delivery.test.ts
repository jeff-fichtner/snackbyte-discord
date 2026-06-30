// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscordDeliveryService, type DiscordMessage } from '../../src/discord/delivery.js';
import type { DeliveryTarget } from '../../src/routing/types.js';

// Directly exercises the real webhook-URL send path (the fetch + retry/backoff logic), so the
// refactor that split delivery into per-mode methods is covered, not just asserted. The bot path
// is covered in bot-delivery.test.ts; this is the webhook counterpart and the SC-006 guard.

// resolveSecret(ref) reads the uppercased ref from the environment.
process.env.WH_TEST_REF = 'https://discord.example/webhook/abc';

const target: DeliveryTarget = { id: 'wt', mode: 'webhook', webhookUrlRef: 'wh_test_ref' };
const message: DiscordMessage = { content: 'hi', embeds: [{ title: 't' }], username: 'Bot' };

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '{}', { status, headers });
}

describe('webhook-URL delivery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('POSTs the message (content, embeds, username→avatar) to the resolved webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    await new DiscordDeliveryService().send(target, message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.example/webhook/abc');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ content: 'hi', embeds: [{ title: 't' }], username: 'Bot' });
  });

  it('fails permanently when the webhook ref resolves to no secret', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new DiscordDeliveryService().send({ ...target, webhookUrlRef: 'missing_ref' }, message),
    ).rejects.toThrow(/no secret resolved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a transient 5xx then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    const p = new DiscordDeliveryService().send(target, message);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a non-429 4xx as permanent (no retry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new DiscordDeliveryService().send(target, message)).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
