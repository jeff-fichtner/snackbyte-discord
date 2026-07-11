# Feature Specification: Stateful Infrastructure — bot_state/kv & Scheduled Jobs

**Feature Branch**: `007-stateful-infra` *(not yet created)*

**Status**: 🌱 STUB — outline only. Run `/speckit-specify` on this to elaborate into a full spec.

**Priority**: P1 among the remaining work — it unblocks 008 (infractions) and any future stateful feature.

**Depends on**: nothing new (extends the existing repository/DB layer).

**Unlocks**: 008 (infractions system), and any capability needing durable per-guild state.

---

## Scope (one paragraph)

Add the hub's first general **persistent bot-owned state**, deliberately kept out of every prior
feature so those stayed stateless. Two pieces: (1) **`bot_state`/kv** — a free-form per-guild
key/value store the bot can read/write, the general persistence primitive for config and feature
state that doesn't warrant its own table; and (2) **scheduled jobs** — cron-like scheduled actions
that reuse the existing single delivery service (e.g. recurring posts, scheduled unbans), so the
delivery chokepoint and its idempotency/rate-limit guarantees still apply. Scheduled jobs may store
their schedule + state in the kv layer, so kv is built first.

## Why it's its own spec

It introduces a **new architectural primitive** (durable, general-purpose bot state) that several
later features build on. Bundling it into a bot-interaction feature (like 006) would mix a storage
concern with an interaction concern. Sequenced before 008 because the infractions system needs this
store.

## Key open questions (resolve during `/speckit-specify`)

- kv shape: one `bot_state (guild_id, key, value jsonb, updated_at)` table vs. typed tables per
  consumer. Generic-kv is the likely default (matches the "free-form" intent).
- Scheduling mechanism: an in-process scheduler on the always-on instance vs. an external trigger.
  Must respect always-on resilience (a crash re-establishes pending jobs) and idempotent delivery.
- Whether scheduled jobs are operator-editable runtime data (like routes) — almost certainly yes.

## Out of scope

The infractions system itself (008) — this spec provides the store, not the moderation-records
feature built on it.
