# Phase 0 Research: Self-Service Roles & Nicknames

This feature is bot-side and extends the existing command/registry/dispatch seams. The design
decisions are how the capability logic performs role/nickname changes safely via discord.js, how the
authorization gate is structured, and how the whitelist is stored and read. Each is a local decision
grounded in the existing code and the installed discord.js (verified: `PermissionFlagsBits.ManageRoles`/
`ManageNicknames`, `Guilds`+`GuildMembers` intents, and `GuildMember`/`Role` classes all present in
14.26). No new external technology.

## 1. Separating capability logic from the slash-command adapter

**Decision**: Put the three capabilities — `toggleSelfRole`, `listSelfAssignableRoles`,
`setOwnNickname` — in a new `src/bot/members/` module as functions that take the inputs they need
(the invoking member, the chosen role / nickname, the whitelist) and return a structured outcome
(changed / refused-with-reason). The `commands/role.ts`, `commands/roles.ts`, `commands/nick.ts`
modules are thin adapters: parse the slash interaction, call the capability, render the outcome as an
ephemeral reply.

**Rationale**: Principle I — a capability is logic; a slash command is one adapter onto it. Keeping
the authorization gate and the role/nickname mechanics out of the command module makes them
unit-testable without a live interaction, and lets 005 add button/reaction adapters over the same
functions with no change. It mirrors how the source-adapter and transform patterns already separate
"what it does" from "how it's invoked."

**Alternatives considered**:
- **Logic inline in each command's `execute`.** Rejected: couples the security-critical guard to the
  slash-interaction surface, makes it un-unit-testable without mocking a full interaction, and would
  force a rewrite when 005 adds other interaction styles — the exact failure mode Principle I exists
  to prevent.

## 2. Performing role and nickname changes safely (the bot-position guard)

**Decision**: The capability functions operate on the discord.js `GuildMember` and `Role` objects:
- **Role toggle**: read the member's current roles; if they have the chosen role, `member.roles.remove(role)`, else `member.roles.add(role)`.
- **Nickname**: `member.setNickname(value | null)` (null clears it).
Before any mutation, the **bot-position guard** runs: compare the target role's position (for a
role toggle) or the target member's highest role (for a nickname change) against the bot's own
highest role, and confirm the bot holds the relevant permission (`ManageRoles` / `ManageNicknames`).
If the bot is not higher, or lacks the permission, the function returns a refusal with a diagnosable
reason and performs no mutation (FR-007/FR-008).

**Rationale**: Discord enforces role hierarchy server-side (a bot can only manage roles below its own
highest), so an unchecked attempt would throw a `DiscordAPIError` (50013 Missing Permissions).
Checking position + permission *before* the call turns that into a clean, member-actionable refusal
("I can't manage that role — it's above my own") instead of a generic caught error, and guarantees
"never half-acts." The guard is pure comparison logic over already-fetched objects — fast, testable.

**Alternatives considered**:
- **Just attempt the change and catch the API error.** Rejected: produces a generic error, not the
  specific diagnosable reason the spec requires, and conflates "above the bot" with other failures.
  The proactive guard is the testable, member-friendly path. (The attempt is still wrapped in
  try/catch as a backstop for races — role deleted between check and call — surfacing a clean
  refusal, never a crash.)

## 3. The authorization gate (whitelist + self-only), evaluated before any side effect

**Decision**: Every role mutation passes a gate, in order: (a) the chosen role's identifier is
present in the guild's self-assignable whitelist (else refuse — FR-002); (b) the action targets the
invoking member only — the commands expose no "target member" option, so self-only is structural,
and the capability function operates on the interaction's own member, never an arbitrary one
(FR-010); (c) the bot-position guard (§2). Only if all pass does the toggle run.

**Rationale**: The whitelist is the *entire* authorization (no entry = not assignable), so it must be
checked before any change, and there must be no input that bypasses it (SC-002). Self-only is
enforced by simply not offering a target-member parameter — the safest design is to make the unsafe
action unrepresentable rather than guard against it. This is the bot-side analogue of "verify before
process."

