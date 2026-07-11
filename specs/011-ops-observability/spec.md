# Feature Specification: Ops & Observability

**Feature Branch**: `011-ops-observability` *(not yet created)*

**Status**: 🌱 STUB — outline only. Run `/speckit-specify` on this to elaborate into a full spec.

**Priority**: P3 — operational polish; the hub is already observable via structured logs + health/ready.

**Depends on**: nothing hard; observes the whole system.

**Source**: ARCHITECTURE.md Phase 4 (hardening/ops).

---

## Scope (one paragraph)

The operational hardening bundle from Phase 4: a **metrics endpoint** (delivery counts, failure
rates, latency), **`delivery_log` retention/pruning** (so the table doesn't grow unbounded),
**alerting on repeated `failed`** deliveries (surface a route that's persistently broken), and a
**secret-rotation runbook** (procedural — the ARCHITECTURE "rotate setup-exposed tokens" TODO points
here). Optionally retry/backoff tuning. These are cross-cutting operational concerns rather than
user-facing capability.

## Why it's its own spec

It's the "run it well in production" layer — distinct from feature work, naturally grouped, and low
enough priority that it's explicitly Phase 4. Bundling metrics/pruning/alerting keeps each small piece
from being a fragmented one-off.

## Key open questions (resolve during `/speckit-specify`)

- Metrics format/endpoint (Prometheus-style `/metrics` vs. structured-log-derived).
- Retention policy for `delivery_log` (age-based prune job — may reuse 007 scheduled jobs).
- Alerting channel (post to a Discord channel via the delivery service? external?).

## Out of scope

The durable outbox (010) and any new capability — this is observability/retention/alerting only. The
secret-rotation *runbook* is documentation; the actual one-time rotation of already-exposed tokens is
tracked separately (ARCHITECTURE's deletion-TODO) and should happen independently, sooner.
