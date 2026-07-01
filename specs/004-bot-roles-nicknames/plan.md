# Implementation Plan: Self-Service Roles & Nicknames (BED-BOT parity)

**Branch**: `004-bot-roles-nicknames` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-bot-roles-nicknames/spec.md`

## Summary

Add member self-service slash commands — toggle a self-assignable role, list assignable roles, and
set/reset one's own nickname — all gated by an operator-curated, per-guild whitelist stored as
runtime data. The work extends the existing bot seams established in 001: commands self-register in
the command registry and dispatch through the one `interactionCreate` listener (which already
contains command failures so a throwing command never disconnects the bot), commands read the DB via
`getContext().repo`, and the gateway already holds the `Guilds` + `GuildMembers` intents that
role/nickname management needs — so **no new intent and no privileged Message Content** is required.
The only genuinely new pieces are: one migration for the whitelist table, a small repository method
to read the whitelist for a guild, the three capability functions (toggle / list / nickname) written
as pure-ish logic a slash command invokes, and the slash command modules that wrap them. The
security spine — whitelist-is-the-whole-authorization, the bot-position guard, and self-only action
— lives in the capability logic and is unit-tested directly.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), Node 24 — unchanged.

**Primary Dependencies**: No new runtime dependencies. Reuses `discord.js` 14 (slash command
builders, the REST/gateway client, `GuildMember` role/nickname management), `pg`, `pino`. Vitest +
Supertest for tests.

**Storage**: PostgreSQL (Supabase) via the existing repository. **One new table** (migration `0006`)
for the per-guild self-assignable-role whitelist; one new `Repository` method to read it. No change
to existing tables.

**Testing**: Vitest + Supertest. Unit: the three capability functions against a fake repository and
a fake guild-member surface — toggle add/remove, non-whitelisted refusal, bot-position-guard
refusal, self-only boundary, nickname set/reset/over-limit/whitespace, empty-whitelist listing,
deleted-role handling. The command modules are thin wrappers; the capability logic carries the
testable behavior (per FR-011, capability is logic, the command is an adapter).

**Target Platform**: Same single always-on Cloud Run service; no topology change. New commands are
registered with Discord via the existing `deploy-commands` script (guild-scoped in dev for instant
updates, global in prod) — an operational step, not new code.

**Performance Goals**: A self-service command responds within Discord's interaction window (the bot
defers immediately, as `ping` does, then edits the reply). The whitelist read is a single indexed
query per command, read live so an operator edit governs the next request (FR-005).

**Constraints**: Least-privilege — only the already-present `Guilds`/`GuildMembers` intents; no
Message Content (FR-012). The whitelist is runtime-mutable data; the command/guard logic is typed,
tested code (Principle IV). Member-facing replies are ephemeral (FR-009). The webhook → routing →
delivery pipeline is untouched (FR-015). No spec/FR citations in shipped code (Principle V).

**Scale/Scope**: Three commands + three capability functions + one whitelist table + one repository
method + one migration + tests. Small, additive, bot-only. Low command volume.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against snackbyte-discord Constitution v1.0.0:

| Principle | Gate for this feature | Status |
|-----------|-----------------------|--------|
| I. Patterns Over Instances | Each capability (toggle role / list / nickname) is logic; the slash command is one adapter onto it (FR-011), so a later button/reaction style reuses the same capability with no rewrite. Commands self-register at the one wiring point (`commands/index.ts`) and dispatch generically through `interactionCreate` — no central switch enumerates them. | ✅ PASS |
| II. Verify Before Process | No inbound webhook path is touched. The bot-side equivalent of "verify before process" is the authorization gate: the whitelist check + bot-position guard + self-only rule run before any role/nickname mutation; a member can never effect a change they aren't entitled to. Least-privilege intents (no Message Content) are preserved. | ✅ PASS |
| III. Idempotent, Rate-Limited Delivery | This feature does not deliver routed messages, so the delivery chokepoint is unaffected. Role/nickname writes go through discord.js's REST client (its rate-limit queue applies); the role toggle is idempotent by construction (add-if-absent / remove-if-present yields a single consistent state — spec edge case "concurrent toggles"). | ✅ PASS |
| IV. Runtime-Mutable Routing, Compile-Time-Safe Logic | The whitelist is operator-editable runtime data (a table edited like routes, FR-005); the toggle/guard/nickname logic is typed, reviewed, tested code. The security-critical decision (is this role self-assignable, may the bot manage it, is this the invoking member) is code, never a data-driven bypass. | ✅ PASS |
| V. Pinned, Typed, Tested + Speckit-in-Speckit | Node 24, strict TS, `check:all` stays green; shipped code states rules directly, cites no FR/spec/principle. | ✅ PASS |
| VI. Always-On Resilience | Liveness/readiness unchanged. A command failure (bad input, missing permission, ranking conflict, deleted role) is already contained by the existing `interactionCreate` try/catch → ephemeral error (FR-013); a DB-unavailable whitelist read fails that one command gracefully while the bot and other commands keep working. | ✅ PASS |
| VII. Secrets By Reference | No new secret. The whitelist rows hold non-secret role/guild identifiers; the bot token is already config. Nothing secret enters a row or a log. | ✅ PASS |

**One nuance to record (not a violation):** Principle II is written for inbound webhook verification;
this is an outbound/bot feature with no inbound payload. The analogous load-bearing security boundary
here is the **authorization gate** (whitelist + bot-position + self-only), which the plan treats with
the same "checked before any side effect" rigor. Called out so the mapping is explicit, not skipped.

**Result**: PASS — no violations, no Complexity Tracking entries required. (Re-checked after Phase 1
below: still PASS.)

## Project Structure

### Documentation (this feature)

```text
specs/004-bot-roles-nicknames/
├── plan.md              # This file
├── research.md          # Phase 0 — role/nickname management via discord.js; bot-position guard; whitelist shape
├── data-model.md        # Phase 1 — self_assignable_roles table + repository method (no change to existing tables)
├── quickstart.md        # Phase 1 — register commands, set whitelist, exercise toggle/list/nick + the guards
├── contracts/
│   ├── commands.md       # the three slash commands: names, options, ephemeral replies, refusal messages
│   └── role-capability.md # the capability contract: inputs, the authorization gate, outcomes (toggle/list/nick)
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

