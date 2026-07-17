# Feature Specification: Durable Delivery Outbox

**Feature Branch**: `016-delivery-outbox` *(not yet created)*

**Status**: 🌱 STUB — outline only. Run `/speckit-specify` on this to elaborate into a full spec.

**Priority**: P2 — closes a known correctness gap; matters more as inbound volume/criticality grows.

**Depends on**: the existing routing → delivery pipeline and `delivery_log`.

**Source**: ARCHITECTURE.md Phase 4 + §5 open question 1 ("durable outbox?").

---

## Scope (one paragraph)

Close the **acknowledge-then-deliver crash window**. Today the hub acknowledges an inbound webhook and
delivers to Discord in-process; a crash (or Discord downtime) between the ack and a successful delivery
can lose the event, since the provider was already told "202 accepted." Add a **DB-backed outbox**: an
inbound event is durably recorded as `pending` before ack, a worker drains the outbox to Discord with
the existing idempotent/rate-limited delivery service, and an entry is only marked done on confirmed
delivery — so a crash resumes from the outbox instead of dropping the event. Affects `delivery_log`
(a `pending`/retry-count column) per the ARCHITECTURE note.

## Why it's its own spec

It changes the **delivery reliability model** (store-and-forward vs. in-process), touching the
inbound-ack contract and `delivery_log` schema. It's a hardening feature independent of bot depth, and
the ARCHITECTURE doc explicitly parks it in Phase 4 as a deliberate later trade-off.

## Key open questions (resolve during `/speckit-specify`)

- Outbox table vs. reusing `delivery_log` with a `pending` state + retry count.
- Drain worker: in-process on the always-on instance (fits the current topology) vs. external.
- Interaction with the current retry/backoff — the outbox generalizes it.
- Ordering guarantees (if any) vs. at-least-once + idempotency (the likely model).

## Out of scope

General ops/observability (metrics, alerting, log pruning) — that's 017; this is specifically the
durability/outbox mechanism.
