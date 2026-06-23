/**
 * ClickUp source adapter.
 *
 * Verifies ClickUp's `X-Signature` header — an HMAC-SHA256 of the raw request body
 * keyed by the webhook's signing secret — with a constant-time comparison, before any
 * parsing. Then parses a verified body into a canonical event. The hub core never
 * imports this directly; it is wired in through the source registry.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { SourceAdapter, CanonicalEvent, VerifyContext } from '../types.js';

const SLUG = 'clickup';

/**
 * Constant-time compare of two strings. To avoid leaking length information (an
 * early length-mismatch return is itself a timing side channel), both inputs are first
 * reduced to fixed-size SHA-256 digests, then compared with timingSafeEqual over equal
 * lengths. Mismatched inputs differ in their digest, matching inputs share it.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function headerValue(headers: VerifyContext['headers'], name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export const clickupAdapter: SourceAdapter = {
  slug: SLUG,
  displayName: 'ClickUp',

  verify(ctx: VerifyContext): boolean {
    const provided = headerValue(ctx.headers, 'x-signature');
    if (!provided) return false;
    const expected = createHmac('sha256', ctx.secret).update(ctx.rawBody).digest('hex');
    return safeEqual(provided, expected);
  },

  parse(rawBody: Buffer): CanonicalEvent[] {
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const eventType = typeof body.event === 'string' ? body.event : 'unknown';
    const taskId = typeof body.task_id === 'string' ? body.task_id : undefined;

    // Prefer a stable provider id for de-duplication; fall back to a body hash so a
    // byte-identical re-fire is still suppressed.
    const historyItems = Array.isArray(body.history_items) ? body.history_items : [];
    const firstHistoryId =
      historyItems.length > 0 &&
      typeof (historyItems[0] as Record<string, unknown>)?.id === 'string'
        ? ((historyItems[0] as Record<string, unknown>).id as string)
        : undefined;
    const webhookId = typeof body.webhook_id === 'string' ? body.webhook_id : undefined;
    const dedupeKey =
      webhookId && firstHistoryId
        ? `${webhookId}:${firstHistoryId}`
        : createHash('sha256').update(rawBody).digest('hex');

    const url = taskId ? `https://app.clickup.com/t/${taskId}` : undefined;
    const title = taskId ? `ClickUp ${eventType}: task ${taskId}` : `ClickUp ${eventType}`;

    return [
      {
        source: SLUG,
        eventType,
        dedupeKey,
        occurredAt: new Date().toISOString(),
        title,
        url,
        data: { taskId },
        raw: body,
      },
    ];
  },
};
