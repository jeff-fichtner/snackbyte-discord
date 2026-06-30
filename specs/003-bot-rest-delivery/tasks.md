---
description: 'Task list for the bot-REST delivery path feature'
---

# Tasks: Bot-REST Delivery Path

**Input**: Design documents from `/specs/003-bot-rest-delivery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md.
Builds on the shipped 001/002 codebase (routing engine, single delivery service, transform
registry, repository, secrets-by-reference, always-on bot). The `DeliveryTarget` type already
carries `mode: 'webhook' | 'bot'` + `channelId`/`guildId`; the `discord_targets` table already
permits `mode='bot'`; `getTarget` already loads those columns; the engine already calls
`delivery.send(target, msg)` mode-agnostically. This feature adds the bot path behind that seam.

**Tests**: Included — the spec/plan/quickstart call for Vitest + Supertest coverage and Principle V
requires `check:all` (which runs tests) to stay green. Scoped to the mode-dispatching delivery
service, the bot send path, failure classification, and a no-regression check on the webhook path.

**Organization**: Grouped by user story (spec priority US1 → US2). Almost all work lands in
`src/discord/delivery.ts` + a new `src/discord/rest.ts` + their wiring in `src/main.ts`. The
engine, repository, routing types, and transforms are reused **unchanged**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 (Setup, Foundational, Polish carry no story label)
- File paths are exact and relative to repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm wiring prerequisites. No new dependencies, no new env vars — the bot path
reuses the existing `DISCORD_BOT_TOKEN` (already in `.env.example` and `scripts/set-secrets.sh`
from 001).

- [ ] T001 Verify no new dependency or secret is required: confirm `discord.js` is already a dependency in `package.json` (its `REST` client is used) and that `DISCORD_BOT_TOKEN` is already present in `.env.example` and the `KEYS=( … )` array in `scripts/set-secrets.sh`. No file change expected; if `DISCORD_BOT_TOKEN` is somehow absent from either, add it (name only).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The bot REST client and the delivery-service mode-dispatch scaffolding that BOTH user
stories build on. After this phase the service dispatches by mode but the bot branch is a stub
(throws "not implemented") so the webhook path is provably unchanged and `check:all` stays green.

**⚠️ CRITICAL**: Complete before the user-story phases.

- [ ] T002 [P] Create `src/discord/rest.ts`: construct and export a discord.js `REST` client (`new REST({ version: '10' }).setToken(token)`) from a passed-in bot token — the same construction already used in `src/bot/deploy-commands.ts:25` for command registration (mirror it). Export a small factory `createBotRest(token: string)`. No gateway `Client` involved (research §1). Token is a parameter, never read from `process.env` here. (Optional: `deploy-commands.ts` may be refactored to import this factory so the REST client is built one way; do not let that refactor change command-registration behavior.)
- [ ] T003 Refactor `src/discord/delivery.ts` so `send(target, msg)` dispatches on `target.mode`: extract today's webhook logic unchanged into a private `sendWebhook(target, msg)` (keep behavior byte-for-byte) and route `mode==='webhook'` to it; add a `mode==='bot'` branch that for now throws `new Error('bot delivery not implemented')`; an unrecognized mode throws a clear permanent error. The class accepts an optional bot `REST` client via its constructor (used by the bot branch in US1). Keep the `DeliveryService.send` interface and `MAX_ATTEMPTS`/`sleep` helpers. Per contracts/delivery-service.md.
- [ ] T004 Wire construction in `src/main.ts`: build the bot `REST` client from `config.discordBotToken` (via `createBotRest`, only when the token is present) and pass it into the delivery service constructor before it is injected into the runtime context (the existing `new WebhookDeliveryService()` call at the delivery-construction site). When no token, construct the delivery service with no REST client — webhook deliveries keep working; bot deliveries will fail permanently with a clear reason (US2). Preserve the non-fatal bootstrap posture.

**Checkpoint**: The service dispatches by mode; webhook deliveries behave exactly as before
(existing 001/002 delivery tests still pass); bot deliveries throw the stub error. `check:all` green.

---

## Phase 3: User Story 1 - Route a notification to post as the bot into a channel (Priority: P1) 🎯 MVP

**Goal**: A bot-mode target posts a rendered message into its channel as the bot, through the single
delivery service, recorded `ok` — with routing, transforms, fan-out, and idempotency unchanged from
the webhook path.

**Independent Test**: Configure a bot-mode target for a channel the bot can post in, point a route
at it, send a matching signed event → message appears authored by the bot + an `ok` `delivery_log`
row; add a second webhook-mode route for the same event → both fire independently; resend the same
event → the bot route records `skipped` (posted once).

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL before implementing)

- [ ] T005 [P] [US1] Create `tests/machinery/bot-delivery.test.ts` (happy-path portion): with a fake `REST` client, a `mode='bot'` target with a `channelId` posts via the REST client to `channels/{channelId}/messages` with a body built from `{ content, embeds }`; `username`/`avatarUrl` are NOT sent; on a 2xx the call resolves. Also assert a `mode='webhook'` target still routes to the unchanged webhook path (dispatch correctness). Add a secret-safety guard (satisfies FR-012 / Principle VII — but the test file itself cites no FR/principle, per Principle V): on a bot-path *failure*, assert the thrown error message / operator-actionable reason does NOT contain the bot token string. The test describes this as "does not leak the bot token," stating the rule directly.
- [ ] T006 [P] [US1] Create `tests/app/bot-delivery-engine.test.ts` (dual-mode + idempotency portion): drive `dispatch()` (real engine) with a fake repository returning two enabled routes for one event — one bot-mode target, one webhook-mode target — and a fake `DeliveryService` recording calls; assert both are sent once and each records its own `ok`; assert a second dispatch with the same dedupe key records `skipped` for the bot route and posts nothing (engine pre-check, unchanged).

### Implementation for User Story 1

- [ ] T007 [US1] Implement the bot branch in `src/discord/delivery.ts` (`sendBot(target, msg)`): require the bot `REST` client and `target.channelId` (missing either → throw a permanent error with an operator-actionable message — fully specified in US2/T010, here just the happy path + the precondition throws); POST `channels/{target.channelId}/messages` via the REST client with `{ content: msg.content, embeds: msg.embeds }`; resolve on success. Reuse the same `MAX_ATTEMPTS`/backoff scaffold as the webhook path for the retry loop (failure classification detailed in US2). Per contracts/delivery-service.md.
- [ ] T008 [US1] Make T005 and T006 pass; run `npm test -- bot-delivery` and confirm the webhook-path tests from 001/002 are still green (no regression to `sendWebhook`).

**Checkpoint**: A bot-mode route delivers as the bot, deduped and recorded, alongside webhook
routes — the MVP. Failure handling beyond the happy-path preconditions is US2.

---

## Phase 4: User Story 2 - Operator-safe configuration of a bot target (Priority: P2)

**Goal**: Bot-mode delivery failures are recorded with diagnosable, operator-actionable reasons —
permanent failures immediately (no retry), transient failures after the retry policy — without
crashing the service or affecting other routes, and the inbound still acks.

**Independent Test**: Point a bot-mode target at a channel the bot cannot post in → `delivery_log`
records `failed` immediately (no retry) with a clear reason, inbound still acked, other routes
unaffected; a transient error (429/5xx) retries then records `failed`.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL before implementing)

- [ ] T009 [P] [US2] Extend `tests/machinery/bot-delivery.test.ts` (failure-classification portion): with a fake `REST` client, assert a **permanent** error (403/404/401, or a target with no `channelId`, or no REST client configured) throws **immediately** after a single attempt with no retry (no backoff loop) and a diagnosable message; assert a **transient** error (429 then success → resolves; persistent 5xx → throws after `MAX_ATTEMPTS`) follows the same bound as the webhook path. Use a spy to count attempts.
- [ ] T010 [P] [US2] Extend `tests/app/bot-delivery-engine.test.ts` (isolation portion): a bot-mode route whose `send` throws a permanent error records `failed` (with the reason) and does NOT prevent a second route for the same event from delivering `ok`; the dispatch resolves (no throw to the caller) so the inbound ack is unaffected.

### Implementation for User Story 2

- [ ] T011 [US2] Implement failure classification in `sendBot` (`src/discord/delivery.ts`): inspect discord.js errors — `DiscordAPIError` with status 403/404/401 (and pre-call misconfig: missing `channelId` or missing REST client) are **permanent** → throw immediately, no retry; 429/5xx and network/`HTTPError`/timeout are **transient** → retry with backoff honoring `Retry-After`, same `MAX_ATTEMPTS` as `sendWebhook`, then throw. Ensure every thrown error carries an operator-actionable message (the engine records it as the `delivery_log.error`). Per research §3 and contracts/delivery-service.md. (No engine change — its existing `catch → recordDelivery('failed', error)` handles both classes.)
- [ ] T012 [US2] Make T009 and T010 pass; run `npm test -- bot-delivery`.

**Checkpoint**: Bot-mode delivery fails safely and diagnosably; permanent vs. transient handling
matches the webhook path and the spec clarification. US1 + US2 both functional.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Defense-in-depth integrity, operator docs, and end-to-end validation. The migration is
independently droppable (correctness does not depend on it — research §5).

- [ ] T013 [P] Create `migrations/0005_targets_mode_integrity.sql` (optional, lowest priority): add a named `discord_targets` table CHECK constraint `discord_targets_mode_addressing_chk` enforcing `(mode='bot' AND channel_id IS NOT NULL) OR (mode='webhook' AND webhook_url_ref IS NOT NULL)`. Additive, idempotent via the `schema_migrations` ledger; leaves existing valid rows untouched (verified: the only migration-seeded target is webhook-mode with `webhook_url_ref` set — `0001` — so no seeded row violates it). If run against a live DB, a pre-existing half-configured bot row (null `channel_id`) would block the ALTER — that is the misconfiguration the CHECK is meant to surface; fix the row first. Per `data-model.md`. Can be dropped from scope without affecting the feature (runtime already validates).
- [ ] T014 [P] Update `docs/OPERATIONS.md`: add a "Bot-mode delivery targets" subsection — how to add a `mode='bot'` target (channel_id required, guild_id optional, no webhook_url_ref), the operational precondition (bot must be in the guild with permission to post in the channel), and how a permission/channel error surfaces as a `failed` delivery_log row. Mirror the existing target/source wiring docs. State rules directly; no spec/FR citations (Principle V).
- [ ] T015 Run the `quickstart.md` end-to-end validation against a real channel: bot post (US1), dual-mode fan-out, idempotency, operator-safe failure (US2), repoint-with-no-redeploy. Confirm each success signal maps to its SC.
- [ ] T016 Run `npm run check:all` (format + lint + typecheck + test) and confirm green on a clean checkout — the release gate (Principle V). Confirm the full 001/002 suite still passes (webhook-path no-regression, SC-006).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (it is mostly a verification).
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS both user stories** — the REST client and
  mode-dispatch scaffold are shared.
- **User Story 1 (Phase 3)**: Depends on Foundational. The MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational; builds on the `sendBot` introduced in US1
  (T011 elaborates the failure paths around T007's happy path). Best done after US1, though its
  tests can be written in parallel.
- **Polish (Phase 5)**: Depends on the user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independently testable — delivers the bot post + dedup + dual-mode fan-out.
- **US2 (P2)**: Independently testable — delivers safe, diagnosable failure handling. Shares the
  `sendBot` function with US1 (same file), so the two are sequential on `src/discord/delivery.ts`,
  not parallel-on-the-same-file.

### Within Each User Story

- Tests written first and FAIL before implementation (T005/T006 before T007; T009/T010 before T011).
- The delivery-service edits (T003, T007, T011) all touch `src/discord/delivery.ts` → sequential.
- `src/discord/rest.ts` (T002) is independent of the delivery edits → `[P]`.

### Parallel Opportunities

- T002 (`rest.ts`) runs parallel to the T003 delivery refactor scaffolding (different files), but
  T004 (main.ts wiring) needs both.
- Test-authoring tasks across stories (T005/T006 and T009/T010) are `[P]` with each other (distinct
  test files / distinct assertions), though by convention each story's tests precede its impl.
- Polish T013 (migration) and T014 (docs) are `[P]` — different files.

---

## Parallel Example: Foundational + US1 test authoring

```bash
# Foundational — independent files:
Task: "Create src/discord/rest.ts (createBotRest factory)"          # T002 [P]
# (T003/T004 touch delivery.ts/main.ts and are sequential after/with it)

# US1 tests — distinct files, write before implementation:
Task: "bot-delivery.test.ts happy-path + dispatch correctness"       # T005 [P][US1]
Task: "bot-delivery-engine.test.ts dual-mode + idempotency"          # T006 [P][US1]
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup (verify deps/secret) → Phase 2 Foundational (rest.ts + mode dispatch + main.ts).
2. Phase 3 US1: bot send happy path + dual-mode/idempotency tests.
3. **STOP and VALIDATE**: a bot-mode route posts as the bot, deduped, alongside webhook routes.
4. Deploy/demo if ready — this is the feature's core value.

### Incremental Delivery

1. Foundational ready → webhook path provably unchanged (stub bot branch).
2. Add US1 → bot posts work → MVP.
3. Add US2 → failures are safe and diagnosable.
4. Polish → integrity migration + ops docs + full quickstart + `check:all`.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- The three delivery-service tasks (T003, T007, T011) are sequential — same file.
- The engine, repository, routing types, and transforms are reused UNCHANGED — no task edits them;
  if a task seems to require an engine change, re-read research §2/§4 (mode lives only in delivery).
- Shipped code states rules directly; no spec/FR/principle citations (Principle V).
- Commit after each task or logical group; keep `check:all` green throughout.
