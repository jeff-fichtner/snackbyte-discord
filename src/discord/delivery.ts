/**
 * Discord delivery service — the single chokepoint for ALL writes to Discord.
 *
 * Routing every message through here is what lets de-duplication and rate-limit handling
 * be enforced in one place; ad-hoc calls that bypass it are not allowed. This slice
 * implements the channel-webhook path (POST to a channel webhook URL); the bot-REST path
 * is a later feature behind the same interface.
 */
import { resolveSecret } from '../config.js';
import { childLogger } from '../core/logger.js';
import type { DeliveryTarget } from '../routing/types.js';

const log = childLogger('delivery');

/** A renderable Discord message (webhook mode fields shown; components are bot-mode). */
export interface DiscordMessage {
  content?: string;
  embeds?: unknown[];
  username?: string;
  avatarUrl?: string;
}

export interface DeliveryService {
  send(target: DeliveryTarget, msg: DiscordMessage): Promise<void>;
}

const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Webhook-URL delivery with bounded retry/backoff that honors Discord's Retry-After.
 * Throws after exhausting attempts so the caller records a failed delivery.
 */
export class WebhookDeliveryService implements DeliveryService {
  async send(target: DeliveryTarget, msg: DiscordMessage): Promise<void> {
    if (target.mode !== 'webhook') {
      throw new Error(`delivery target ${target.id} is not a webhook target`);
    }
    if (!target.webhookUrlRef) {
      throw new Error(`webhook target ${target.id} has no webhook_url_ref`);
    }
    const url = resolveSecret(target.webhookUrlRef);
    if (!url) {
      throw new Error(`no secret resolved for ref ${target.webhookUrlRef}`);
    }

    const payload = JSON.stringify({
      content: msg.content,
      embeds: msg.embeds,
      username: msg.username,
      avatar_url: msg.avatarUrl,
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        });
        if (res.ok || res.status === 204) return;

        // 429 (rate limited) / 5xx are transient — back off and retry.
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250;
          log.warn(
            { status: res.status, attempt, waitMs },
            'discord delivery transient failure; retrying',
          );
          if (attempt < MAX_ATTEMPTS) await sleep(waitMs);
          lastError = new Error(`discord responded ${res.status}`);
          continue;
        }
        // 4xx other than 429 is permanent (bad payload / revoked webhook).
        throw new Error(`discord responded ${res.status}`);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 250);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('discord delivery failed');
  }
}
