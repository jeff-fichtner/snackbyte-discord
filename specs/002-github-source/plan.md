# Implementation Plan: GitHub source + per-route formatting

**Branch**: `002-github-source` | **Date**: 2026-06-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-github-source/spec.md`

## Summary

Add GitHub as a second inbound source and the per-route formatting layer it exercises, almost
entirely by extending existing 001 seams rather than changing core. A GitHub source adapter
verifies `X-Hub-Signature-256` and parses key events into the existing `CanonicalEvent`, emitting
combined `type.action` discriminators (`pull_request.opened`, `issues.closed`, `push`, …) so the
unchanged exact-match engine routes each action. Named transforms (the transform registry already
exists from 001, currently holding only the default) gain GitHub-appropriate renderers a route
selects by key. Per-route `config` (the existing `routes.config` JSONB) drives operator-tunable
formatting (role mentions, accent color) and an exclusion-list filter; a filtered event is
recorded with a new `filtered` delivery outcome. Everything flows through the existing routing
engine, single delivery service, idempotency, and secrets-by-reference.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), Node 24 — unchanged from 001.

**Primary Dependencies**: No new runtime dependencies. Reuses `express`, `discord.js` (REST for
delivery), `pg`, `pino`, and Node's `crypto` (GitHub HMAC, same as the ClickUp adapter). Vitest +
Supertest for tests.

**Storage**: PostgreSQL (Supabase) via the existing repository. One additive migration:
relax the `delivery_log.status` CHECK to include `'filtered'`. No new tables; the GitHub source +
its routes are data rows (`sources`, `routes`, `discord_targets`), added like any other.

**Testing**: Vitest + Supertest. Unit: GitHub adapter (verify happy/tamper/missing; parse each
mapped event → canonical with `type.action`); the new named transform(s); filter evaluation;
engine filter→`filtered` path. Integration: webhook endpoint for `/webhooks/github`
(202/401/unhandled-event), source isolation (ClickUp unaffected).

**Target Platform**: Same single always-on Cloud Run service; no topology change.

**Project Type**: Web service + gateway bot (one process) — unchanged.

**Performance Goals**: A matched GitHub event appears in Discord within a few seconds (SC-002);
route lookup remains a single indexed exact-match query (the `type.action` discriminator keys the
same index, so granularity does not change the query shape).

**Constraints**: Verify-before-process on the raw body; secrets by reference
(`sources.secret_ref` → env, the source-agnostic path already built in 001); all delivery through
the one chokepoint; filtering must record an auditable `filtered` outcome, not silently drop.

**Scale/Scope**: One new source (GitHub), a small initial set of mapped events, 1–2 named
transforms, and the per-route filter/format config. Low event volume.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against snackbyte-discord Constitution v1.0.0:

| Principle | Gate for this feature | Status |
|-----------|-----------------------|--------|
| I. Patterns Over Instances | GitHub is a new `SourceAdapter` registered at the one wiring point; named transforms are registry modules a route selects by key. Core never branches on "github". Adding the source/transforms touches only the ★ extension folders. | ✅ PASS |
| II. Verify Before Process | GitHub adapter verifies `X-Hub-Signature-256` (constant-time) against the source's `secret_ref` before any parse; failure → 401, no dispatch. Reuses the source-agnostic verify path (`getSourceRecord` → `resolveSecret`) from 001. | ✅ PASS |
| III. Idempotent, Rate-Limited Delivery | GitHub deliveries go through the existing single delivery service; per-(route, dedupeKey) idempotency unchanged; the `filtered` outcome short-circuits *before* delivery (records, sends nothing) — it does not add a second delivery path. | ✅ PASS |
| IV. Runtime-Mutable Routing, Compile-Time-Safe Logic | GitHub routes, transform selection, and per-route filter/format config are all DB rows (no deploy). Verify/parse/transform/filter logic is typed, tested code. | ✅ PASS |
| V. Pinned, Typed, Tested + Speckit-in-Speckit | Node 24, strict TS, `check:all` stays green; shipped code uses named rules, no FR/spec citations. | ✅ PASS |
| VI. Always-On Resilience | No change to liveness/readiness or degradation; a malformed GitHub payload is a 400 isolated to that request; source isolation (FR-019) keeps a GitHub fault from affecting ClickUp. | ✅ PASS |
| VII. Secrets By Reference | GitHub signing secret stored as `sources.secret_ref` → env var, never in rows/logs/git, exactly like ClickUp. | ✅ PASS |

**One nuance to record (not a violation):** the spec's FR-006 says adding GitHub must not change
the routing engine. True for the *source* path. The new **`filtered` outcome** does add one step
to the engine (evaluate the route's filter → record `filtered` + skip delivery). This is a
*routing-policy* change applicable to all sources, not GitHub-specific logic, so it honors
Patterns Over Instances (no source-name branching). It is the only core touch in this feature and
is called out here for transparency.

**Result**: PASS — no violations, no Complexity Tracking entries required. (Re-checked after
Phase 1 below: still PASS.)

## Project Structure

### Documentation (this feature)

```text
specs/002-github-source/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── inbound-webhook-github.md   # POST /webhooks/github contract (delta to the generic one)
│   └── formatting-config.md        # named-transform selection + route config (format + filter) shape
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

Extends the existing 001 tree. **New** files marked `NEW`; everything else is reused unchanged
except the few precise edits noted. The ★ folders are the extension points 001 established.

```text
snackbyte-discord/
├── migrations/
│   └── 0004_delivery_log_filtered_status.sql   # NEW: relax status CHECK to add 'filtered'
├── src/
│   ├── sources/
│   │   ├── index.ts                # EDIT: one line — registerSource(githubAdapter)
│   │   └── github/
│   │       └── adapter.ts          # NEW: verify (X-Hub-Signature-256) + parse → CanonicalEvent (type.action)
│   ├── routing/
│   │   ├── engine.ts               # EDIT: evaluate per-route filter → record 'filtered' + skip; else as today
│   │   ├── filter.ts               # NEW: pure function — does this event pass the route's exclusion list?
│   │   └── transforms/
│   │       ├── github.ts           # NEW: named transform(s) for GitHub events (reads CanonicalEvent.data)
│   │       └── index.ts            # EDIT: register the GitHub named transform(s)
│   ├── db/
│   │   ├── repository.ts           # EDIT: DeliveryRecordInput status union adds 'filtered'
│   │   └── pg-repository.ts        # (no change — INSERT already passes status through)
│   └── routing/transforms/default.ts  # (reused; config-driven mentions/color may be factored into a shared helper)
└── tests/
    ├── app/github-webhook.test.ts          # NEW: 202 / 401 / unhandled-event / source-isolation
    └── machinery/
        ├── github-adapter.test.ts          # NEW: verify + parse per mapped event
        ├── github-transform.test.ts        # NEW: render + per-route config (mention/color)
        └── route-filter.test.ts            # NEW: exclusion-list filter + 'filtered' outcome in engine
```

**Structure Decision**: Pure extension of the 001 layout — no new top-level structure. The only
core edits are the additive `filtered` status (interface + migration) and the engine's filter
step; all source- and format-specific work lands in the existing ★ extension folders
(`sources/`, `routing/transforms/`). Per-route formatting/filter settings reuse the existing
`routes.config` JSONB (no schema change there).

## Complexity Tracking

No constitution violations; no justifications required. (Table omitted.)
