# Implementation Plan: Reaction-Roles & Moderation (BED-BOT parity, Phase 3)

**Branch**: `005-reaction-roles-moderation` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-reaction-roles-moderation/spec.md`

## Summary

Add two Phase-3 bot capabilities over the seams 001/004 already established, writing **no new
capability engine** — both are new input adapters and thin command grows over the existing
`src/bot/members/` logic (Principle I made concrete):

1. **Reaction-roles.** A member reacts to an operator-configured message and receives a whitelisted
   role; un-reacting removes it (the reaction is the source of truth — unconditional removal, no
   provenance tracking). A new `messageReactionAdd` / `messageReactionRemove` event handler resolves
   the reaction against an operator-curated `(guild, message, emoji) → role` mapping table, then
   delegates to the **existing** role capability's authorization gate (whitelist + bot-position +
   Manage Roles). The mapping is additive configuration; the 004 whitelist remains the whole
   authorization, so a reaction can never grant a role not both mapped and whitelisted.

2. **Cross-member moderation.** The `/nick` and `/role` commands grow an optional target-member
   option. When a target other than the invoker is named, a moderator-permission gate runs (the
   invoker's native Manage Nicknames / Manage Roles permission); with no target, the commands behave
   exactly as in 004 (self-service). Cross-member role management is not limited to the whitelist
   (moderation manages roles a member could not self-assign), but is still bounded by the same
   bot-position guard.

The genuinely new pieces are small: **one migration** for the reaction-role mapping table, **one
repository method** to read a guild's mappings, **one event handler** (with the reaction interaction
adapter), **two new capability entry points** on the existing role capability (explicit
grant/revoke, plus a moderator-standing check), a **cross-member nickname** entry point, and the
**edits to `/nick` and `/role`** to accept a target. Reaction events require adding the
`GuildMessageReactions` intent and the `Message`/`Reaction` partials (so an un-cached older message
still resolves, FR-006) — **Message Content stays off** (nothing here reads message text; FR-013,
SC-006). The security spine (authorization gate, bot-position guard, moderator standing) lives in
the capability logic and is unit-tested directly.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), Node 24 — unchanged.

**Primary Dependencies**: No new runtime dependencies. Reuses `discord.js` 14 (reaction gateway
events + partials, `GuildMember` role/nickname management, slash builders with a user option), `pg`,
`pino`. Vitest + Supertest for tests.

**Storage**: PostgreSQL (Supabase) via the existing repository. **One new table** (migration `0007`)
for the per-guild reaction-role mappings; one new `Repository` method to read them. No change to
existing tables. The 004 `self_assignable_roles` whitelist is read unchanged as the authorization.

**Testing**: Vitest. Unit: the role capability's explicit grant/revoke and the moderator-standing
gate against a fake member surface; the reaction-resolution logic (mapping + whitelist intersection,
emoji-identity match, self/bot-reaction ignore, un-cached no-op) against fakes; the cross-member
nickname path; the intents/partials assertion (reactions on, Message Content off). The command and
event modules are thin adapters; the capability + resolution logic carries the testable behavior
(FR-016). Where a live DB is reachable, a DB-integration check exercises the new repository method
end-to-end against real Postgres with named test rows and cleanup.

**Target Platform**: Same single always-on Cloud Run service; no topology change. The grown `/nick`
and `/role` payloads are re-registered with Discord via the existing `deploy-commands` script
(guild-scoped in dev, global in prod) — an operational step, not new code.

**Performance Goals**: A reaction grant/revoke is a single indexed mapping read + one role write,
well within normal gateway-event handling. Moderation commands defer immediately (as 004 does) and
respond within Discord's interaction window. The mapping read is live per reaction so an operator
edit governs the next reaction with no restart (FR-003).

**Constraints**: Least-privilege intents — add only `GuildMessageReactions` + the message/reaction
partials; **no Message Content** (FR-013). Mappings are runtime-mutable data; the resolution / guard
/ moderator-standing logic is typed, tested code (Principle IV). Moderation replies are ephemeral
(FR-012); reaction grants are silent (a reaction is not a command). The webhook → routing → delivery
pipeline and the 004 self-service commands are behaviorally untouched (FR-015). No spec/FR citations
in shipped code (Principle V).

**Scale/Scope**: One mapping table + one repository method + one migration; one reaction event
handler; two capability entry points on `members/roles.ts` + one on `members/nickname.ts`; edits to
`/nick`, `/role`, the events index, the client intents; tests. Small, additive, bot-only.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against snackbyte-discord Constitution v1.0.0:

| Principle | Gate for this feature | Status |
|-----------|-----------------------|--------|
| I. Patterns Over Instances | The reaction handler is a **new interaction adapter** over the unchanged role capability; moderation is the **same** capability with a target + a standing check — no capability logic is rewritten (FR-005, FR-016). The event handler self-registers at the one events wiring point (`events/index.ts`) and is dispatched by the generic `bindHandlers` loop; the grown commands stay self-registered and generically dispatched. No central switch enumerates styles. This is the interaction-surface-as-extension-axis design realized. | ✅ PASS |
| II. Verify Before Process | No inbound webhook path is touched. The bot-side analogue is the **authorization gate**, which runs before any mutation: for reactions, mapping-exists AND role-whitelisted AND bot-can-manage; for moderation, moderator-standing AND bot-can-manage. A member can never effect a change they are not entitled to, and a reaction can never bypass the whitelist. Least privilege is preserved: reactions need only `GuildMessageReactions` + partials; **Message Content stays off** and the bot boots/serves without it (SC-006). | ✅ PASS |
| III. Idempotent, Rate-Limited Delivery | This feature delivers no routed messages, so the delivery chokepoint is unaffected. Role/nickname writes go through discord.js's REST client (its rate-limit queue applies). The reaction model is idempotent by construction: react = has-role, un-react = has-not, so a rapid add/remove or a duplicate event yields a single consistent state (spec edge cases). | ✅ PASS |
| IV. Runtime-Mutable Routing, Compile-Time-Safe Logic | The mapping table is operator-editable runtime data (edited like routes/whitelist, FR-003); the resolution, whitelist-intersection, bot-position guard, and moderator-standing checks are typed, reviewed, tested code. The security-critical decisions (is this reaction authorized, is this invoker a moderator, may the bot manage this) are code, never a data-driven bypass — a mapping row cannot change how authorization is computed. | ✅ PASS |
| V. Pinned, Typed, Tested + Speckit-in-Speckit | Node 24, strict TS, `check:all` stays green; shipped code states the rules directly and cites no FR/spec/principle. If `specs/` were deleted, every shipped file still makes sense. | ✅ PASS |
| VI. Always-On Resilience | Liveness/readiness unchanged. A failing reaction handler is contained by the existing `bindHandlers` per-handler try/catch (one throw never disconnects the gateway or stops other handlers); a failing command is contained by the existing `interactionCreate` try/catch → ephemeral error (FR-014). A DB-unavailable mapping read fails that one reaction gracefully while the bot and all commands keep working. | ✅ PASS |
| VII. Secrets By Reference | No new secret. Mapping rows hold non-secret guild/message/emoji/role identifiers; the bot token is already config. Nothing secret enters a row or a log; reaction/command logs carry ids and outcomes, not message content (which the bot never receives). | ✅ PASS |

**Nuance recorded (not a violation):** As in 004, Principle II is written for inbound webhook
verification; this is a bot feature with no inbound payload. The analogous load-bearing boundary is
the **authorization gate** (reaction: mapping+whitelist+bot-position; moderation:
standing+bot-position), which this plan treats with the same "checked before any side effect" rigor.
Adding the `GuildMessageReactions` intent is a deliberate, minimal least-privilege step — the exact
intent the reaction capability requires and nothing more; Message Content remains off, which the
`bot-intents` test continues to assert.

**Result**: PASS — no violations, no Complexity Tracking entries required. (Re-checked after Phase 1
below: still PASS — the design added no engine, no branch-on-instance, and no new secret.)

## Project Structure

### Documentation (this feature)

```text
specs/005-reaction-roles-moderation/
├── plan.md              # This file
├── research.md          # Phase 0 — reaction gateway events + partials; emoji-identity matching; moderator standing; reuse of the 004 gate
├── data-model.md        # Phase 1 — reaction_role_mappings table + repository method (whitelist unchanged; no change to existing tables)
├── quickstart.md        # Phase 1 — enable reactions, seed a mapping, react to grant/revoke; moderate a member's nick/role; the guards
├── contracts/
│   ├── reaction-roles.md  # the reaction interaction contract: add/remove events, emoji identity, mapping+whitelist resolution, silent no-ops
│   └── moderation.md      # the grown /nick and /role: target option, moderator-standing gate, ephemeral replies, refusals
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

