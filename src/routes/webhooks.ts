/**
 * Generic inbound webhook endpoint: POST /webhooks/:source.
 *
 * Resolves the source adapter by slug (404 if unknown), verifies authenticity against
 * the configured signing secret on the RAW body (401 on failure — permanent, no retry),
 * then acknowledges the sender immediately (202) and dispatches routing + delivery
 * asynchronously. If the routing store is unreachable, it fails closed (503) so the
 * sender retries rather than the event being silently dropped.
 */
import type { Request, Response } from 'express';
import { getSource } from '../sources/registry.js';
import { resolveSecret } from '../config.js';
import { getContext } from '../core/context.js';
import { dispatch } from '../routing/engine.js';
import { childLogger } from '../core/logger.js';
import {
  UnknownSourceError,
  UnauthorizedError,
  BadPayloadError,
  DependencyUnavailableError,
} from '../core/errors.js';

const log = childLogger('webhooks');

export async function receiveWebhook(req: Request, res: Response): Promise<void> {
  const slug = String(req.params.source);
  const adapter = getSource(slug);
  if (!adapter) {
    throw new UnknownSourceError();
  }

  // The raw body is captured by express.raw on /webhooks/* (see routes/index.ts).
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const secret = adapter.slug === 'clickup' ? resolveSecret('clickup_webhook_secret') : undefined;
  if (!secret) {
    // Missing signing secret config is an operator error, not a sender error.
    throw new DependencyUnavailableError('source not configured');
  }

  const ok = await adapter.verify({ rawBody, headers: req.headers, secret });
  if (!ok) {
    throw new UnauthorizedError();
  }

  let events;
  try {
    events = await adapter.parse(rawBody, req.headers);
  } catch (err) {
    throw new BadPayloadError(err instanceof Error ? err.message : 'invalid payload');
  }

  const ctx = getContext();
  if (!ctx) {
    // No runtime services wired (e.g. DB unavailable at boot) — tell the sender to retry.
    throw new DependencyUnavailableError();
  }

  // Acknowledge immediately; dispatch asynchronously. Idempotency guards sender retries.
  res.status(202).json({ accepted: true });

  for (const event of events) {
    void dispatch(event, { repo: ctx.repo, delivery: ctx.delivery }).catch((err) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'async dispatch failed');
    });
  }
}
