---
description: 'Task list for the GitHub-source + per-route formatting feature'
---

# Tasks: GitHub source + per-route formatting

**Input**: Design documents from `/specs/002-github-source/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md.
Builds on the shipped 001 walking skeleton (source registry, routing engine, delivery service,
transform registry, repository, secrets-by-reference).

**Tests**: Included — the spec/plan/quickstart call for Vitest + Supertest coverage and
Principle V requires `check:all` (which runs tests) to stay green. Scoped to the GitHub adapter,
the transform/config, the filter path, the webhook endpoint, and a no-regression check.

**Organization**: Grouped by user story (spec priority US1 → US2 → US3). Almost all work lands in
the existing ★ extension folders; the only core touches are the additive `filtered` status and one
engine filter step.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- File paths are exact and relative to repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration wiring for the new source. No new dependencies.

- [ ] T001 Add `GITHUB_WEBHOOK_SECRET` to `.env.example` (name only, no value) and append it to the `KEYS=( … )` array in `scripts/set-secrets.sh` (the array the script iterates to push secrets) so it ships to prod/staging.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared schema + type changes the stories build on. The `filtered` status is used
only by US3, but the migration + type union are foundational so the codebase is consistent and
`check:all` stays green throughout.

**⚠️ CRITICAL**: Complete before the user-story phases.

- [ ] T002 Create `migrations/0004_delivery_log_filtered_status.sql`: drop the existing `delivery_log` status CHECK and re-add it as `CHECK (status IN ('ok','failed','skipped','filtered'))` (additive, idempotent; the partial idempotency index `WHERE status='ok'` is unaffected). Per data-model.md.
- [ ] T003 Extend `DeliveryRecordInput.status` in `src/db/repository.ts` to the union `'ok' | 'failed' | 'skipped' | 'filtered'` (no change needed in `src/db/pg-repository.ts` — the INSERT passes status through).

**Checkpoint**: Schema + types accept `filtered`; nothing emits it yet.

---

## Phase 3: User Story 1 - GitHub activity reaches the right Discord channel (Priority: P1) 🎯 MVP

**Goal**: A verified GitHub event is parsed into a canonical event (with a `type.action`
discriminator) and delivered to the routed Discord channel through the existing pipeline, deduped
and recorded — with no change to the routing engine, delivery, or dedup.

**Independent Test**: Register the `github` source + a `pull_request.opened` route, POST a signed
GitHub payload to `/webhooks/github`, confirm a message in the channel + an `ok` `delivery_log`
row; resend (same delivery id) → `skipped`; bad signature → `401`.

### Tests for User Story 1

- [ ] T004 [P] [US1] Unit-test the GitHub adapter in `tests/machinery/github-adapter.test.ts`: valid `X-Hub-Signature-256` passes, tampered/missing fails (constant-time, `sha256=` prefix stripped), and `parse` yields a correct `CanonicalEvent` per mapped event — `type.action` discriminator, title, `html_url`, `X-GitHub-Delivery` dedupe key, merged-PR exposes `merged` in `data`.
- [ ] T005 [P] [US1] Integration-test the endpoint in `tests/app/github-webhook.test.ts` (Supertest over `createApp()`): `202` signed happy path, `401` bad signature, `202` for `ping`/unmapped event and for no-matching-route, per the github inbound contract.
- [ ] T006 [P] [US1] Source-isolation test (in `tests/app/github-webhook.test.ts` or a sibling): with both sources registered, a ClickUp request still verifies + routes and a GitHub fault does not affect it (FR-019, SC-007).

### Implementation for User Story 1

- [ ] T007 [US1] Create `src/sources/github/adapter.ts`: a `SourceAdapter` (`slug='github'`) — `verify` (HMAC-SHA256 of raw body vs `X-Hub-Signature-256`, strip `sha256=`, constant-time) and `parse` (map `pull_request` opened/closed [merged via `data`], `issues` opened/closed, `push`; unmapped/ping → `[]`) → `CanonicalEvent` with `eventType = type.action`, dedupeKey = `X-GitHub-Delivery`. The adapter MUST also write a single normalized `data.subtype` string per event (the value the per-route filter matches against — see T014); initial vocabulary: `pull_request.merged` and `pull_request.unmerged` (for the two `pull_request.closed` cases), and for `push` the branch ref (e.g. `branch:main`). Events with no meaningful subtype omit it.
- [ ] T008 [US1] Register the GitHub adapter in `src/sources/index.ts` (one `registerSource(githubAdapter)` line — the only wiring change).

**Checkpoint**: A real GitHub event reaches a Discord channel via a DB-driven route, deduped and
recorded — US1 functional and independently testable. (Renders via the default transform until
US2.)

---

## Phase 4: User Story 2 - An operator chooses how each route is formatted (Priority: P2)

**Goal**: A route can select a named GitHub transform; no selection → default; a missing name →
default (no failed delivery).

**Independent Test**: Two routes for the same event — one `transform='github'`, one unset — each
channel receives its respectively-styled message; point a route at a non-existent transform → it
still delivers in the default style.

### Tests for User Story 2

- [ ] T009 [P] [US2] Unit-test the GitHub transform in `tests/machinery/github-transform.test.ts`: renders PR/issue/push canonical events into a Discord message (summary + link), reading source specifics from `CanonicalEvent.data`; and the registry returns the default for a null/unknown transform key (reuses existing `resolveTransform` behavior).

### Implementation for User Story 2

- [ ] T010 [US2] Create `src/routing/transforms/github.ts`: a named `Transform` rendering GitHub events (switch on `eventType`/`data`; keep `CanonicalEvent` lean — read specifics from `data`).
- [ ] T011 [US2] Register the GitHub transform in `src/routing/transforms/index.ts` (`registerTransform('github', githubTransform)`).

**Checkpoint**: GitHub routes can render GitHub-styled output via `transform='github'`; default
fallback intact. US1 + US2 work independently.

---

## Phase 5: User Story 3 - An operator tunes formatting and filtering per route via config (Priority: P3)

**Goal**: Per-route `config` drives presentation (mention roles, accent color) and filtering
(exclusion list of subtypes); a filtered event delivers nothing and is recorded `filtered`; the
same transform serves many routes via differing config.

**Independent Test**: On one route set `mentionRoleIds` + `accentColor` + `excludeSubtypes`;
trigger matching and excluded events → mention + accent appear, excluded subtype produces no
message and a `filtered` row, non-excluded still deliver; a second route without the filter still
delivers the excluded subtype.

### Tests for User Story 3

- [ ] T012 [P] [US3] Unit-test the route filter in `tests/machinery/route-filter.test.ts`: `excludeSubtypes` matching a value in `CanonicalEvent.data` suppresses; empty/absent delivers; the engine records `filtered` and sends nothing on suppression (using a fake repo + delivery, as the 001 engine tests do).
- [ ] T013 [P] [US3] Unit-test config-driven formatting in `tests/machinery/github-transform.test.ts` (extend): `mentionRoleIds` produces a mention, `accentColor` is reflected, unresolvable role id is omitted (not an error), same transform + two configs → two outputs. Also assert the no-regression guard: a render with empty/absent config is byte-identical to the pre-helper output (protects FR-008 / SC-007).

### Implementation for User Story 3

- [ ] T014 [US3] Create `src/routing/filter.ts`: a pure function `passesFilter(event, routeConfig)` that returns false (suppress) when the event's normalized `data.subtype` (written by the adapter, see T007) is present in the route config's `excludeSubtypes` array; passes when the list is empty/absent or the event has no `subtype`. Matching is on the single `data.subtype` field — not a scan of all `data` values — so the recognized vocabulary is exactly what adapters write as `subtype`.
- [ ] T015 [US3] Edit `src/routing/engine.ts`: before resolving the target/transform for a route, evaluate `passesFilter`; if suppressed, record a `filtered` delivery outcome and skip delivery (no Discord call), counting it distinctly in the `DispatchResult`; otherwise proceed as today. (Source-agnostic routing policy — no source-name branching.)
- [ ] T016 [US3] Apply per-route formatting config in `src/routing/transforms/github.ts` via a small shared helper (e.g. `src/routing/transforms/format-config.ts`): read `mentionRoleIds` and `accentColor` from the route config; omit unresolvable mentions; fall back to defaults when keys are absent. The helper MUST be **opt-in / no-op on empty config** — if the default transform adopts it, an empty-config render MUST be byte-identical to today's output so existing ClickUp routes don't regress (FR-008 / SC-007).
- [ ] T017 [US3] Add `'filtered'` to `DispatchResult` accounting in `src/routing/types.ts` + `src/routing/engine.ts` (a `filtered` counter alongside delivered/skipped/failed) so the outcome is observable in the dispatch summary and logs.

**Checkpoint**: All three stories independently functional — GitHub delivers, renders per named
transform, and tunes/filters per route with auditable `filtered` outcomes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T018 [P] Update `.env.example` comment/grouping for the GitHub secret if needed, and confirm `docs/OPERATIONS.md` mentions adding a GitHub source (secret name + webhook URL) — keep ops docs current.
- [ ] T019 Run `npm run check:all` (format + lint + typecheck + Vitest) and resolve until green; then validate the quickstart.md scenarios (signed happy path, 401, idempotency via redeliver, source isolation, named transform, missing-transform fallback, mention/color, filter→`filtered`).
- [ ] T020 Verify constitution posture for the diff (manual review, recorded in the PR, not in shipped code): GitHub added only via the adapter + registry (no source-name branching in core); the engine filter step is source-agnostic; secrets only by reference; `CanonicalEvent` gained no top-level fields (GitHub specifics live in `data`).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: depends on Setup; blocks US3 (which emits `filtered`). US1/US2 do not
  strictly need it but it's done first so the codebase/types stay consistent.
- **US1 (P3 phase)**: depends on Foundational only for type consistency; otherwise independent —
  the MVP (GitHub → Discord).
- **US2**: depends on US1 existing (it formats GitHub events) but is independently testable; the
  transform registry itself is from 001.
- **US3**: depends on Foundational (the `filtered` status) and is most naturally built after US1
  (needs GitHub events to filter/format); independently testable.
- **Polish (P6)**: after the stories it touches.

### Within each story

- Tests before implementation.
- Adapter before its registration; transform before its registration; filter function before the
  engine edit that calls it.

### Parallel opportunities

- US1 tests T004/T005/T006 in parallel; then T007 → T008 (register depends on the adapter).
- US3 tests T012/T013 in parallel; T014 (filter fn) before T015 (engine edit); T016/T017 can
  follow.
- US1 and US2 implementation can largely proceed together once the adapter exists (different
  files: `sources/github/` vs `routing/transforms/github.ts`).

---

## Implementation Strategy

### MVP scope

**US1 is the MVP** — GitHub events reaching Discord proves the second-source goal. Build Setup →
Foundational → US1, then **stop and validate** US1 (quickstart scenarios 1–5) before layering
formatting (US2) and config/filtering (US3).

### Incremental delivery

1. Setup + Foundational → schema/types ready.
2. US1 → validate → GitHub → Discord via default transform (MVP).
3. US2 → validate → GitHub-styled rendering, selectable per route.
4. US3 → validate → per-route mention/color + filtering with `filtered` audit.
5. Polish → `check:all` green, quickstart validated, posture reviewed.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- `[Story]` labels map tasks to spec user stories for traceability.
- Reuses 001 wholesale; the only core edits are T002/T003 (`filtered` status) and T015/T017 (engine
  filter step) — both source-agnostic.
- Shipped code states rules in its own terms — never cite FRs/specs/principles (Principle V).
