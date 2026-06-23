# Phase 1 Data Model: Walking Skeleton

Derives the spec's Key Entities into concrete storage (PostgreSQL) and the in-memory canonical
event. Persisted tables map to `migrations/0001_init.sql`. Times are `timestamptz`. UUID keys
use `gen_random_uuid()`. Secrets are stored by reference only (Principle VII).

## Persisted tables

### `sources`

Recognized inbound sources. The authoritative list of source _types_ is the code adapter
registry; rows control operational enablement and hold the secret reference.

| Column         | Type          | Constraints / Notes                                           |
|----------------|---------------|--------------------------------------------------------------|
| `slug`         | `text`        | PK. Matches a code adapter's slug and `CanonicalEvent.source` (e.g. `clickup`). |
| `display_name` | `text`        | NOT NULL. Human label for admin/logs.                        |
| `enabled`      | `boolean`     | NOT NULL DEFAULT true. Master kill-switch for the source.    |
| `secret_ref`   | `text`        | Reference name of the signing secret in the secret manager — **never the secret value**. |
| `created_at`   | `timestamptz` | NOT NULL DEFAULT now().                                       |

### `discord_targets`

Where a message can be delivered. This slice uses `mode = 'webhook'`; `'bot'` is accepted by
the schema for a later feature.

| Column            | Type          | Constraints / Notes                                       |
|-------------------|---------------|----------------------------------------------------------|
| `id`              | `uuid`        | PK DEFAULT gen_random_uuid().                            |
| `name`           | `text`        | NOT NULL. Operator-facing label (e.g. "eng-alerts").     |
| `mode`            | `text`        | NOT NULL CHECK (mode IN ('webhook','bot')).             |
| `guild_id`        | `text`        | NULL. Discord server id (used in bot mode).             |
| `channel_id`      | `text`        | NULL. Required when mode='bot' (later).                 |
| `webhook_url_ref` | `text`        | Reference name of the channel webhook URL secret; required when mode='webhook'. **Not the URL itself.** |
| `enabled`         | `boolean`     | NOT NULL DEFAULT true.                                   |
| `created_at`      | `timestamptz` | NOT NULL DEFAULT now().                                  |

Application-level rule (also checked in code): `mode='webhook'` ⇒ `webhook_url_ref` present;
`mode='bot'` ⇒ `channel_id` present.

### `routes`

The operator-editable routing table — the primary thing operators add and strike.

| Column       | Type          | Constraints / Notes                                                    |
|--------------|---------------|----------------------------------------------------------------------|
| `id`         | `uuid`        | PK DEFAULT gen_random_uuid().                                        |
| `source`     | `text`        | NOT NULL REFERENCES sources(slug). Match key.                        |
| `event_type` | `text`        | NOT NULL. Exact event-type match this slice (e.g. `taskStatusUpdated`); modeled to allow a future catch-all value without restructuring. |
| `target_id`  | `uuid`        | NOT NULL REFERENCES discord_targets(id). Destination.               |
| `transform`  | `text`        | NULL. Named transform key in the code registry; NULL = default transform. |
| `config`     | `jsonb`       | NOT NULL DEFAULT '{}'. Per-route knobs (e.g. mention roles, embed color). |
| `enabled`    | `boolean`     | NOT NULL DEFAULT true. "Strike" = set false or delete.              |
| `priority`   | `int`         | NOT NULL DEFAULT 0. Tie-break/order when several routes match (fan-out is still to all). |
| `created_at` | `timestamptz` | NOT NULL DEFAULT now().                                              |

Indexes:

- Hot lookup path: `CREATE INDEX ON routes (source, event_type) WHERE enabled;`
- Natural-key uniqueness (added in migration `0003`): `CREATE UNIQUE INDEX ON routes (source, event_type, target_id);` — a source's event maps to a given target at most once, so re-running the seed is idempotent and accidental duplicate fan-out is prevented.

### `delivery_log`

