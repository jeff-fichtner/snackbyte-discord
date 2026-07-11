# Feature Specification: Moderation Records — Warnings & Infractions System

**Feature Branch**: `008-infractions-system` *(not yet created)*

**Status**: 🌱 STUB — outline only. Run `/speckit-specify` on this to elaborate into a full spec.

**Priority**: P2 — the stateful completion of moderation; valuable but gated on 007.

**Depends on**: **007** (needs the durable per-guild store) and **006** (the stateless sanctions it records/escalates to).

---

## Scope (one paragraph)

The **stateful** moderation layer deferred out of 006 because it needs durable bot-owned records.
Add a per-member **infraction history**: issue a warning (a record, not a platform action), view a
member's infraction history, and a **modlog** channel where the bot durably records every moderation
action (from 006's sanctions and from warnings here). On top of that: **auto-escalation** (e.g. N
warnings → an automatic timeout/kick per an operator-configured policy) and **auto-expiring
temp-bans** (a ban that the bot lifts after a duration — needs scheduled jobs from 007). All of this
requires a store, which is exactly why it waits for 007.

## Why it's its own spec

006 drew its boundary at "no new durable store." This is everything on the other side of that line —
a coherent moderation-records feature rather than scattered stateful bits grafted onto 006. It reuses
006's sanction capabilities (the escalation *actions*) and 007's store + scheduler (the *records* and
*timers*).

## Key open questions (resolve during `/speckit-specify`)

- Record model: infractions table shape (member, type, moderator, reason, timestamp, expiry).
- Escalation policy: operator-configured thresholds (runtime data) vs. fixed.
- Modlog: one channel per guild, configured how (a `discord_targets`-style row? kv?).
- Temp-ban expiry: a scheduled job (007) that unbans, resilient across restarts.

## Out of scope

The stateless sanctions themselves (in 006) and the kv/scheduler primitive (in 007) — this spec
consumes both.
