---
description: 'Task list for the walking-skeleton feature'
---

# Tasks: Walking Skeleton — first end-to-end slice of the Discord hub

**Input**: Design documents from `/specs/001-walking-skeleton/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — the spec's quickstart and plan call for Vitest + Supertest coverage, and
Principle V requires `check:all` (which runs tests) to stay green. Test tasks are scoped to the
contracts and the security/idempotency-critical units, not exhaustive coverage.

**Organization**: Grouped by user story. Build order respects spec priority (US1 → US2 → US3);
see Implementation Strategy for the fastest independent demo path.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- File paths are exact and relative to repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and project wiring for the hub modules.

- [ ] T001 Add runtime dependencies (`discord.js`, `pino`, `pg`) and types (`@types/pg`) to `package.json`; run install so `package-lock.json` updates.
- [ ] T002 [P] Extend `.env.example` with the names (no values) for `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_DEV_GUILD_ID`, `DATABASE_URL`, `LOG_LEVEL`, and the source/target secret reference names.
- [ ] T003 [P] Create `tests/machinery/` directory (unit-test home alongside existing `tests/app/`) with a `.gitkeep` or first test file so the path exists.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure every user story depends on — config, logging, errors,
lifecycle, the unified bootstrap, and the database + repository layer.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Extend `src/config.ts` into a validated config object read once at boot (PORT plus bot token, app id, dev guild id, DATABASE_URL, LOG_LEVEL, secret reference names); fail fast on missing required values.
- [ ] T005 [P] Create `src/core/logger.ts`: pino root + child-logger factory with redaction so secrets, tokens, and full payloads are never logged (FR-023).
- [ ] T006 [P] Create `src/core/errors.ts`: typed error classes (unauthorized, unknown-source, bad-payload, dependency-unavailable) and a central Express error middleware mapping them to status codes.
- [ ] T007 [P] Create `src/core/lifecycle.ts`: readiness-state holder and graceful-shutdown wiring (signal handlers, close DB pool + gateway).
- [ ] T008 Create `migrations/0001_init.sql`: tables `sources`, `discord_targets`, `routes`, `delivery_log` per data-model.md, including `CHECK` constraints, the `routes (source, event_type) WHERE enabled` index, and the `UNIQUE (route_id, dedupe_key)` constraint; plus seed rows (one `clickup` source, one webhook target, one enabled route).
- [ ] T009 Create `src/db/repository.ts`: the storage-agnostic `Repository` interface (findEnabledRoutes(source, eventType), getTarget(id), alreadyDelivered(routeId, dedupeKey), recordDelivery(...), readiness ping).
- [ ] T010 Create `src/db/client.ts`: `pg` pool constructed from config.
- [ ] T011 Create `src/db/pg-repository.ts`: PostgreSQL implementation of the `Repository` interface (parameterized queries; maps rows to `RouteRecord`/target types).
- [ ] T012 Refactor `src/server.ts` to export `createApp()` only (remove the run-as-main `listen` block); keep existing middleware + `registerRoutes` wiring so Supertest can mount the app.
- [ ] T013 Create `src/main.ts`: unified bootstrap that validates config, builds the app and starts `listen(PORT)`, logs the bot in over the gateway, wires lifecycle/shutdown, and sets the container entrypoint; update `package.json` `start` to `node dist/server/main.js` and `scripts/dev.mjs` to run the bootstrap.

**Checkpoint**: Foundation ready — config, logging, DB/repository, and the one-process
bootstrap exist; user stories can begin.

---

## Phase 3: User Story 1 - An external event reaches the right Discord channel (Priority: P1) 🎯 MVP

**Goal**: A verified ClickUp event is normalized, matched to enabled routes (exact, fan-out to
all), formatted, delivered to each Discord channel through one delivery path, de-duplicated per
route, and recorded.

**Independent Test**: Configure one route, POST a signed ClickUp payload to `/webhooks/clickup`,
confirm a formatted message in the channel and an `ok` `delivery_log` row; POST again →
`skipped`; bad signature → `401`.

### Tests for User Story 1

> Write these first and ensure they fail before implementing.

- [ ] T014 [P] [US1] Unit test the ClickUp adapter in `tests/machinery/clickup-adapter.test.ts`: valid `X-Signature` passes, tampered/missing fails (constant-time), and `parse` yields a correct `CanonicalEvent` (source, eventType, dedupeKey, title, url).
- [ ] T015 [P] [US1] Unit test the routing engine in `tests/machinery/engine.test.ts`: exact match, fan-out to multiple enabled routes, no-match → no delivery, and idempotency (second same (route, dedupeKey) → skipped) using a fake `Repository`.
- [ ] T016 [P] [US1] Unit test the default transform in `tests/machinery/default-transform.test.ts`: produces a message with summary + link from a `CanonicalEvent`.
- [ ] T017 [P] [US1] Integration test the webhook endpoint in `tests/app/webhook.test.ts` (Supertest over `createApp()`): `202` happy path, `401` bad signature, `404` unknown source, `202` no-matching-route, per the inbound-webhook contract.

### Implementation for User Story 1

- [ ] T018 [P] [US1] Create `src/sources/types.ts`: `SourceAdapter`, `CanonicalEvent`, `VerifyContext` interfaces (per data-model.md).
- [ ] T019 [P] [US1] Create `src/sources/registry.ts`: `registerSource` / `getSource` / `allSources`.
- [ ] T020 [US1] Create `src/sources/clickup/adapter.ts`: `verify` (HMAC-SHA256 of raw body, constant-time) + `parse` (→ `CanonicalEvent`, dedupeKey from provider id else body hash).
- [ ] T021 [US1] Create `src/sources/index.ts`: import and register the ClickUp adapter (the single wiring point).
- [ ] T022 [P] [US1] Create `src/routing/types.ts`: `RouteRecord`, `DispatchResult`.
- [ ] T023 [P] [US1] Create `src/routing/transforms/{types,registry,default,index}.ts`: `Transform` type, transform registry, default embed transform (summary + link), and registration.
- [ ] T024 [P] [US1] Create `src/discord/rest.ts`: shared discord.js REST client (relies on its rate-limit buckets).
- [ ] T025 [US1] Create `src/discord/delivery.ts`: `DeliveryService` with the webhook-URL path; single chokepoint enforcing per-(route,event) idempotency check + bounded retry/backoff on 429/5xx honoring `Retry-After` (FR-011/012/013).
- [ ] T026 [US1] Create `src/routing/engine.ts`: `dispatch(event)` — find enabled routes (exact, fan-out all), resolve transform, resolve target, deliver via `DeliveryService`, record outcome; routes processed independently (one failure doesn't block others).
- [ ] T027 [US1] Create `src/routes/webhooks.ts`: generic `POST /webhooks/:source` handler — resolve adapter (404 if unknown), verify (401 on fail), acknowledge `202` immediately, then dispatch asynchronously; `503` (fail closed) when the routing store is unreachable (FR-004a, FR-004b).
- [ ] T028 [US1] Wire raw-body capture for `/webhooks/*` only and register the webhook route in `src/routes/index.ts` (keep JSON parsing for other routes).

**Checkpoint**: A real ClickUp event reaches a Discord channel via a DB-driven route, de-duped
and recorded — US1 fully functional and independently testable.

---

## Phase 4: User Story 2 - An operator manages routing without a redeploy (Priority: P2)

**Goal**: Adding, disabling, or repointing a route in the store takes effect on the next event
with no restart or redeploy.

**Independent Test**: With the service running, add a route via the store editor → matching
event delivered; disable it → next matching event not delivered; repoint the target → events
go to the new channel. No restart.

### Tests for User Story 2

- [ ] T029 [P] [US2] Integration test in `tests/app/routing-runtime.test.ts`: inserting an enabled route then dispatching a matching event delivers; disabling it then dispatching does not; against a test DB (or repository fake seeded live).

### Implementation for User Story 2

- [ ] T030 [US2] Confirm the engine reads routes live per event (no cached route table) so store edits take effect immediately; if any caching was introduced, remove it or add per-event freshness — in `src/routing/engine.ts`.
- [ ] T031 [US2] Verify `pg-repository.findEnabledRoutes` honors the `enabled` flag and target repoint (joins current `discord_targets`) so disable/repoint are reflected without restart — in `src/db/pg-repository.ts`.
- [ ] T032 [P] [US2] Verify the operator route-management flow against the running system: confirm the `migrations/0001_init.sql` seed rows and the table-editor add/strike/repoint steps match the shipped schema and actually take effect at runtime (run quickstart scenario 10); fix the migration/seed if any column or step has drifted.

**Checkpoint**: US1 and US2 both work — routing is operator-editable at runtime.

---

## Phase 5: User Story 3 - The bot is present and responsive in Discord (Priority: P3)

**Goal**: The bot logs in over the gateway, answers `/ping`, observes a member-join, stays
connected, and contains command errors — with least-privilege intents (no Message Content).

**Independent Test**: Run `/ping` → prompt reply; a member joins → observed/logged; idle period
→ still responsive; a throwing command → bot stays up, member gets an error reply.

### Tests for User Story 3

- [ ] T033 [P] [US3] Unit test the command registry + interaction dispatch in `tests/machinery/command-registry.test.ts`: a registered command is found by name and a thrown handler is contained (error reply, no rethrow).

### Implementation for User Story 3

- [ ] T034 [P] [US3] Create `src/bot/client.ts`: discord.js `Client` with intents derived from registered handlers (`Guilds`, `GuildMembers`; Message Content NOT enabled).
- [ ] T035 [P] [US3] Create `src/bot/commands/{types,registry}.ts`: `SlashCommand` type and `registerCommand` / `getCommand` / `allCommands`.
- [ ] T036 [US3] Create `src/bot/commands/ping.ts` and `src/bot/commands/index.ts`: the `/ping` command and its registration.
- [ ] T037 [P] [US3] Create `src/bot/events/{types,registry}.ts`: `EventHandler` type and the binding loop that attaches handlers at login.
- [ ] T038 [US3] Create `src/bot/events/interaction-create.ts`: routes interactions by command name into the command registry; wraps `execute` so a throw is contained and yields an ephemeral error reply (FR-018).
- [ ] T039 [P] [US3] Create `src/bot/events/guild-member-add.ts`: observe/log member-join (FR-017), contained against throws.
- [ ] T040 [US3] Create `src/bot/events/index.ts`: import and register the event handlers (single wiring point); ensure `src/main.ts` binds them and logs the bot in.
- [ ] T041 [US3] Create `scripts/deploy-commands.mjs`: register slash-command definitions with Discord (guild-scoped in dev via `DISCORD_DEV_GUILD_ID`, global in prod).

**Checkpoint**: All three user stories independently functional — the whole architecture
demonstrated end to end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Operability and resilience that span stories.

- [ ] T042 [P] Create `src/routes/ready.ts` (readiness: DB reachable + gateway connected) and ensure `src/routes/health.ts` liveness stays 200 independent of downstream; register `/api/ready` in `src/routes/index.ts` (FR-020/021).
- [ ] T043 [P] Integration test in `tests/app/readiness.test.ts`: `/api/health` 200 while a dependency is down; `/api/ready` 503 naming the failing dependency.
- [ ] T044 Verify least-privilege + secrets posture: intents limited to registered handlers; no secret/full-payload appears in logs; DB rows hold only reference names (manual review against Principles II/VII), recorded in the PR description (not in shipped code).
- [ ] T045 Run `npm run check:all` (format + lint + typecheck + Vitest) and resolve until green; then validate the quickstart.md scenarios end to end.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User stories (Phases 3–5)**: all depend on Foundational. US1 and US3 are independent of
  each other; **US2 depends on US1** (same routing table/engine). US3 is independent of US1/US2.
- **Polish (Phase 6)**: depends on the user stories it touches (readiness needs the bootstrap +
  DB + gateway).

### Within each story

- Tests (where included) before implementation.
- Types/interfaces before the modules that implement them.
- Adapter/transform/delivery before the engine; engine + webhook route before end-to-end.
- Registry types before the modules that register into them.

### Parallel opportunities

- All Setup `[P]` tasks (T002, T003) together.
- Foundational `[P]` tasks T005, T006, T007 together (independent files); T009–T011 are
  sequential (interface → client → impl).
- US1: tests T014–T017 in parallel; then `[P]` types/registries T018, T019, T022, T023, T024 in
  parallel before the sequential engine/delivery/route tasks.
- US3: `[P]` T034, T035, T037, T039 in parallel before the sequential wiring tasks.
- US1 and US3 can be built by different people in parallel once Foundational is done.

---

## Implementation Strategy

### MVP scope

Spec priority makes **US1 the MVP** (the core hub value: external event → Discord). Build
Setup → Foundational → US1, then **stop and validate** US1 independently (quickstart scenarios
4–9) before proceeding.

### Fastest independent demo (optional)

US3 (the bot) has the fewest dependencies — it needs only Setup + the bootstrap/config/logging
parts of Foundational (T004, T005, T013), not the DB. If a quick live demo is wanted first,
build US3 to get `/ping` responding, then return to US1+US2 for the webhook path.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → the hub delivers a real event (MVP).
3. US2 → validate → operators manage routing at runtime.
4. US3 → validate → the bot is present and interactive.
5. Polish → readiness/health, posture review, full `check:all` green.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- `[Story]` labels map tasks to spec user stories for traceability.
- Each user story is independently completable and testable.
- Verify tests fail before implementing.
- Commit after each task or logical group.
- Shipped code states rules in its own terms — never cite FRs/specs/principles (Principle V).

---

## Phase 7: Convergence

Appended by `/speckit-converge` after assessing the implemented code against spec/plan/
constitution. Root cause is shared between the two items: the inbound route hardcodes the
ClickUp secret reference instead of taking it from the source's `secret_ref`.

- [x] T046 CRITICAL Make the inbound webhook route source-agnostic per Constitution I (contradicts): remove the `adapter.slug === 'clickup'` branch in `src/routes/webhooks.ts` (line ~34) that resolves the signing secret. Core code must not name a specific source — adding a second source must not require editing this route. **Done:** `webhooks.ts` looks up the source row and uses its `secret_ref`; no source name appears in the route.
- [x] T047 Resolve each source's signing secret from its `sources.secret_ref` per FR-002 / data-model `sources.secret_ref` (partial): add a repository lookup (e.g. `getSource(slug) -> { secretRef }`) or carry `secretRef` on the registered adapter, then have `src/routes/webhooks.ts` resolve the secret via `resolveSecret(source.secret_ref)`. This wires the currently-unread `secret_ref` column into the verify path and removes the hardcoded literal. **Done:** added `Repository.getSourceRecord` (+ pg impl); the route resolves `resolveSecret(source.secretRef)` and also honors the source `enabled` kill-switch.