Extends the existing tree. **New** files marked `NEW`; the ★ folders are the extension points 001
established. The capability logic is separated from the command modules so it is unit-testable and
reusable by future interaction styles (FR-011).

```text
snackbyte-discord/
├── migrations/
│   └── 0006_self_assignable_roles.sql   # NEW: per-guild whitelist table (guild_id, role_id) + index
├── src/
│   ├── db/
│   │   ├── repository.ts             # EDIT: add listSelfAssignableRoles(guildId) to the Repository interface
│   │   └── pg-repository.ts          # EDIT: implement it (parameterized SELECT)
│   └── bot/
│       ├── members/                  # ★ NEW: member-management capability logic (interaction-style-agnostic)
│       │   ├── roles.ts              # NEW: toggleSelfRole + listSelfAssignableRoles capability (whitelist + bot-position + self-only guards)
│       │   └── nickname.ts           # NEW: setOwnNickname capability (32-char + whitespace + bot-position guard)
│       └── commands/
│           ├── role.ts               # NEW: /role command — role option, ephemeral, calls toggleSelfRole
│           ├── roles.ts              # NEW: /roles command — lists assignable roles, ephemeral
│           ├── nick.ts               # NEW: /nick command — optional nickname option, ephemeral, calls setOwnNickname
│           └── index.ts              # EDIT: register the three new commands at the one wiring point
└── tests/
    └── machinery/
        ├── member-roles.test.ts      # NEW: toggle add/remove, non-whitelisted refusal, bot-position guard, self-only, deleted role, empty list
        └── member-nickname.test.ts   # NEW: set/reset, over-limit, whitespace-only, bot-cannot-manage refusal
```

**Structure Decision**: A new `src/bot/members/` folder holds the capability logic (the toggle/list/
nickname functions + the authorization guards), separate from the thin `commands/*` modules that
adapt a slash interaction onto a capability. This is the Principle-I split made concrete: the
commands are one interaction adapter; 005 can add reaction/button adapters over the *same*
`members/` logic with no change to it. The whitelist is the only new data (one table, one repository
method); everything else — command registry, `interactionCreate` dispatch+failure-containment,
`getContext().repo`, the migration ledger, ephemeral-reply pattern — is reused unchanged.

## Complexity Tracking

No constitution violations; no justifications required. (Table omitted.)