Extends the existing tree. **New** files marked `NEW`; ★ folders are the extension points 001/004
established. All new behavior reuses the `src/bot/members/` capability logic — the reaction handler
and the grown commands are adapters onto it (FR-005, FR-016).

```text
snackbyte-discord/
├── migrations/
│   └── 0007_reaction_role_mappings.sql   # NEW: per-guild (message, emoji) → role mapping table
├── src/
│   ├── db/
│   │   ├── repository.ts             # EDIT: add listReactionRoleMappings(guildId) to the Repository interface
│   │   └── pg-repository.ts          # EDIT: implement it (parameterized SELECT)
│   └── bot/
│       ├── client.ts                 # EDIT: add GuildMessageReactions intent + Message/Reaction partials (Message Content stays off)
│       ├── members/
│       │   ├── roles.ts              # EDIT: add explicit grantSelfRole/revokeSelfRole (reaction path) + a cross-member setMemberRole (moderator) over the same gates
│       │   └── nickname.ts           # EDIT: add setMemberNickname (cross-member) reusing the bot-position guard; keep setOwnNickname
│       ├── moderation/               # ★ NEW: moderator-standing check, interaction-style-agnostic
│       │   └── standing.ts           # NEW: isModerator(view, capability) — native per-capability permission
│       ├── reactions/                # ★ NEW: reaction-role resolution logic (interaction-style-agnostic)
│       │   └── resolve.ts            # NEW: resolveReactionRole(mapping[], whitelist[], emoji, message) → role id | null; emoji-identity match, self/bot ignore
│       ├── events/
│       │   ├── message-reaction.ts   # NEW: messageReactionAdd/Remove handlers — adapt live reaction onto resolve + grant/revoke
│       │   └── index.ts              # EDIT: register the two reaction handlers at the one wiring point
│       └── commands/
│           ├── role.ts               # EDIT: optional target user option; moderator gate when target ≠ invoker; else 004 self path
│           └── nick.ts               # EDIT: optional target user option; moderator gate when target ≠ invoker; else 004 self path
└── tests/
    └── machinery/
        ├── member-roles.test.ts      # EDIT: add grant/revoke + cross-member setMemberRole cases
        ├── member-nickname.test.ts   # EDIT: add cross-member setMemberNickname cases
        ├── moderation-standing.test.ts   # NEW: native-permission moderator gate (allow/deny, per capability)
        ├── reaction-resolve.test.ts      # NEW: mapping+whitelist intersection, emoji identity (unicode/custom), unmapped/self/bot ignore, stale-role no-op
        └── bot-intents.test.ts       # EDIT: reactions intent + partials present; Message Content still absent
```

**Structure Decision**: Two new interaction-style-agnostic folders sit beside the existing
`members/`: `reactions/` holds the pure reaction-resolution logic (which mapping+whitelist a given
emoji-on-a-message resolves to), and `moderation/` holds the moderator-standing check. Both are pure
functions over minimal views — unit-testable with plain objects, exactly like the 004 capability.
The reaction **event handler** and the grown **commands** are the thin adapters that map live
discord.js objects onto those functions and onto the unchanged `members/` role/nickname capability.
The only new data is the mapping table (one table, one repository method); the whitelist, command
registry, event registry + `bindHandlers` containment, `interactionCreate` dispatch, the migration
ledger, and the ephemeral-reply pattern are all reused unchanged. This keeps 006's remaining
interaction styles (buttons/selects, text-prefix) a matter of adding another adapter over the same
capability — no engine to touch.

## Complexity Tracking

No constitution violations; no justifications required. (Table omitted.)
