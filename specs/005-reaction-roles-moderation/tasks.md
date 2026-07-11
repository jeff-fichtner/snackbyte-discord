---
description: 'Task list for the reaction-roles & moderation (BED-BOT parity, Phase 3) feature'
---

# Tasks: Reaction-Roles & Moderation (BED-BOT parity, Phase 3)

**Input**: Design documents from `/specs/005-reaction-roles-moderation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md.
Builds on the shipped 001–004 bot: the command registry + `commands/index.ts` wiring point; the one
`interactionCreate` dispatcher (contains a throwing command — FR-014 backstop); the event registry +
`events/index.ts` wiring point + `bindHandlers` per-handler containment; `getContext().repo` for DB
access; the `Repository` interface + Pg impl; the `schema_migrations` migration ledger; and the
`src/bot/members/` capability logic (the authorization gate 005 reuses unchanged).

**Tests**: Included — spec/plan/quickstart call for Vitest coverage and Principle V requires
`check:all` (which runs tests) to stay green at every step. Scoped to the pure logic (reaction
resolution, the shared authorization gate's directed grant/revoke, the moderator-standing check, the
cross-member capability, the intents/partials assertion); the event handler and command modules are
thin adapters.

**Organization**: Grouped by user story (spec priority — US1 P1, US2 P1, US3 P1, US4 P2). New
interaction-style-agnostic logic lives in `src/bot/reactions/` and `src/bot/moderation/`; the
reaction event handler and the grown `/nick` `/role` commands adapt live discord.js objects onto it
and onto the unchanged `src/bot/members/` capability (Principle I, FR-005, FR-016). One new gateway
intent (`GuildMessageReactions`) + partials for reactions; **no Message Content**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 / US4 (Setup, Foundational, Polish carry no story label)
- File paths are exact and relative to repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm prerequisites. No new dependency. One new gateway **intent**
(`GuildMessageReactions`) + Message/Reaction **partials** are required for reactions (research §1) —
added in Foundational, asserted by the intents test. Moderation adds **no** intent (reads command
options, not message text).

- [X] T001 Verify prerequisites: confirm `discord.js` is a dependency; confirm `src/bot/members/roles.ts` exports `toggleSelfRole` + the `MemberView`/`RoleView` shapes and `src/bot/members/nickname.ts` exports `setOwnNickname` + `NicknameMemberView` (005 extends these, does not rewrite them); confirm `src/bot/events/index.ts` + `registry.ts` + `bindHandlers` exist as the event wiring/containment point. No code change; verification gate per plan Structure Decision.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The reaction-role mapping store (table + repository read) and the intent/partials
change, which the reaction stories (US1, US2) depend on. After this phase a guild's mappings can be
read and the client receives reaction events; nothing acts on them yet.

**⚠️ CRITICAL**: Complete before the reaction user-story phases (US1/US2). US3/US4 (moderation) do
not depend on this phase and MAY proceed in parallel with it.

- [X] T002 Create `migrations/0007_reaction_role_mappings.sql`: table `reaction_role_mappings (guild_id text NOT NULL, message_id text NOT NULL, emoji_key text NOT NULL, emoji_kind text NOT NULL CHECK (emoji_kind IN ('unicode','custom')), role_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (guild_id, message_id, emoji_key))`. Additive; runs once via the ledger; no FKs (external Discord ids). Per data-model.md.
- [X] T003 Add `ReactionRoleMapping` interface (`messageId`, `emojiKey`, `roleId`) and `listReactionRoleMappings(guildId: string): Promise<ReactionRoleMapping[]>` to the `Repository` interface in `src/db/repository.ts`; implement in `src/db/pg-repository.ts` as parameterized `SELECT message_id, emoji_key, role_id FROM reaction_role_mappings WHERE guild_id = $1` (empty array when none). Read live (no cache). Per data-model.md.
- [X] T004 Edit `src/bot/client.ts`: add `GatewayIntentBits.GuildMessageReactions` and `Partials.Message` + `Partials.Reaction` to the client. Do NOT add `MessageContent`. Update the file's intent comment to state reactions are now needed (and Message Content still is not). Per research §1.
- [X] T005 Edit `tests/machinery/bot-intents.test.ts`: assert the client requests Guilds + GuildMembers + GuildMessageReactions and the two partials, and still does NOT request MessageContent; update the "exactly these intents" assertion to the new expected set. Per research §1 / SC-006.

**Checkpoint**: `npm run migrate` applies 0007; the repository can read a guild's mappings; the
client receives reaction events with partials; `check:all` green; nothing member-facing yet.

---

## Phase 3: User Story 1 — Member self-assigns a whitelisted role by reacting (Priority: P1) 🎯 MVP

**Goal**: Reacting with a mapped+whitelisted emoji grants the role; un-reacting removes it; unmapped
/ non-whitelisted / bot / un-cached cases behave per contract. Reuses the 004 authorization gate.

**Independent test**: With one mapping to a whitelisted role, add the reaction (role granted), remove
it (role removed), react with an unmapped emoji (no-op) — all via reactions, no command.

- [X] T006 [P] [US1] Add directed entry points to `src/bot/members/roles.ts`: `grantSelfRole(member, role, whitelistRoleIds)` and `revokeSelfRole(member, role, whitelistRoleIds)` that share the SAME gate as `toggleSelfRole` (whitelist + bot-position + Manage Roles) but act in a fixed direction (grant = add-if-absent, revoke = remove-if-present); a redundant add/remove and a mutation throw are clean no-ops, never a toggle-off or a throw. Keep `toggleSelfRole` unchanged. Per research §5, contract reaction-roles.md.
- [X] T007 [P] [US1] Create `src/bot/reactions/resolve.ts`: pure `resolveReactionRole({ mappings, whitelistRoleIds, messageId, emojiKey, reactorIsBot })` → role id | null. Returns a role id only when reactor is not the bot AND a mapping matches `(messageId, emojiKey)` AND that mapping's role is whitelisted; else null. No discord.js import. Per data-model.md, contract reaction-roles.md.
- [X] T008 [US1] Create `tests/machinery/reaction-resolve.test.ts`: mapping+whitelist intersection (mapped+whitelisted → id; mapped-not-whitelisted → null; unmapped → null); emoji identity (unicode codepoint key and custom-emoji-id key both match; wrong key → null); reactor-is-bot → null. Pure-object tests. (Covers FR-002, FR-004, FR-007, SC-002.)
- [X] T009 [US1] Create `tests/machinery/member-roles.test.ts` additions (directed grant/revoke): grant adds an absent whitelisted role; grant on a role already held is a no-op (not a toggle-off); revoke removes a held role; revoke on an absent role is a no-op; non-whitelisted → refused; role above bot / missing Manage Roles → refused; mutation throw → clean refusal. (Covers FR-001, FR-005, SC-005.)
- [X] T010 [US1] Create `src/bot/events/message-reaction.ts`: two `EventHandler`s (`Events.MessageReactionAdd`, `Events.MessageReactionRemove`). Each adapts the live reaction — resolve the (possibly partial) message id + emoji key (`emoji.id ?? emoji.name`), read the guild's mappings + whitelist via `getContext().repo`, call `resolveReactionRole`, and on a non-null role id build a `MemberView` for the reacting member and call `grantSelfRole` (add) / `revokeSelfRole` (remove). A null resolve or any failure is a silent, logged no-op (no channel message). Handle partial fetch for un-cached messages (FR-006). Per contract reaction-roles.md.
- [X] T011 [US1] Edit `src/bot/events/index.ts`: import and `registerEvent(...)` the two reaction handlers at the one wiring point (generic dispatch via `bindHandlers`; no switch). Per FR-016.

**Checkpoint**: Reacting grants/revokes a whitelisted mapped role; unmapped/non-whitelisted/bot/
un-cached handled; `check:all` green. US1 is the reaction-roles MVP.

---

## Phase 4: User Story 2 — Operator configures a reaction-role mapping (Priority: P1)

**Goal**: An operator's mapping row (runtime data) makes a reaction live; removing it stops grants;
a mapping never bypasses the whitelist or auto-populates it.

**Independent test**: Insert a mapping → reaction grants (US1); delete it → reaction no-ops; map a
non-whitelisted role → reaction no-ops — all with no redeploy.

- [X] T012 [US2] Extend `tests/machinery/reaction-resolve.test.ts`: data-driven authorization — the SAME (message, emoji) resolves to a role with a mapping present and to null with it absent; a mapping to a non-whitelisted role resolves to null (mapping never bypasses whitelist, never auto-adds). Asserts the operator-edit-governs-next-reaction contract at the resolution layer. (Covers FR-002, FR-003, SC-002, SC-003.)
- [X] T013 [US2] Add a DB-integration test for `listReactionRoleMappings` in `tests/machinery/` (guarded to run only when `DATABASE_URL` is set, skipped otherwise so `check:all` stays green offline): apply schema, insert two named test-guild mappings, assert the repository returns them scoped to the guild (and none for another guild), then clean up the inserted rows. Verifies FR-003/FR-004 against real Postgres. (If no DB is reachable in CI, this self-skips; the pure resolver tests still cover the logic.)

**Checkpoint**: Operator mapping edits govern the next reaction with no redeploy; whitelist remains
the authorization; `check:all` green.

---

## Phase 5: User Story 3 — Moderator sets/clears another member's nickname (Priority: P1)

**Goal**: A member with Manage Nicknames sets/resets another member's nickname; a non-moderator is
refused for a target but keeps their own-nickname ability; bot-position guard applies to the target.

**Independent test**: Moderator sets/resets a target's nickname; non-moderator targeting another is
refused (own still works); target outranking the bot → safe refusal.

- [X] T014 [P] [US3] Create `src/bot/moderation/standing.ts`: pure `isModerator(view, capability)` returning whether the invoker holds the native permission for the capability (Manage Nicknames for `'nickname'`, Manage Roles for `'role'`). Over a minimal permission view; no discord.js import needed beyond the flag constants. Per research §6, contract moderation.md.
- [X] T015 [P] [US3] Edit `src/bot/members/nickname.ts`: add `setMemberNickname(memberView, value)` — same 32-char/whitespace validation and the same bot-position guard as `setOwnNickname`, applied to the target member view. Keep `setOwnNickname` unchanged. (The view already carries `botOutranksMember`/`botCanManageNicknames`, so the capability is target-agnostic — this is a thin wrapper making the cross-member call explicit.) Per contract moderation.md.
- [X] T016 [US3] Create `tests/machinery/moderation-standing.test.ts`: `isModerator` allows when the native permission is present and denies when absent, per capability (nickname vs role). Pure-object tests. (Covers FR-010.)
- [X] T017 [US3] Extend `tests/machinery/member-nickname.test.ts`: `setMemberNickname` set/reset on a target; over-limit + whitespace-only refused; bot-cannot-manage (target outranks bot / missing permission) refused with no change. (Covers FR-008, FR-011, SC-004, SC-005.)
- [X] T018 [US3] Edit `src/bot/commands/nick.ts`: add an optional `member` user option. If absent or equal to the invoker → the 004 `setOwnNickname` path unchanged. If a different target → gate on `isModerator(invoker, 'nickname')`; refuse ("you can only change your own nickname") if not; else build the target's `NicknameMemberView` and call `setMemberNickname`, rendering an ephemeral confirmation naming the target. Per contract moderation.md. (Self path preserves SC-007.)

**Checkpoint**: Cross-member nickname works for moderators, refuses non-moderators, guards the target;
own-nickname path unchanged; `check:all` green.

---

## Phase 6: User Story 4 — Moderator grants/removes a role on another member (Priority: P2)

**Goal**: A member with Manage Roles toggles a role on another member (not whitelist-bound), bounded
by the bot-position guard AND the invoker-position escalation guard; non-moderators refused; own path
unchanged.

**Independent test**: Moderator toggles a non-whitelisted role on a target (applied/removed);
non-moderator refused; role above bot or above the moderator → safe refusal.

- [X] T019 [P] [US4] Edit `src/bot/members/roles.ts`: add `setMemberRole(memberView, role, opts)` — toggles the role on the target member, NOT whitelist-bound (moderation manages non-self-assignable roles, FR-009), but refuses when the role is at/above the bot's highest position or the bot lacks Manage Roles (existing guard) OR the role is at/above the **invoker's** highest position (escalation guard, research §8a — the view/opts carry the invoker's highest position). A mutation throw is a clean refusal. Keep `toggleSelfRole`/`grantSelfRole`/`revokeSelfRole` unchanged. Per research §8/§8a, contract moderation.md.
- [X] T020 [US4] Extend `tests/machinery/member-roles.test.ts`: `setMemberRole` toggles a non-whitelisted role on a target (add then remove); refuses when role ≥ bot position / missing Manage Roles; refuses when role ≥ invoker position (escalation guard) with no change; mutation throw → clean refusal. (Covers FR-009, FR-011, SC-004, SC-005, research §8a.)
- [X] T021 [US4] Edit `src/bot/commands/role.ts`: add an optional `member` user option. If absent or equal to the invoker → the 004 `toggleSelfRole` self path unchanged. If a different target → gate on `isModerator(invoker, 'role')`; refuse ("you can only manage your own roles") if not; else build the target's `MemberView` (including the invoker's highest position for the escalation guard) and call `setMemberRole`, rendering an ephemeral confirmation naming the target and role. Per contract moderation.md. (Self path preserves SC-007.)

**Checkpoint**: Cross-member role management works for moderators within both guards, refuses
non-moderators, own path unchanged; `check:all` green.

---

## Phase 7: Polish & End-to-End Verification

**Purpose**: Re-register the grown commands, drive the automatable end-to-end path, confirm no
regression, refresh docs.

- [X] T022 Run `npm run check:all` — format, lint, typecheck, and the full unit suite green (Principle V gate).
- [X] T023 [P] E2E (DB): with `DATABASE_URL` set, `npm run migrate` (applies 0007), then via a scripted check insert a named test mapping + whitelist row for a test guild, read them back through `getContext().repo.listReactionRoleMappings` + `listSelfAssignableRoles`, drive `resolveReactionRole` + `grantSelfRole`/`revokeSelfRole` against a fake member surface to assert grant/revoke/no-op outcomes, then delete the test rows. Report the real read-back values. (Automatable slice of quickstart §3; per Testing Discipline — exhaust the automatable path.)
- [X] T024 [P] E2E (commands payload): run `npm run deploy:commands` in dev-guild mode (or a dry build of the payloads) to confirm the grown `/nick` and `/role` builders register with the new optional `member` option and no schema error. If live registration needs credentials only available interactively, build+serialize the command JSON and assert the `member` option is present instead. Per quickstart §2.
- [X] T025 [P] Update `docs/OPERATIONS.md` (and README pointer if present): how to add a reaction-role mapping (row shape, unicode vs custom emoji_key), that Message Content stays off, the new reactions intent/partials, and the cross-member `/nick`/`/role` moderator-permission requirement + the bot/moderator hierarchy rule. State the rules directly (no spec/FR citations — Principle V).
- [ ] T026 Manual-only residue (documented, not automatable here): confirm in a live guild that a real reaction grants/removes the role and that the grown commands appear in Discord — requires the live bot + a human reacting/clicking. List exactly this in the review artifact as the irreducible manual slice.

---

## Dependencies & Execution Order

- **Setup (T001)** → gate only.
- **Foundational (T002–T005)** blocks the reaction stories (US1/US2). Moderation (US3/US4) does NOT
  depend on it.
- **US1 (T006–T011)** is the reaction MVP. T006 (grant/revoke) + T007 (resolver) are [P] (different
  files); T008/T009 test them; T010 (handler) depends on T006+T007+T003; T011 wires T010.
- **US2 (T012–T013)** depends on US1's resolver + the repository read.
- **US3 (T014–T018)**: T014 (standing) + T015 (capability) are [P]; tests T016/T017; T018 (command)
  depends on T014+T015.
- **US4 (T019–T021)**: T019 (capability) [P]; test T020; T021 (command) depends on T014+T019.
- **Polish (T022–T026)** after the stories it verifies.

## Parallel opportunities

- Moderation (US3/US4) and reaction-roles (US1/US2) touch disjoint files and can proceed in parallel
  after Setup.
- Within a story, the [P] capability/logic files are independent of each other; the command/handler
  adapter and its tests come after.

## Implementation strategy

MVP = Setup + Foundational + US1 (a member can react to get/lose a whitelisted role). Each subsequent
story is an independent, testable increment: US2 (operator config governs it), US3 (moderate a nick),
US4 (moderate a role). `check:all` stays green at every checkpoint (Principle V).
