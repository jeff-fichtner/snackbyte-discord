# Phase 1 Data Model: GitHub source + per-route formatting

This feature adds **no new tables**. It (a) adds rows to the existing `sources` / `routes` /
`discord_targets` tables (data, not schema), (b) makes one additive change to `delivery_log`
(a new allowed `status` value), and (c) defines the formatting/filter keys read from the existing
`routes.config` JSONB. Reference: the 001 schema in `specs/001-walking-skeleton/data-model.md` and
`migrations/0001..0003`.

## Schema change (one additive migration)

### `delivery_log.status` — add `'filtered'`

001's `delivery_log.status` is `CHECK (status IN ('ok','failed','skipped'))`. Migration `0004`
relaxes it to include `'filtered'`:

```sql
ALTER TABLE delivery_log DROP CONSTRAINT IF EXISTS <existing status check>;
ALTER TABLE delivery_log ADD CONSTRAINT delivery_log_status_check
  CHECK (status IN ('ok','failed','skipped','filtered'));
```

(The exact prior constraint name is discovered at implementation; the migration is additive and
idempotent.) The partial idempotency index — `(route_id, dedupe_key) WHERE status='ok'`,
introduced in migration `0002` (not `0001`) — is unaffected, so `filtered` rows coexist freely;
no change to idempotency.

| Outcome | Meaning |
|---|---|
| `ok` | Delivered to Discord successfully. |
| `failed` | Delivery attempted and failed after retries. |
| `skipped` | Duplicate of an already-`ok` (route, event) — suppressed by idempotency. |
| **`filtered`** (new) | Suppressed by the route's per-route filter before delivery — intentional, not a failure or duplicate. |

## Data rows (no schema change)

### `sources` — add the GitHub row

| Column | Value for GitHub |
|---|---|
| `slug` | `github` (matches the code adapter slug + `CanonicalEvent.source`) |
| `display_name` | `GitHub` |
| `enabled` | `true` |
| `secret_ref` | `github_webhook_secret` (→ env `GITHUB_WEBHOOK_SECRET`; the value never in the row) |

### `routes` — GitHub routes (operator data)

Standard `routes` rows; nothing structural changes. `event_type` holds the `type.action`
discriminator; `transform` optionally names a GitHub transform; `config` carries
formatting/filtering. Example shape (illustrative):

| Column | Example |
|---|---|
| `source` | `github` |
| `event_type` | `pull_request.opened` |
| `target_id` | (an existing `discord_targets` id) |
| `transform` | `github` (or `null` → default) |
| `config` | `{ "mentionRoleIds": ["..."], "accentColor": 5814783, "excludeSubtypes": [] }` |
| `enabled` | `true` |

The `routes (source, event_type, target_id)` natural-key unique index (from 001 migration 0003)
applies unchanged — re-seeding a GitHub route is idempotent.

### `routes.config` keys defined by this feature

Read from the existing JSONB column; all optional, absent = default behavior (so existing ClickUp
routes are unaffected). Canonical key list lives in
[contracts/formatting-config.md](./contracts/formatting-config.md).

| Key | Type | Effect |
|---|---|---|
| `mentionRoleIds` | string[] | Role ids to mention in the delivered message. |
| `accentColor` | number | Embed accent color. |
| `excludeSubtypes` | string[] | Values matched against the event's normalized `data.subtype`; a match suppresses the event for this route → recorded `filtered`. |

## In-memory shapes (extended, not replaced)

### `CanonicalEvent` (reused as-is)

GitHub's adapter produces the **same** `CanonicalEvent` shape from 001. GitHub specifics ride in
the existing `data: Record<string, unknown>` field (e.g. `{ merged: true, branch, prNumber,
labels }`) — **no new top-level canonical fields** (keeps the shared contract lean; transforms and
filters read `data`).

| Field | GitHub population |
|---|---|
| `source` | `github` |
| `eventType` | `type.action` (e.g. `pull_request.opened`, `push`) |
| `dedupeKey` | the `X-GitHub-Delivery` GUID (body hash fallback) |
| `occurredAt` | provider timestamp if present, else receipt time |
| `title` | human summary (e.g. "PR #123 opened: Fix login") |
| `url` | the item's `html_url` |
| `actor` | sender login / avatar |
| `data` | GitHub-specific extras for transforms/filters, incl. a normalized `subtype` string the per-route filter matches against (e.g. `pull_request.merged`, `pull_request.unmerged`, `branch:main`), plus extras like `prNumber`, `labels` |
| `raw` | validated raw payload (never logged) |

### Delivery record input (extended status union)

The repository's `DeliveryRecordInput.status` union grows from `'ok' | 'failed' | 'skipped'` to
include `'filtered'`. No other change to the record shape.

## Lifecycle / state

- **GitHub source**: registered in code (fixed event vocabulary); enabled/struck per the
  `sources.enabled` flag at runtime.
- **Delivery attempt** for a GitHub (route, event): `ok` | `failed` | `skipped` | `filtered` —
  terminal, one row per outcome; `filtered` is decided *before* any Discord call.

## Seed / setup note

No seed change required by the migration. Operators add the `github` source row, GitHub routes,
and config through the store's editor (same surface as ClickUp). A quickstart seed example is in
[quickstart.md](./quickstart.md).
