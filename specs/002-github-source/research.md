# Phase 0 Research: GitHub source + per-route formatting

The hub's patterns were established in 001 and the spec's clarifications settled the two
materially-impactful design questions (the `filtered` outcome and the `type.action`
discriminator). This document records the decisions in Decision / Rationale / Alternatives form
and resolves the GitHub-specific implementation details. No unresolved NEEDS CLARIFICATION items.

## R1 — GitHub as an instance of the existing source-adapter pattern

- **Decision**: Implement GitHub as a `SourceAdapter` (`slug='github'`) registered at the single
  wiring point (`src/sources/index.ts`), reusing the generic `POST /webhooks/:source` route, the
  routing engine, the delivery service, idempotency, and the source-agnostic secret resolution
  (`getSourceRecord` → `resolveSecret`) built in 001.
- **Rationale**: The adapter is the only legitimately per-source surface (verify + parse);
  everything downstream is source-agnostic. This keeps the engine/delivery/dedup untouched
  (FR-006) and proves the pattern generalizes — the point of the feature.
- **Alternatives**: A GitHub-specific route or branching in core — rejected; would violate
  Patterns Over Instances and defeat the exercise.

## R2 — GitHub signature verification (`X-Hub-Signature-256`)

- **Decision**: Verify the `X-Hub-Signature-256` header — value is `sha256=` + HMAC-SHA256 of the
  **raw request body** keyed by the webhook's secret — using a constant-time comparison; reject
  with 401 before any parsing. Reuse the raw-body capture already mounted on `/webhooks/*`. The
  secret comes from `sources.secret_ref` → env (`GITHUB_WEBHOOK_SECRET`).
- **Rationale**: This is GitHub's documented webhook scheme. It is structurally identical to the
  ClickUp adapter's HMAC verify (constant-time, raw-body), so the same proven approach applies —
  only the header name and the `sha256=` prefix differ. Honors Verify Before Process + Secrets By
  Reference.
- **Alternatives**: The older `X-Hub-Signature` (SHA-1) — rejected; deprecated and weaker. IP
  allow-listing — rejected; weaker and brittle.
- **Note for implementation**: strip the `sha256=` prefix before comparing; verification operates
  on the exact received bytes (the constant-time compare helper from 001 generalizes).

## R3 — Event-type discriminator: combined `type.action`

- **Decision**: The adapter emits `eventType` as `type.action` (e.g. `pull_request.opened`,
  `pull_request.closed`, `issues.opened`, `issues.closed`, `push`). GitHub's event *type* comes
  from the `X-GitHub-Event` header; the *action* from the payload's `action` field (absent for
  events like `push`, which are then just the type).
- **Rationale**: Lets operators route each action as its own `routes` row through the unchanged
  exact-match lookup; scale lives in cheap runtime-editable rows, not code (spec clarification).
  Keeps the routing query shape and index identical to 001.
- **"merged" handling**: GitHub has no `merged` action — a merged PR arrives as
  `pull_request.closed` with `pull_request.merged: true` in the payload. The adapter maps this to
  the `pull_request.closed` discriminator and exposes `merged` in `CanonicalEvent.data` so a
  transform/filter can distinguish merged-vs-just-closed. (Alternative — minting a synthetic
  `pull_request.merged` discriminator — rejected: it diverges from GitHub's own vocabulary and
  would surprise operators writing routes; data-driven distinction is cleaner.)
- **Alternatives**: type-only discriminator (`pull_request`) with action via config — rejected;
  coarser, pushes action-routing into config. (See spec clarification.)

## R4 — Initial mapped event set

- **Decision**: Map `pull_request` (opened, closed — incl. merged via `data`), `issues` (opened,
  closed), and `push`. All other GitHub event types (and the `ping` GitHub sends on webhook
  creation) are accepted with 202 and produce no canonical event (accept-without-acting, FR-005).
- **Rationale**: Covers the common, high-signal repo activity; small enough to ship and test
  thoroughly; extending the set later is adding cases to the adapter's `parse` (no core change).
- **Canonical mapping per event**: `title` = a human summary (e.g. "PR #123 opened: <title>"),
  `url` = the item's `html_url`, `actor` = the sender's login/avatar, `dedupeKey` = GitHub's
  delivery id (`X-GitHub-Delivery`, a UUID) — stable and unique per delivery. Body-hash fallback
  only if the header is somehow absent (consistent with 001).

