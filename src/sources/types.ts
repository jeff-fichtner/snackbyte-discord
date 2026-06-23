/**
 * The inbound source-adapter contract.
 *
 * Every external source (ClickUp, GitHub, ...) implements this interface and registers
 * itself; the HTTP layer is generic and never names a specific source. An adapter does
 * exactly two security-/shape-critical things: verify a request is authentic, and parse
 * a verified body into zero or more canonical events the rest of the system understands.
 */

/** The source-agnostic representation of one occurrence, produced by an adapter's parse. */
export interface CanonicalEvent {
  /** Adapter slug; matches a routes.source value (e.g. "clickup"). */
  source: string;
  /** Source-specific event discriminator, matched exactly against routes.event_type. */
  eventType: string;
  /** Stable per-event id used for de-duplication (provider id, else a body hash). */
  dedupeKey: string;
  /** ISO-8601 occurrence time (provider time if available, else receipt time). */
  occurredAt: string;
  /** Human-readable summary the default transform can render without source knowledge. */
  title: string;
  /** Optional deep link back to the source item. */
  url?: string;
  /** Normalized actor, when the payload identifies who acted. */
  actor?: { id?: string; displayName?: string; avatarUrl?: string };
  /** Arbitrary structured fields a per-route transform may reference. */
  data: Record<string, unknown>;
  /** The validated raw payload, for advanced transforms/debugging (never logged). */
  raw: unknown;
}

/** Inputs an adapter needs to verify a request's authenticity. */
export interface VerifyContext {
  /** Exact received bytes — required for signature/HMAC integrity. */
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  /** The signing secret, resolved from configuration (never from the request). */
  secret: string;
}

/** A source adapter: a slug, plus verify + parse. */
export interface SourceAdapter {
  /** URL slug; the route is POST /webhooks/{slug}. Unique across adapters. */
  readonly slug: string;
  /** Human label for logs/admin. */
  readonly displayName: string;
  /** Verify authenticity. Return false (or throw) to reject before any parsing. */
  verify(ctx: VerifyContext): boolean | Promise<boolean>;
  /** Parse a verified body into 0..N canonical events (empty = intentionally ignored). */
  parse(
    rawBody: Buffer,
    headers: VerifyContext['headers'],
  ): CanonicalEvent[] | Promise<CanonicalEvent[]>;
}
