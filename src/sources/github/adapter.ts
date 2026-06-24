/**
 * GitHub source adapter.
 *
 * Verifies GitHub's `X-Hub-Signature-256` header — `sha256=` + HMAC-SHA256 of the raw
 * request body keyed by the webhook's signing secret — with a constant-time comparison,
 * before any parsing. Then parses a verified body into canonical event(s). The hub core
 * never imports this directly; it is wired in through the source registry.
 *
 * Event types are expressed as a combined `type.action` discriminator (e.g.
 * `pull_request.opened`, `issues.closed`, `push`) so operators route each action via the
 * existing exact-match engine. A merged PR is `pull_request.closed` with merged-ness carried
 * in `data` (GitHub has no `merged` action). Each event also carries a normalized
 * `data.subtype` string the per-route filter matches against.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { SourceAdapter, CanonicalEvent, VerifyContext } from '../types.js';

const SLUG = 'github';

/** Constant-time compare via fixed-size digests (no length leak). Mirrors the ClickUp adapter. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function headerValue(headers: VerifyContext['headers'], name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export const githubAdapter: SourceAdapter = {
  slug: SLUG,
  displayName: 'GitHub',

  verify(ctx: VerifyContext): boolean {
    const provided = headerValue(ctx.headers, 'x-hub-signature-256');
    if (!provided) return false;
    // GitHub sends "sha256=<hex>"; compare the hex part constant-time.
    const expected = 'sha256=' + createHmac('sha256', ctx.secret).update(ctx.rawBody).digest('hex');
    return safeEqual(provided, expected);
  },

  parse(rawBody: Buffer, headers: VerifyContext['headers']): CanonicalEvent[] {
    const type = headerValue(headers, 'x-github-event');
    // GitHub's "ping" (sent on webhook creation) and any event type we don't map → ignore.
    if (!type || type === 'ping') return [];

    const body = asRecord(JSON.parse(rawBody.toString('utf8')));
    const action = asString(body.action);
    const eventType = action ? `${type}.${action}` : type;

    // Stable de-dup key: GitHub's per-delivery GUID; body hash if somehow absent.
    const deliveryId = headerValue(headers, 'x-github-delivery');
    const dedupeKey = deliveryId ?? createHash('sha256').update(rawBody).digest('hex');

    const sender = asRecord(body.sender);
    const actor = {
      id: asString(sender.id) ?? (typeof sender.id === 'number' ? String(sender.id) : undefined),
      displayName: asString(sender.login),
      avatarUrl: asString(sender.avatar_url),
    };
    const occurredAt = new Date().toISOString();

    const base = (
      title: string,
      url: string | undefined,
      data: Record<string, unknown>,
    ): CanonicalEvent => ({
      source: SLUG,
      eventType,
      dedupeKey,
      occurredAt,
      title,
      url,
      actor,
      data,
      raw: body,
    });

    if (type === 'pull_request') {
      const pr = asRecord(body.pull_request);
      const num = pr.number;
      const prTitle = asString(pr.title) ?? '';
      const merged = pr.merged === true;
      const subtype =
        action === 'closed'
          ? merged
            ? 'pull_request.merged'
            : 'pull_request.unmerged'
          : undefined;
      const verb = action === 'closed' ? (merged ? 'merged' : 'closed') : action;
      return [
        base(`PR #${num} ${verb}: ${prTitle}`, asString(pr.html_url), {
          prNumber: num,
          merged,
          subtype,
        }),
      ];
    }

    if (type === 'issues') {
      const issue = asRecord(body.issues ?? body.issue);
      const num = issue.number;
      const issueTitle = asString(issue.title) ?? '';
      return [
        base(`Issue #${num} ${action}: ${issueTitle}`, asString(issue.html_url), {
          issueNumber: num,
        }),
      ];
    }

    if (type === 'push') {
      const ref = asString(body.ref) ?? '';
      const branch = ref.replace(/^refs\/heads\//, '');
      const repo = asRecord(body.repository);
      const commits = Array.isArray(body.commits) ? body.commits.length : 0;
      return [
        base(
          `Push to ${asString(repo.full_name) ?? 'repo'}@${branch} (${commits} commit${commits === 1 ? '' : 's'})`,
          asString(repo.html_url),
          { branch, subtype: branch ? `branch:${branch}` : undefined, commits },
        ),
      ];
    }

    // Mapped type header but unmapped action, or an unmapped type → ignore.
    return [];
  },
};