## R5 — De-duplication key

- **Decision**: Use the `X-GitHub-Delivery` GUID as the `dedupeKey` (prefixed by event type for
  clarity, e.g. `github:pull_request.opened:<guid>` is unnecessary — the guid is globally unique;
  use it directly). Falls back to a body hash if absent.
- **Rationale**: GitHub guarantees a unique delivery id per webhook delivery and re-sends it on
  redelivery, which is exactly an idempotency key. Reuses the existing per-(route, dedupeKey)
  unique guarantee — no mechanism change.
- **Alternatives**: hashing the payload always — works but the provider id is stronger and
  cheaper; use it when present.

## R6 — Named transforms (registry already exists)

- **Decision**: Add one (or a small number of) GitHub-oriented named transform(s) under
  `src/routing/transforms/`, registered in the transforms `index.ts`. A route selects it via the
  existing `routes.transform` key; `null` still means the default transform.
- **Rationale**: The transform registry (`registerTransform`/`resolveTransform`) shipped in 001
  and already supports named lookup with default fallback — 002 simply populates it. GitHub events
  benefit from source-specific rendering (PR/issue/push read differently), which lives in the
  transform reading `CanonicalEvent.data`, not in core or the adapter.
- **Alternatives**: one mega-transform branching on event type internally vs. several small named
  transforms — a single GitHub transform that switches on `eventType`/`data` is acceptable and
  simplest; the registry permits splitting later if it grows. Keep `CanonicalEvent` lean — GitHub
  specifics ride in `data`, never as new top-level canonical fields.

## R7 — Per-route config: formatting + exclusion-list filtering

- **Decision**: Read formatting + filtering settings from the existing `routes.config` JSONB.
  Formatting keys (initial): `mentionRoleIds` (array of role ids to ping) and `accentColor`
  (embed color). Filtering: `excludeSubtypes` (array) — if the event's subtype is listed, the
  route is suppressed. Empty/absent config = current default behavior. Exact key names are
  finalized in `contracts/formatting-config.md`.
- **Rationale**: Reuses the route's existing config field (no schema change); one named transform
  serves many routes via differing config (FR-014); filtering is a routing-policy decision applied
  before delivery. Absent keys degrade to today's behavior, so existing ClickUp routes are
  unaffected (no regression, SC-007).
- **"subtype" definition**: since the discriminator already encodes `type.action`, the filter
  operates on a finer attribute carried in `data` (e.g. a specific label, branch, or the
  merged-vs-closed distinction) OR on the action itself when a route matched a coarser type. For
  the initial scope, `excludeSubtypes` filters on values the transform/adapter expose in `data`
  (e.g. exclude `push` to non-default branches). Kept deliberately small; extensible later.
- **Alternatives**: a dedicated filter table/columns — rejected; the JSONB config is the
  established runtime-mutable surface and avoids schema churn.

## R8 — The `filtered` delivery outcome

- **Decision**: Add `'filtered'` to the `delivery_log.status` set via an additive migration
  (`0004`) that relaxes the CHECK constraint; extend the repository's status union; have the
  engine record `filtered` (and skip delivery) when a route's filter suppresses an event.
- **Rationale**: Makes intentional suppression auditable and distinct from duplicate/failure
  (spec clarification + FR-013/018). Additive and idempotent, consistent with how 001's schema
  evolved (migrations 0002/0003). Note the partial idempotency index is `WHERE status='ok'`, so
  `filtered` rows coexist freely (same reason `skipped`/`failed` do).
- **Alternatives**: reuse `skipped` with a reason — rejected; overloads one status with two
  meanings, weakening the audit signal. Record nothing — rejected; violates FR-013's
  auditability.

## R9 — Source isolation

- **Decision**: No special work needed — isolation falls out of the architecture. Each inbound
  request is handled by its own adapter; a GitHub parse error is a 400 confined to that request;
  routes are independent. A unit/integration test asserts ClickUp continues to work with GitHub
  registered (FR-019, SC-007).
- **Rationale**: The registry + per-route independent dispatch already isolate sources; this is a
  property to *verify*, not build.
