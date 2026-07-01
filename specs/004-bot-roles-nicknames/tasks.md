---
description: 'Task list for the self-service roles & nicknames (BED-BOT parity) feature'
---

# Tasks: Self-Service Roles & Nicknames (BED-BOT parity)

**Input**: Design documents from `/specs/004-bot-roles-nicknames/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md.
Builds on the shipped 001–003 bot: the command registry + `commands/index.ts` wiring point, the one
`interactionCreate` dispatcher (which already contains a throwing command — FR-013 backstop),
`getContext().repo` for DB access, the `Guilds`+`GuildMembers` intents (sufficient — no new intent),
the `Repository` interface + Pg impl, and the `schema_migrations` migration ledger.

**Tests**: Included — the spec/plan/quickstart call for Vitest coverage and Principle V requires
`check:all` (which runs tests) to stay green. Scoped to the capability logic (the authorization gate
+ role/nickname mechanics) and the whitelist read; the command modules are thin adapters.

**Organization**: Grouped by user story (spec priority — US1 P1, US4 P1, US2 P2, US3 P2). The
capability logic lives in `src/bot/members/` (interaction-style-agnostic, per FR-011); the
`commands/*` modules adapt a slash interaction onto it. No new gateway intent; no Message Content.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 / US4 (Setup, Foundational, Polish carry no story label)
- File paths are exact and relative to repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm prerequisites. No new dependencies, no new env vars, no new gateway intent —
role/nickname management uses the already-present `Guilds`+`GuildMembers` intents and the
`ManageRoles`/`ManageNicknames` *permissions* (an operator grant, not code).

- [ ] T001 Verify no new dependency/intent is required: confirm `discord.js` is a dependency and that `src/bot/client.ts` already requests `GatewayIntentBits.Guilds` + `GuildMembers` (sufficient for role/nickname management — do NOT add Message Content). No code change expected; this is a verification gate per research §5.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The whitelist table + its repository read, which BOTH the role stories (US1 self-assign,
US2 list) and US4 (operator curation) depend on. After this phase the whitelist can be read; no
command uses it yet.

**⚠️ CRITICAL**: Complete before the user-story phases.

- [ ] T002 Create `migrations/0006_self_assignable_roles.sql`: a new table `self_assignable_roles (guild_id text NOT NULL, role_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())` with `UNIQUE (guild_id, role_id)`. Additive; runs once via the `schema_migrations` ledger. No FKs (guild_id/role_id are external Discord ids). Per data-model.md.
- [ ] T003 Add `listSelfAssignableRoles(guildId: string): Promise<string[]>` to the `Repository` interface in `src/db/repository.ts`, and implement it in `src/db/pg-repository.ts` as a parameterized `SELECT role_id FROM self_assignable_roles WHERE guild_id = $1` returning the role_id set (empty array when none). Per data-model.md.

**Checkpoint**: The guild whitelist can be read through the repository; `check:all` green; nothing
member-facing yet.

---

## Phase 3: User Story 1 - A member self-assigns a whitelisted role (Priority: P1) 🎯 MVP

**Goal**: A member toggles a whitelisted role on/off themselves via `/role`, gated by the whitelist
and the bot-position guard, acting only on themselves.

**Independent Test**: With one role whitelisted and one not, a member toggles the allowed role on
(gets it), again (loses it), and is refused for the non-allowed role and for a role above the bot —
all via the member's command and resulting role membership.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL before implementing)

- [ ] T004 [P] [US1] Create `tests/machinery/member-roles.test.ts` (toggle portion): with a fake guild-member surface and a whitelist set, assert `toggleSelfRole` — adds when absent / removes when present (idempotent direction), refuses `not-whitelisted` for a role not in the set (no mutation called), refuses `bot-cannot-manage` when the role is at/above the bot's position or the bot lacks `ManageRoles` (no mutation), and surfaces a `role-not-found` refusal (not a throw) when the add/remove backstop trips. Assert no code path mutates a member other than the one passed (self-only). Per contracts/role-capability.md.

### Implementation for User Story 1

- [ ] T005 [US1] Create `src/bot/members/roles.ts` with `toggleSelfRole(member, role, whitelistRoleIds)`: evaluate the gate in order — whitelist membership (FR-002), then bot-position + `ManageRoles` permission (FR-007) — before any mutation; then `member.roles.remove(role)` if present else `member.roles.add(role)`; return a structured outcome (added/removed/refused-with-reason). Wrap the mutation so a race surfaces as a `role-not-found` refusal, never a throw. Interaction-agnostic (takes objects, returns an outcome — no interaction, no reply). Per contracts/role-capability.md and research §2/§3.
- [ ] T006 [US1] Create `src/bot/commands/role.ts`: a `/role` slash command with a required `role` option (native role picker); `execute` defers ephemerally, reads the guild whitelist via `getContext().repo.listSelfAssignableRoles(guildId)`, calls `toggleSelfRole`, and edits in an ephemeral confirmation/refusal. Acts only on `interaction.member` — no target-member option. Follow the `ping` defer/editReply pattern. Per contracts/commands.md.
- [ ] T007 [US1] Register the `/role` command in `src/bot/commands/index.ts` (one `registerCommand` line). Run `npm test -- member-roles` and confirm green.

**Checkpoint**: A member can self-toggle a whitelisted role, refused outside the whitelist and above
the bot — the MVP role capability.

---

## Phase 4: User Story 4 - An operator curates the self-assignable whitelist (Priority: P1)

**Goal**: An operator makes a role self-assignable (or not) by editing `self_assignable_roles` rows —
no deploy — and that governs the next member request.

**Independent Test**: An operator adds a row; a member can then self-assign that role (US1). The
operator removes it; the member is refused and it leaves the listing (US2) — no redeploy.

> US4 ships no new command (per the clarified scope: operators curate by editing data directly; an
> in-Discord operator command is deferred to 006). Its capability is the runtime-mutable whitelist
> built in Phase 2 (T002/T003) and consumed by US1/US2. This phase verifies the operator-curation
> behavior end-to-end rather than adding code.

### Tests for User Story 4 ⚠️

- [ ] T008 [P] [US4] Extend `tests/machinery/member-roles.test.ts` (live-whitelist portion): assert that `toggleSelfRole` honors exactly the whitelist set passed to it — a role becomes assignable when added to the set and is refused when absent — proving the authorization is driven entirely by the (operator-edited) data, with no auto-add path in the capability (FR-005/FR-006). (No new source file — this validates the Phase-2 read + Phase-3 gate are data-driven.)

**Checkpoint**: Operator edits to the whitelist data govern member self-assignment with no code path
that bypasses or auto-populates the whitelist.

---

## Phase 5: User Story 2 - A member sees which roles are self-assignable (Priority: P2)

**Goal**: A member runs `/roles` and gets the current set of self-assignable roles (by name),
reflecting live operator edits; empty whitelist → an explicit "none available".

**Independent Test**: With a known whitelist, `/roles` lists exactly those roles; after an operator
adds/removes one, the next listing reflects it with no redeploy; empty whitelist → "none available".

### Tests for User Story 2 ⚠️

- [ ] T009 [P] [US2] Extend `tests/machinery/member-roles.test.ts` (list portion): assert `listSelfAssignableRoles(guild, whitelistRoleIds)` returns the live roles whose ids are whitelisted (name+id), omits ids with no matching live role (deleted/stale), and returns an empty result for an empty or all-stale set (the caller renders "none available"). Per contracts/role-capability.md.

### Implementation for User Story 2

- [ ] T010 [US2] Add `listSelfAssignableRoles(guild, whitelistRoleIds)` to `src/bot/members/roles.ts` (read-only resolve of whitelisted ids → live roles, stale ids omitted). Per contracts/role-capability.md.
- [ ] T011 [US2] Create `src/bot/commands/roles.ts`: a `/roles` slash command (no options); `execute` defers ephemerally, reads the guild whitelist via the repository, calls `listSelfAssignableRoles`, and replies ephemerally with the role names or "No roles are currently self-assignable." Register it in `src/bot/commands/index.ts`. Run `npm test -- member-roles`. Per contracts/commands.md.

**Checkpoint**: A member can discover the assignable set, matching the operator's live whitelist.

---

## Phase 6: User Story 3 - A member sets or resets their own nickname (Priority: P2)

**Goal**: A member sets or resets their own nickname via `/nick`, enforcing the 32-char limit and the
bot-position guard, acting only on themselves.

**Independent Test**: A member sets a valid nickname (changes), sets a 33+ char or whitespace-only
value (refused, no change), resets with no value (cleared), and is refused safely if they outrank the
bot.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL before implementing)

- [ ] T012 [P] [US3] Create `tests/machinery/member-nickname.test.ts`: with a fake guild-member surface, assert `setOwnNickname` — sets a valid value, clears on `undefined` (reset), refuses `invalid-input` for >32 chars and for whitespace-only (no mutation, message states the limit), refuses `bot-cannot-manage` when the member outranks the bot or the bot lacks `ManageNicknames` (no mutation) — for BOTH a set value AND a reset (`undefined`), so a reset when the member outranks the bot is still refused, not silently attempted — and surfaces an unexpected API error as a clean refusal, not a throw. Per contracts/role-capability.md.

### Implementation for User Story 3

- [ ] T013 [US3] Create `src/bot/members/nickname.ts` with `setOwnNickname(member, value)`: validate length (≤32) and non-whitespace when a value is given (FR-004), then the bot-position + `ManageNicknames` guard (FR-008), then `member.setNickname(value ?? null)`; return a structured outcome (set/cleared/refused-with-reason). Wrap so an API error is a clean refusal. Interaction-agnostic. Per contracts/role-capability.md.
- [ ] T014 [US3] Create `src/bot/commands/nick.ts`: a `/nick` slash command with an optional `nickname` string option; `execute` defers ephemerally, calls `setOwnNickname(interaction.member, value)`, edits in an ephemeral confirmation/refusal. Acts only on the invoking member. Register it in `src/bot/commands/index.ts`. Run `npm test -- member-nickname`. Per contracts/commands.md.

**Checkpoint**: A member can set/reset their own nickname safely; all four self-service commands work.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Docs, registration, and end-to-end validation.

- [ ] T015 [P] Update `docs/OPERATIONS.md`: add a "Self-service roles & nicknames" section — how to whitelist a role (add a `self_assignable_roles` row: `guild_id` + `role_id`), the operational precondition (the bot's role must sit above the roles it manages, with Manage Roles / Manage Nicknames granted), the `/role` `/roles` `/nick` commands, and that `npm run deploy:commands` must run to register new commands. State rules directly; no spec/FR citations (Principle V).
- [ ] T016 Run `npm run deploy:commands` against the test guild (guild-scoped, instant) to register `/role`, `/roles`, `/nick`, then run the `quickstart.md` end-to-end validation: whitelist a role, toggle it, refusal outside the whitelist, list, nickname set/reset/over-limit, the bot-position guard, and the self-only + webhook-no-regression checks. Confirm each success signal maps to its SC.
- [ ] T017 Run `npm run check:all` (format + lint + typecheck + test) and confirm green on a clean checkout — the release gate (Principle V). Confirm the full 001–003 suite still passes (bot/webhook no-regression, SC-007). Add/keep an assertion that the bot client's requested intents are still exactly `Guilds`+`GuildMembers` (no new intent, Message Content absent) so FR-012's "boots and functions with Message Content off" has executable coverage, not just the T001 static check — e.g. a small test importing `createBotClient()` and asserting its intents contain neither `GatewayIntentBits.MessageContent` nor any addition beyond the two.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: verification only; no dependency.
- **Foundational (Phase 2)**: depends on Setup. **BLOCKS all user stories** — the whitelist table +
  repository read are shared by US1/US2/US4.
- **US1 (Phase 3)**: depends on Foundational. The MVP (role toggle).
- **US4 (Phase 4)**: depends on Foundational + US1's gate (it validates that the gate is data-driven);
  ships no new code, only a test asserting the operator-curation behavior.
- **US2 (Phase 5)**: depends on Foundational; adds the list capability to `members/roles.ts` (same
  file as US1's toggle → sequential on that file) + a new command.
- **US3 (Phase 6)**: depends on Foundational; independent of the role stories (separate
  `members/nickname.ts` + `commands/nick.ts` files) — can proceed in parallel with US1/US2.
- **Polish (Phase 7)**: depends on the user-story phases.

### Within / across stories

- `src/bot/members/roles.ts` is touched by US1 (T005 toggle) and US2 (T010 list) → those are
  **sequential** (same file). `commands/index.ts` is touched by T007/T011/T014 → sequential.
- `src/bot/members/nickname.ts` + `commands/nick.ts` (US3) are independent of the role files → US3
  can run in parallel with US1/US2.
- Tests-first within each story: T004 before T005; T012 before T013.

### Parallel Opportunities

- Foundational: T002 (migration) and T003 (repository) touch different files → `[P]`-able, though
  T003's read is what US1 consumes.
- US3 (nickname, T012–T014) runs fully parallel to US1/US2 (roles) — different files.
- Polish T015 (docs) is `[P]` with the validation tasks (different file).

---

## Parallel Example: roles vs nickname stories

```bash
# After Foundational (T002/T003), the role and nickname stories are independent files:
Task: "member-roles.test.ts + members/roles.ts + commands/role.ts"     # US1 (T004-T007)
Task: "member-nickname.test.ts + members/nickname.ts + commands/nick.ts" # US3 (T012-T014) [parallel]
# US2 (list) extends members/roles.ts -> sequential AFTER US1 on that file.
```

---

## Implementation Strategy

### MVP First (User Story 1 + its foundation)

1. Phase 1 Setup (verify intents) → Phase 2 Foundational (whitelist table + repository read).
2. Phase 3 US1: the `/role` toggle with the full authorization gate + tests.
3. Phase 4 US4: confirm the gate is data-driven (operator curation works).
4. **STOP and VALIDATE**: a member self-assigns a whitelisted role, refused otherwise. Deploy/demo.

### Incremental Delivery

1. Foundational → whitelist readable.
2. US1 + US4 → self-assign works, operator-curated → MVP.
3. US2 → discovery (`/roles`).
4. US3 → nicknames.
5. Polish → ops docs + command registration + full quickstart + `check:all`.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- The capability logic (`members/roles.ts`, `members/nickname.ts`) is interaction-agnostic so 005 can
  add button/reaction adapters over it — do not put interaction/reply code in `members/` (FR-011).
- No new gateway intent; never add Message Content (FR-012). If a task seems to need it, re-read
  research §5 — role/nickname management is permission-gated REST, not intent-gated.
- FR-013 (a command failure must not crash the bot) is already satisfied by the existing
  `interactionCreate` try/catch; capability functions add specific refusals on top, they don't add a
  new crash path.
- Shipped code states rules directly; no spec/FR/principle citations (Principle V).
- Commit after each task or logical group; keep `check:all` green throughout.
