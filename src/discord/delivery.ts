/**
 * Discord delivery service — the single chokepoint for ALL writes to Discord.
 *
 * Routing every message through here is what lets de-duplication and rate-limit handling
 * be enforced in one place; ad-hoc calls that bypass it are not allowed. The service handles
 * two mechanisms behind one `send`, selected by the target's mode: the channel-webhook path
 * (POST to a channel webhook URL) and the bot-REST path (post as the bot via its REST client).
 * The caller (the routing engine) never learns which mechanism a target uses.
 */
import { type REST, Routes } from 'discord.js';
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

/** Backoff for a transient attempt: honor Discord's Retry-After if given, else exponential. */
function backoffMs(retryAfterSeconds: number, attempt: number): number {
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : 2 ** attempt * 250;
}

/** The HTTP status carried by a discord.js REST error (DiscordAPIError / HTTPError), if any. */
function discordErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * A bot-path failure is permanent (retrying cannot help) when Discord rejects the request for a
 * reason a retry won't change: missing permission (403), unknown channel (404), or bad/expired
 * credentials (401). Everything else — 429, 5xx, and network/timeout errors with no status — is
 * transient and worth retrying.
 */
function isPermanentDiscordError(err: unknown): boolean {
  const status = discordErrorStatus(err);
  return status === 401 || status === 403 || status === 404;
}

/** Seconds to wait from a discord.js rate-limit error's retry hint, or NaN if none. */
function retryAfterSeconds(err: unknown): number {
  const retryAfter = (err as { retryAfter?: unknown })?.retryAfter; // discord.js: milliseconds
  return typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter / 1000 : NaN;
}

/**
 * Delivers to Discord by either the channel-webhook path or the bot-REST path, chosen by the
 * target's mode. Both honor Discord's rate limits and retry transient failures with bounded
 * backoff; both throw after exhausting attempts (or immediately on a permanent failure) so the
 * caller records a failed delivery. An optional bot REST client enables the bot path; when it is
 * absent, a bot-mode delivery fails permanently with a clear reason while webhook delivery still
 * works.
 */
export class DiscordDeliveryService implements DeliveryService {
  constructor(private readonly botRest?: REST) {}

  async send(target: DeliveryTarget, msg: DiscordMessage): Promise<void> {
    if (target.mode === 'webhook') return this.sendWebhook(target, msg);
    if (target.mode === 'bot') return this.sendBot(target, msg);
    throw new Error(`delivery target ${target.id} has unknown mode ${String(target.mode)}`);
  }

  /**
   * Webhook-URL delivery with bounded retry/backoff that honors Discord's Retry-After.
   * Throws after exhausting attempts so the caller records a failed delivery.
   */
  private async sendWebhook(target: DeliveryTarget, msg: DiscordMessage): Promise<void> {
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
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        });
      } catch (err) {
        // A network/transport error (fetch rejected) is transient — back off and retry.
        lastError = err;
        if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 250);
        continue;
      }

      if (res.ok || res.status === 204) return;

      // 429 (rate limited) / 5xx are transient — back off and retry.
      if (res.status === 429 || res.status >= 500) {
        const waitMs = backoffMs(Number(res.headers.get('retry-after')), attempt);
        log.warn(
          { status: res.status, attempt, waitMs },
          'discord delivery transient failure; retrying',
        );
        lastError = new Error(`discord responded ${res.status}`);
        if (attempt < MAX_ATTEMPTS) await sleep(waitMs);
        continue;
      }
      // 4xx other than 429 is permanent (bad payload / revoked webhook) — fail immediately.
      throw new Error(`discord responded ${res.status}`);
    }
    throw lastError instanceof Error ? lastError : new Error('discord delivery failed');
  }

  /**
   * Bot-REST delivery: posts a message into the target channel as the bot, via the bot's REST
   * client (which carries Discord's rate-limit queue). Preconditions that cannot succeed if unmet
   * — no bot client, no channel — are permanent failures recorded immediately. The message body
   * is content + embeds only; the bot posts under its own identity, so webhook-only cosmetic
   * fields (username/avatar) do not apply.
   */
  private async sendBot(target: DeliveryTarget, msg: DiscordMessage): Promise<void> {
    if (!this.botRest) {
      throw new Error('bot delivery unavailable: no bot token configured');
    }
    if (!target.channelId) {
      throw new Error(`bot target ${target.id} has no channel_id`);
    }

    const body = { content: msg.content, embeds: msg.embeds };
    const route = Routes.channelMessages(target.channelId);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.botRest.post(route, { body });
        return;
      } catch (err) {
        // Permanent failures (missing permission, unknown channel, bad credentials) cannot
        // succeed on retry — surface immediately. Everything else is transient: back off and retry.
        if (isPermanentDiscordError(err)) throw err;
        lastError = err;
        if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(retryAfterSeconds(err), attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('bot delivery failed');
  }
}
