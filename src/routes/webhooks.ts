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

  // The routing store holds each source's enablement and its signing-secret reference, so
  // it must be reachable before we can verify. No context (DB down/unwired) → fail closed.
  const ctx = getContext();
  if (!ctx) {
    throw new DependencyUnavailableError();
  }

  // Look up the source row: its secret_ref drives verification (no source name is hardcoded
  // here — adding a source needs no edit to this route), and its enabled flag is a kill-switch.
  const source = await ctx.repo.getSourceRecord(slug);
  if (!source || !source.enabled || !source.secretRef) {
    // Source not registered/enabled/configured in the store — operator-side, not a sender
    // error; tell the sender to retry rather than leaking which case it was.
    throw new DependencyUnavailableError('source not configured');
  }
  const secret = resolveSecret(source.secretRef);
  if (!secret) {
    throw new DependencyUnavailableError('source secret not configured');
  }

  // The raw body is captured by express.raw on /webhooks/* (see routes/index.ts).
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

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

  // Acknowledge immediately; dispatch asynchronously. Idempotency guards sender retries.
  res.status(202).json({ accepted: true });

  for (const event of events) {
    void dispatch(event, { repo: ctx.repo, delivery: ctx.delivery }).catch((err) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'async dispatch failed');
    });
  }
}