Audit trail and de-duplication ledger. One row per (route, event) delivery attempt outcome.

| Column        | Type          | Constraints / Notes                                                   |
|---------------|---------------|---------------------------------------------------------------------|
| `id`          | `uuid`        | PK DEFAULT gen_random_uuid().                                        |
| `route_id`    | `uuid`        | REFERENCES routes(id). Which route produced this.                   |
| `source`      | `text`        | NOT NULL. Denormalized for fast filtering.                          |
| `event_type`  | `text`        | NOT NULL.                                                           |
| `dedupe_key`  | `text`        | NOT NULL. From `CanonicalEvent.dedupeKey`.                          |
| `target_id`   | `uuid`        | REFERENCES discord_targets(id).                                    |
| `status`      | `text`        | NOT NULL CHECK (status IN ('ok','failed','skipped')).             |
| `error`       | `text`        | NULL. Redacted reason on failure.                                  |
| `created_at`  | `timestamptz` | NOT NULL DEFAULT now().                                            |

**Idempotency constraint** (partial, refined in migration `0002`): `UNIQUE (route_id,
dedupe_key) WHERE status = 'ok'`. Scoping it to `ok` keeps the real guarantee — a given event
is delivered to a given route at most once — while letting `skipped` and `failed` audit rows
coexist for the same key. A second attempt for an already-delivered (route, event) is recorded
as `skipped` rather than re-posting (FR-013); the partial index is what lets that skip row
persist instead of colliding with the `ok` row.

## In-memory types (not persisted)

### `CanonicalEvent`

The source-agnostic representation the routing engine and transforms consume. Produced by a
source adapter's `parse`; never stored as a table (the audit lives in `delivery_log`).

| Field        | Type                                   | Notes                                              |
|--------------|----------------------------------------|----------------------------------------------------|
| `source`     | string                                 | Adapter slug; matches `routes.source`.            |
| `eventType`  | string                                 | Discriminator; matched exactly against `event_type`. |
| `dedupeKey`  | string                                 | Stable per-event id (provider id, else body hash). |
| `occurredAt` | string (ISO-8601)                      | Provider time if available, else receipt time.    |
| `title`      | string                                 | Human summary used by the default transform.      |
| `url`        | string \| undefined                    | Deep link back to the source item.                |
| `actor`      | { id?, displayName?, avatarUrl? } \| undefined | Who acted, when the payload identifies it. |
| `data`       | Record<string, unknown>                | Structured fields a transform may reference.      |
| `raw`        | unknown                                | Validated raw payload, for advanced transforms/debug. |

### `RouteRecord`

In-memory shape of a `routes` row used by the engine (mirrors the table columns: `id`,
`source`, `eventType`, `targetId`, `transform | null`, `config`, `enabled`, `priority`).

## Relationships

```text
sources (1) ──< routes >── (1) discord_targets
                  │
                  └──< delivery_log >── discord_targets
```

- A `route` belongs to one `source` (FK) and points at one `discord_target` (FK).
- A `delivery_log` row references the `route` and `target` it concerns (de-normalized
  `source`/`event_type` for querying).
- An event may match many routes (fan-out); each match yields its own delivery + log row.

## Lifecycle / state

- **Route**: created (enabled) → optionally disabled (struck) → optionally re-enabled or
  deleted. All operator-driven, runtime, no deploy (FR-007).
- **Delivery attempt**: `ok` (delivered), `failed` (Discord unreachable after bounded retries),
  or `skipped` (duplicate per the unique constraint). Terminal; one row per attempt outcome.

## Seed data (for the walking-skeleton demo)

`0001_init.sql` (or a separate seed) inserts: one `sources` row (`clickup`), one
`discord_targets` row (`mode='webhook'`, a `webhook_url_ref`), and one enabled `routes` row
mapping `clickup` + a chosen event type → that target. This makes US1/US2 demonstrable
immediately; operators thereafter add/strike rows via the store's editor (US2).
