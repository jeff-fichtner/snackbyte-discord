# Phase 1 Data Model: Bot-REST Delivery Path

This feature adds **no new tables and no column shape changes**. The `discord_targets` table was
forward-built with everything bot-mode needs. The only data-layer change is an optional integrity
CHECK. Below: the entities as they already exist, what bot-mode uses, and the one additive
constraint.

## `discord_targets` (existing — no shape change)

A delivery destination. Already defined in `0001_init.sql` with both modes anticipated.

| Column            | Type        | Bot-mode use | Webhook-mode use |
|-------------------|-------------|--------------|------------------|
| `id`              | uuid PK     | identifier a route points at | same |
| `name`           | text        | operator label | same |
| `mode`            | text        | `'bot'` — selects the bot-REST path | `'webhook'` |
| `guild_id`        | text (null) | **optional** — operator readability + precondition checks | unused |
| `channel_id`      | text (null) | **required** — the channel the bot posts into | unused |
| `webhook_url_ref` | text (null) | unused | required — secret-ref to the channel webhook URL |
| `enabled`         | boolean     | master on/off (already honored by `getTarget`) | same |
| `created_at`      | timestamptz | — | — |

**Existing CHECK**: `mode IN ('webhook','bot')` — already permits `'bot'`. No migration needed to
accept bot rows.

**In-memory shape** (`DeliveryTarget` in `src/routing/types.ts`) — **already** carries
`mode: 'webhook' | 'bot'`, `channelId`, `guildId`, `webhookUrlRef`. `getTarget` in
`pg-repository.ts` already SELECTs and maps all of them. No code change in the repository or types.

### Validation rules

- **Bot-mode target**: `channel_id` MUST be present (it is the addressing required to send,
  FR-002). `guild_id` MAY be present (readability/precondition only). `webhook_url_ref` is ignored.
- **Webhook-mode target**: `webhook_url_ref` MUST be present (unchanged from today). `channel_id`/
  `guild_id` ignored.
- A target whose required field for its mode is missing is a **permanent misconfiguration**: the
  delivery service records a `failed` outcome immediately, no retry (FR-010). The optional migration
  below also rejects it at edit time.

## Migration `0005_targets_mode_integrity.sql` (NEW — additive, optional polish)

Adds a named table CHECK constraint `discord_targets_mode_addressing_chk` enforcing the per-mode
required field at the database, so a half-configured row is rejected in the table editor instead of
failing at delivery time:

```
CHECK ( (mode = 'bot'     AND channel_id      IS NOT NULL)
     OR (mode = 'webhook' AND webhook_url_ref IS NOT NULL) )
```

Additive (a new constraint), runs once via the `schema_migrations` ledger, does not modify existing
valid rows (verified: the only migration-seeded target is the webhook-mode demo row in `0001`, which
satisfies the constraint). Correctness does not depend on it — the runtime validates the same
conditions (research §5) — so it is the lowest-priority, independently-droppable task.

## `routes` (existing — no change)

Unchanged. A route still associates `(source, event_type)` → `target_id` + `transform` + `config`.
The only operator-visible difference is that `target_id` may now point at a bot-mode target.
Switching a route's delivery path is repointing `target_id` (or editing the target's `mode`) — rows
only, no deploy (FR-011).

## `delivery_log` (existing — no change)

Unchanged in shape and outcome set (`ok` / `failed` / `skipped` / `filtered`, the last added in
002). Bot-mode deliveries record outcomes through the same `recordDelivery` path the engine already
uses; `target_id` identifies the target (and thus its mode) for diagnosis. No `mode` column is added
(research §4) — not required by any FR.

## What does NOT change (explicit, to bound implementation)

- No new table. No new column. No change to `routes`, `delivery_log`, `sources`, or any index.
- No change to `DeliveryTarget`, `RouteRecord`, `Repository`, `PgRepository`, or the engine.
- The idempotency model (per-(route, dedupe_key) pre-check + `WHERE status='ok'` partial unique
  index) is reused verbatim for bot-mode deliveries.