**Alternatives considered**:
- **A `/role @member` form with a permission check.** Rejected: that is a moderation capability
  (acting on others), explicitly out of scope (FR-010) and owned by a later spec. Not offering the
  parameter is simpler and safer.

## 4. Whitelist storage: a per-guild self_assignable_roles table

**Decision**: A new table `self_assignable_roles (guild_id text, role_id text, created_at)` with a
unique `(guild_id, role_id)`, read by a new `Repository.listSelfAssignableRoles(guildId)` returning
the set of role IDs. The presence of a row is the whole authorization. Operators curate it by editing
rows directly (the table editor), exactly like `routes` (FR-005, and the clarified "direct editing
only" scope). Read live per command so an operator edit governs the next request.

**Rationale**: Mirrors the existing runtime-mutable-data pattern (rows the operator edits, no deploy).
Identifier-based (`role_id`, not name) so a role rename doesn't break the entry and a deleted role is
detected by absence in the live guild (the clarified role-picker decision relies on stable IDs).
Per-guild (`guild_id` column) so the same role isn't cross-assignable between servers (FR-014) —
consistent with how `discord_targets` already carries `guild_id`. The repository method keeps DB
access behind the existing `Repository` interface (swappable backend, fake-able in tests).

**Alternatives considered**:
- **Reuse a generic `bot_state` kv table.** Rejected for this feature: a typed table with a unique
  constraint gives integrity (no duplicate entries) and a clean indexed read; a kv blob would push
  validation into code and lose the DB-level uniqueness. (`bot_state`/kv may still arrive later for
  free-form per-guild config, but the whitelist deserves its own typed table.)
- **Storing role names instead of IDs.** Rejected: names break on rename and collide on duplicates;
  the role-picker clarification settled on stable identifiers.

## 5. Command registration and least-privilege (no new intent)

**Decision**: The three commands self-register in `commands/index.ts` and are pushed to Discord via
the existing `deploy-commands` script (guild-scoped in dev, global in prod) — an operational step.
**No gateway intent change**: role and nickname management are REST operations on the member;
`member.roles.add/remove` and `member.setNickname` need the bot to hold the `ManageRoles` /
`ManageNicknames` *permission* (an OAuth/role grant in the server) and the already-present
`Guilds`+`GuildMembers` intents — not the privileged Message Content intent (FR-012).

**Rationale**: Verified the current client already requests exactly `Guilds`+`GuildMembers`, which is
sufficient; adding nothing keeps least-privilege intact and means the bot still boots/functions with
Message Content off. The permission (vs. intent) requirement is an operational precondition the
operator arranges by positioning/permissioning the bot's role — documented in quickstart, surfaced as
a clean refusal by the bot-position guard if unmet.

**Alternatives considered**:
- **Requesting additional intents defensively.** Rejected: violates least-privilege (Principle II /
  FR-012) for no functional gain; the needed operations are permission-gated REST calls, not intent-
  gated gateway events.

## 6. Failure containment and idempotent toggle (reuse + by-construction)

**Decision**: Rely on the existing `interactionCreate` try/catch (which already turns a throwing
command into an ephemeral error, never disconnecting the bot) as the backstop, while each capability
function returns structured refusals for the *expected* failure modes (non-whitelisted, above-bot,
deleted role, over-limit nickname) so the member gets a specific message rather than the generic
catch. The role toggle is idempotent by construction: it reads current state and converges to a
single has/has-not result, so a concurrent double-invoke cannot duplicate or partially apply.

**Rationale**: FR-013 (a failure must not crash the bot / affect other commands) is *already*
satisfied by the existing dispatcher; this feature adds specific refusals on top for diagnosability,
not a new error path. The toggle's read-then-converge shape gives the "deterministic concurrent
toggle" edge case for free.

## Resolved unknowns

All Technical Context items are resolved; no `NEEDS CLARIFICATION` remain. Command names default to
`/role`, `/roles`, `/nick` (a plan/implementation detail, finalized in contracts); the listing is not
paginated in this feature (a whitelist is small; if a guild ever exceeds a single reply's capacity
that is a later refinement, noted but not built).
