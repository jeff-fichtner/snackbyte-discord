---
description: 'Task list for bot-depth completion — moderation & interaction styles (Phase 3, part 2)'
---

# Tasks: Bot-Depth Completion — Moderation & Interaction Styles (Phase 3, part 2)

**Input**: Design documents from `/specs/006-bot-depth-completion/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md.
Builds on the shipped 001–005 bot: the command registry + `commands/index.ts` wiring point; the one
`interactionCreate` dispatcher (contains a throwing command — FR-018 backstop, and the branch point
for components); the event registry + `events/index.ts` + `bindHandlers` per-handler containment;
`getContext().repo`; the `Repository` interface + Pg impl; the `schema_migrations` ledger; the
`src/bot/members/` role/nickname capability (reused unchanged by the new styles); and
`src/bot/moderation/standing.ts` (extended here for the sanction permissions).

**Tests**: Included — spec/plan/quickstart call for Vitest coverage and Principle V requires
`check:all` (which runs tests) to stay green at every step. Scoped to the pure logic (sanction +
channel/message capabilities and their guards, the extended standing gate, the component resolver, the
text-prefix parser, the intents assertion); the command/dispatcher modules are thin adapters.

**Organization**: By user story in priority order (US1 P1, US2 P1, US3 P2, US4 P2, US5 P2, US6 P3).
Sanction/channel/message logic lives in `src/bot/moderation/`; the component and text-prefix styles are
new adapters in `src/bot/components/` and `src/bot/text/` over the unchanged `src/bot/members/`
capability (Principle I, FR-013, FR-019). No new durable bot record (FR-021); the one new table is
component→role bindings (configuration).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6 (Setup, Foundational, Polish carry no story label)
- File paths are exact and relative to repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm prerequisites. No new dependency. Sanctions/components need NO new gateway intent
(they add bot-role *permissions* and use the existing interaction gateway). Only the text-prefix style
(US6) adds the Message Content intent, gated by a process-wide config flag (added in its phase).

- [ ] T001 Verify prerequisites: confirm `discord.js` is a dependency; confirm `src/bot/moderation/standing.ts` exports `isModerator` + `ModeratedCapability` + `PermissionView` (US1–US4 extend it); confirm `src/bot/members/roles.ts`/`nickname.ts` export the capabilities the component + text-prefix styles reuse; confirm `src/bot/events/interaction-create.ts` early-returns on non-command interactions (the branch point for components) and `src/bot/events/index.ts` + `bindHandlers` exist. No code change; verification gate per plan Structure Decision.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared moderation plumbing every sanction/channel story depends on — the extended
native-permission map and a reusable hierarchy-guard helper. After this phase the gate + guards exist;
no command uses them yet. (The component-binding store is foundational only for US5 and is created in
that phase to keep US1–US4 independent of it.)

**⚠️ CRITICAL**: Complete before the sanction/channel user-story phases (US1–US4).

- [ ] T002 Extend `src/bot/moderation/standing.ts`: add `timeout | kick | ban | purge | pin | slowmode | lock` to `ModeratedCapability` and map each to its native permission (`timeout→ModerateMembers`, `kick→KickMembers`, `ban→BanMembers`, `purge/pin→ManageMessages`, `slowmode/lock→ManageChannels`). Keep `isModerator` and the existing `nickname`/`role` entries unchanged. Per research §1.
- [ ] T003 [P] Create a reusable hierarchy-guard helper in `src/bot/moderation/guards.ts`: given a target member view (bot-highest-position, bot-can-manage flag, target-highest-position) and the invoker's highest position, return a structured refusal (`bot-cannot-manage` | `invoker-outranked`) or null-pass — the shared bot-position + invoker-position check used by every member sanction (mirrors the guard 005 added in `setMemberRole`). Pure over minimal views. Per research §2.
- [ ] T004 Extend `tests/machinery/moderation-standing.test.ts`: assert each new capability maps to the correct native permission (timeout→ModerateMembers, kick→KickMembers, ban→BanMembers, purge/pin→ManageMessages, slowmode/lock→ManageChannels) and that an invoker lacking it is denied. (Covers FR-005/FR-007 gate.)

**Checkpoint**: The native-permission gate covers all moderation capabilities and the hierarchy guard
is unit-tested; `check:all` green; nothing member-facing yet.

---

## Phase 3: User Story 1 — A moderator times a member out (Priority: P1) 🎯 MVP

**Goal**: `/timeout` applies/clears a self-expiring timeout, native-permission-gated, hierarchy-guarded,
audit-reason recorded, failing safe. Establishes the sanction shape US2–US4 reuse.

**Independent test**: A moderator times a member out for an in-range duration (restricted then
auto-restored) and clears it; a non-moderator and an unmanageable/out-ranking target are safe refusals.

- [ ] T005 [P] [US1] Create `src/bot/moderation/sanctions.ts` with `timeoutMember(memberView, durationMs, opts)` and `clearTimeout(memberView)`: validate duration in `(0, 28d]` (FR-006), run the shared hierarchy guard (T003), then apply/clear the timeout; a self/bot target and any expected failure is a structured safe refusal, never a throw. Per contract sanctions.md, research §2.
- [ ] T006 [US1] Create `tests/machinery/moderation-sanctions.test.ts` (timeout cases): in-range timeout applies; out-of-range/non-positive refused; clear lifts it; hierarchy-guard refusals (target outranks bot / invoker; missing bot permission); self-target and bot-target refused; mutation throw → clean refusal. (Covers FR-001/FR-005/FR-006/FR-007, SC-002/SC-003.)
- [ ] T007 [US1] Create `src/bot/commands/timeout.ts`: `/timeout` slash command (`member`, `duration`, optional `reason`; `duration:0`/clear lifts). Thin adapter — gate via `isModerator(invoker, 'timeout')`, build the target member view + invoker position, call the capability, render an ephemeral outcome. Per contract sanctions.md.
- [ ] T008 [US1] Edit `src/bot/commands/index.ts`: register `timeoutCommand` at the one wiring point.

**Checkpoint**: `/timeout` works end to end with all guards; `check:all` green. **US1 is the
moderation MVP** — the sanction shape is proven.

---

## Phase 4: User Story 2 — A moderator kicks or bans a present member (Priority: P1)

**Goal**: `/kick` and `/ban` (present member, optional message-delete window) remove members with the
same gate/guard shape as US1, audit reasons recorded.

**Independent test**: A moderator kicks (removed, may rejoin) and bans (removed, blocked, optional
purge) a present member; a non-moderator and an unmanageable/out-ranking target are safe refusals.

- [ ] T009 [P] [US2] Extend `src/bot/moderation/sanctions.ts` with `kickMember(memberView, opts)` and `banMember(target, opts)` for a PRESENT member (opts: reason, deleteMessageSeconds): run the hierarchy guard, apply kick/ban, safe refusal on any expected failure. (Ban-by-id/unban/bulk/list are US3.) Per contract sanctions.md.
- [ ] T010 [US2] Extend `tests/machinery/moderation-sanctions.test.ts` (kick/ban present-member cases): kick removes; ban removes with optional delete window; hierarchy + permission refusals; self/bot-target refused; mutation throw → clean refusal. (Covers FR-002/FR-005/FR-007, SC-001/SC-002.)
- [ ] T011 [P] [US2] Create `src/bot/commands/kick.ts`: `/kick` (`member`, optional `reason`) — gate `isModerator(invoker,'kick')`, call `kickMember`, ephemeral outcome.
- [ ] T012 [US2] Create `src/bot/commands/ban.ts`: `/ban` slash command with `member`, `user_id`, and `user_ids` options (+ `reason`, `delete_messages`) — this phase wires only the **present-member** `member` path (calls `banMember`); the `user_id`/`user_ids` ban-list paths are added in US3 (T016). Gate `isModerator(invoker,'ban')`. Per clarification (one unified `/ban`) + contract sanctions.md.
- [ ] T013 [US2] Edit `src/bot/commands/index.ts`: register `kickCommand` and `banCommand`.

**Checkpoint**: `/kick` and present-member `/ban` work with all guards; `check:all` green.

---

## Phase 5: User Story 3 — A moderator manages the ban list (Priority: P2)

**Goal**: The full ban cluster beyond present members — pre-emptive ban-by-id, unban, list, bulk —
completing the one unified `/ban` plus `/unban` and `/bans`.

**Independent test**: A moderator pre-emptively bans an absent id (can't join), unbans (can join),
lists bans, and bulk-bans (per-id outcomes, no abort on one bad id); a non-moderator is refused.

- [ ] T014 [P] [US3] Extend `src/bot/moderation/sanctions.ts` with ban-list ops: `banUserId(guildView, userId, opts)` (pre-emptive), `unbanUserId(guildView, userId, opts)`, `listBans(guildView)`, `bulkBanUserIds(guildView, userIds[], opts)`. Ban-by-id/unban act on the guild ban list directly (no member-hierarchy for an absent user); `bulkBan` returns a per-id outcome array and never aborts on one bad id; re-ban/not-banned are idempotent structured messages. Per research §3, FR-003.
- [ ] T015 [US3] Extend `tests/machinery/moderation-sanctions.test.ts` (ban-list cases): ban-by-id adds to the list; unban removes; list returns entries+reasons; bulk reports per-id outcomes and continues past a bad id; re-ban/not-banned are idempotent (not errors); non-permission refused. (Covers FR-003, SC-001, edge cases.)
- [ ] T016 [US3] Edit `src/bot/commands/ban.ts`: wire the `user_id` (pre-emptive) and `user_ids` (bulk) option paths to `banUserId`/`bulkBanUserIds`; the command selects the mode from which option is supplied (clarification: one unified `/ban`). Render the bulk per-id report ephemerally.
- [ ] T017 [P] [US3] Create `src/bot/commands/unban.ts` (`/unban` — `user_id`, optional `reason`) and `src/bot/commands/bans.ts` (`/bans` — list, ephemeral); gate both via `isModerator(invoker,'ban')`.
- [ ] T018 [US3] Edit `src/bot/commands/index.ts`: register `unbanCommand` and `bansCommand`.

**Checkpoint**: The full ban cluster works; bulk is per-id-safe; `check:all` green.

---

## Phase 6: User Story 4 — A moderator moderates messages and channels (Priority: P2)

**Goal**: `/purge`, `/slowmode`, `/lock`+`/unlock`, `/pin`+`/unpin` — channel/message moderation,
native-permission-gated, respecting platform limits.

**Independent test**: A moderator purges N messages (older-than-14d skipped, reported), sets/clears
slowmode, locks/unlocks, pins/unpins; a non-moderator is refused; unsupported channel type refused.

- [ ] T019 [P] [US4] Create `src/bot/moderation/channel.ts` with `purgeMessages(channelView, count, opts?)` (report deleted + skipped-too-old per the 14-day bulk limit), `setSlowmode(channelView, seconds)` (0 clears; validate range), `lockChannel/unlockChannel(channelView, opts?)` (member send overwrite), `pinMessage/unpinMessage(messageView)`. Thread an optional `reason` (opts) to the platform audit-log parameter where the action supports it (purge/lock/unlock; slowmode/pin have no audit reason) — FR-004. Unsupported channel type → structured refusal, no partial state. Pure over minimal channel/message views. Per contract sanctions.md, research §4.
- [ ] T020 [US4] Create `tests/machinery/moderation-channel.test.ts`: purge count + age-skip report; slowmode set/clear + range refusal; lock/unlock overwrite; pin/unpin toggle; unsupported-channel refusal; permission refusals. (Covers FR-008/FR-009/FR-010, SC-004.)
- [ ] T021 [P] [US4] Create the channel/message slash commands: `src/bot/commands/purge.ts` (`count`, optional `reason`), `slowmode.ts` (`seconds`), `lock.ts` (`/lock`+`/unlock`), `pin.ts` (`/pin`+`/unpin`, `message_id`). Each gates via `isModerator`: purge→`'purge'`, pin AND **unpin**→`'pin'`, slowmode→`'slowmode'`, lock AND **unlock**→`'lock'`. `/unlock` and `/unpin` reuse the `lock`/`pin` capability keys (same native permission) — do NOT add `unlock`/`unpin` keys to `standing.ts`. Each calls the capability and renders an ephemeral outcome.
- [ ] T022 [US4] Edit `src/bot/commands/index.ts`: register the purge/slowmode/lock/pin commands.

**Checkpoint**: Channel/message moderation works within platform limits; `check:all` green.

---

## Phase 7: User Story 5 — Role via button / select menu (Priority: P2)

**Goal**: A member toggles a whitelisted role by activating an operator-configured component, reusing
the 004 whitelist gate and the unchanged `toggleSelfRole` capability.

**Independent test**: An operator-configured button/menu bound to a whitelisted role toggles it on/off
when activated; a component bound to a non-whitelisted role does nothing.

- [ ] T023 [US5] Create `migrations/0008_component_role_bindings.sql`: table `component_role_bindings (guild_id text, component_key text, component_kind text CHECK IN ('button','select'), role_id text, created_at timestamptz DEFAULT now(), PRIMARY KEY (guild_id, component_key))`. Additive; ledger-tracked; no FKs. Per data-model.md.
- [ ] T024 [US5] Add `ComponentRoleBinding` type + `listComponentRoleBindings(guildId)` to `src/db/repository.ts` and implement in `src/db/pg-repository.ts` (parameterized SELECT, live read). Add the method to the test-fake repositories so they still satisfy the interface. Per data-model.md.
- [ ] T025 [P] [US5] Create `src/bot/components/resolve.ts`: pure `resolveComponentRole({ bindings, whitelistRoleIds, componentKey })` → role id | null (binding match AND whitelisted; else null) — mirrors 005's reaction resolver. Per contract interaction-styles.md.
- [ ] T026 [US5] Create `tests/machinery/component-resolve.test.ts`: binding+whitelist intersection (bound+whitelisted → id; bound-not-whitelisted → null; unbound → null); button vs select key match. Pure-object tests. (Covers FR-011/FR-013, SC-005.)
- [ ] T027 [US5] Create the component dispatcher: `src/bot/components/registry.ts` (self-registering handlers keyed by customId) + `src/bot/components/index.ts` (wiring point), and a role-component handler that reads bindings+whitelist via `getContext().repo`, calls `resolveComponentRole`, then `toggleSelfRole`, replying ephemerally. Per contract interaction-styles.md.
- [ ] T028 [US5] Edit `src/bot/events/interaction-create.ts`: **restructure** the current early-return (`if (!interaction.isChatInputCommand()) return;`) into a dispatch fork — command interactions to the command path (unchanged behavior), and `interaction.isButton()`/`isAnySelectMenu()` to the component registry (generic dispatch by customId; per-handler failure containment; no switch). Do NOT merely append a branch after the early-return — it would be unreachable. Import `components/index` at the events wiring point. Per FR-019.
- [ ] T029 [US5] Add a DB-integration test for `listComponentRoleBindings` in `tests/machinery/` (guarded on `DATABASE_URL`, self-skips offline; named test-guild rows + cleanup), as in 005. Verifies FR-013/FR-014 against real Postgres.

**Checkpoint**: Component role menus toggle whitelisted roles; non-whitelisted no-op; `check:all` green.

---

## Phase 8: User Story 6 — Text-prefix commands (Priority: P3)

**Goal**: When the process-wide text-prefix switch is on, prefixed messages run the existing
role/nickname capabilities; when off (default), the bot boots, Message Content is not requested, and
every other style works.

**Independent test**: With the switch on, `!role`/`!roles`/`!nick` give the same outcomes as the slash
commands; with it off, prefix messages do nothing and all other styles work.

- [ ] T030 [US6] Edit `src/config.ts`: add a process-wide text-prefix enablement flag + prefix string (off/empty by default), read once at startup. Per clarification (process-wide switch) + research §6.
- [ ] T031 [US6] Edit `src/bot/client.ts`: request the Message Content intent ONLY when the text-prefix flag is on (off by default → intent absent). Per FR-015, research §6.
- [ ] T032 [P] [US6] Create `src/bot/text/prefix.ts`: pure parser mapping a prefixed message string → a `(capability, args)` for `!role <role>` / `!roles` / `!nick [name]`; returns null for non-matching messages. No discord.js. Per contract interaction-styles.md.
- [ ] T033 [US6] Create `tests/machinery/text-prefix.test.ts`: parse each prefix command to the right capability+args; non-prefixed/unknown → null; asserts the parser is style-agnostic. (Covers FR-012.)
- [ ] T034 [US6] Edit `tests/machinery/bot-intents.test.ts`: assert Message Content is ABSENT by default, and PRESENT only when the text-prefix flag is on (drive `createBotClient` with the flag both ways). (Covers FR-015, SC-006.)
- [ ] T035 [US6] Create `src/bot/events/message-create.ts`: a `messageCreate` handler that no-ops unless the flag is on; when on, parse via `text/prefix.ts`, resolve the target member view, and call the same role/nickname capability (same gate as slash), replying/ignoring quietly (no channel spam). Register it in `src/bot/events/index.ts`. Per contract interaction-styles.md, FR-016/FR-018.

**Checkpoint**: Text-prefix works when enabled and is fully isolated when off; `check:all` green.

---

## Phase 9: Polish & End-to-End Verification

**Purpose**: Register commands, drive the automatable E2E path, confirm no regression, update docs.

- [ ] T036 Run `npm run check:all` — format, lint, typecheck, full unit suite green (Principle V gate).
- [ ] T037 [P] E2E (DB): with `DATABASE_URL` set, `npm run migrate` (applies 0008), then via a scripted check seed a named component binding + whitelist row, read them back through the repo, drive `resolveComponentRole` + `toggleSelfRole` against a fake member surface to assert toggle/no-op, then delete the test rows. Report real read-back values. (Automatable slice of quickstart §5; per Testing Discipline.)
- [ ] T038 [P] E2E (command payloads): run `npm run deploy:commands` in dev-guild mode (or serialize the builders) to confirm all new commands — `/timeout /kick /ban /unban /bans /purge /slowmode /lock /pin` — register with the expected options and no schema error (esp. the unified `/ban` with member/user_id/user_ids). Per quickstart §1.
- [ ] T039 [P] Update `docs/OPERATIONS.md`: the moderation commands + the bot-role permissions they need (Moderate/Kick/Ban Members, Manage Messages, Manage Channels — least privilege, not Admin); how to bind a component to a whitelisted role (`component_role_bindings` row shape); and that text-prefix is a process-wide opt-in that turns on Message Content (off by default). State rules directly (no spec/FR citations — Principle V).
- [ ] T040 Manual-only residue (documented, not automatable here): confirm in a live guild that a real timeout/kick/ban/purge takes effect, a component button toggles a role, and (if enabled) a text-prefix command runs — requires the live bot + a human. List exactly this in the review artifact as the irreducible manual slice.

---

## Dependencies & Execution Order

- **Setup (T001)** → gate only.
- **Foundational (T002–T004)** blocks the sanction/channel stories (US1–US4): the standing extension
  (T002) and the hierarchy guard (T003) are used by every member sanction.
- **US1 (T005–T008)** is the moderation MVP; depends on Foundational.
- **US2 (T009–T013)** depends on US1's `sanctions.ts` + the guard (extends the same file).
- **US3 (T014–T018)** depends on US2's `ban.ts` (extends it for the ban-list option paths) + `sanctions.ts`.
- **US4 (T019–T022)** depends only on Foundational (new `channel.ts`) — independent of US1–US3, can run
  in parallel with them after Phase 2.
- **US5 (T023–T029)** depends on the 004 whitelist + `toggleSelfRole` (already built); self-contained
  (its own table/resolver/dispatcher) — independent of US1–US4.
- **US6 (T030–T035)** depends on the 004/005 role/nickname capabilities (built) + the config/intent
  flag; self-contained — independent of US1–US5.
- **Polish (T036–T040)** after the stories it verifies.

## Parallel opportunities

- After Foundational, the **member-sanction line (US1→US2→US3)**, **US4 (channel/message)**, **US5
  (components)**, and **US6 (text-prefix)** touch largely disjoint files and can proceed in parallel.
- Within a story, the `[P]` capability/logic files are independent of their command/dispatcher adapter
  and its tests, which come after.
- Note the one intra-file serialization: US1→US2→US3 all extend `src/bot/moderation/sanctions.ts` and
  US2→US3 both edit `src/bot/commands/ban.ts`, so those steps serialize within that file.

## Implementation strategy

MVP = Setup + Foundational + US1 (`/timeout` with full gate/guard shape). Each subsequent story is an
independent, testable increment: US2 (kick/ban present) and US3 (ban-list) complete the ban surface;
US4 (channel/message) is a parallel track; US5 (components) and US6 (text-prefix) are the interaction
styles. `check:all` stays green at every checkpoint (Principle V). No new durable bot record at any
step (FR-021).
