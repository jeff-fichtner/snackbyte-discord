# Implementation Plan: Bot-Depth Completion — Moderation & Interaction Styles (Phase 3, part 2)

**Branch**: `006-bot-depth-completion` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-bot-depth-completion/spec.md`

## Summary

Complete the hub's bot depth with two areas, both over the seams 001/004/005 established and both
adding **no new persistent store** (the deliberate stateless boundary):

1. **The full stateless moderation surface.** New slash commands for member sanctions
   (timeout + clear, kick, ban a present member with an optional message-delete window), ban-list
   management (pre-emptive ban-by-id, unban, list bans, bulk ban), and message/channel moderation
   (bulk purge, slowmode, lock/unlock, pin/unpin). Each is a thin command adapter onto a small
   capability function; each gates on the invoker's **native** platform permission (extending the
   existing `moderation/standing.ts` from 005), enforces the bot-position + invoker-position guards
   for member sanctions, records an audit-log reason, and fails safe. The capabilities act on live
   platform state (members, the platform's ban list, messages, channels) and the platform's own audit
   log — no bot-owned durable record (FR-021).

2. **Two more interaction styles over the EXISTING role/nickname capabilities.** A **component**
   style (buttons / select menus) and a **text-prefix** style (`!role`, `!roles`, `!nick`), each a
   new input adapter that resolves to a role/nickname capability call through the **same**
   authorization gate the slash and reaction styles already use (Principle I). Components dispatch
   from `interactionCreate` by `customId` (a new branch/dispatcher beside the existing command
   branch); text-prefix dispatches from `messageCreate` and is the only piece needing the privileged
   Message Content intent, kept opt-in and isolated so the bot boots and every other style works with
   it off.

Genuinely new pieces: one migration for the component-binding table + one repository read; a
`moderation/` capability area for sanctions and channel/message actions (pure-ish logic over minimal
views); the sanction/purge/channel slash commands; a component dispatcher + registry; a text-prefix
message dispatcher gated on a config/intent flag; and the intent/config plumbing for the opt-in
Message Content. The security spine (native-permission gate, hierarchy guards, whitelist reuse) lives
in the capability/standing logic and is unit-tested directly. No existing capability logic is
rewritten; the new styles reuse it unchanged.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), Node 24 — unchanged.

**Primary Dependencies**: No new runtime dependencies. Reuses `discord.js` 14 (slash builders with
user/channel/string options, `GuildMember.timeout/kick/ban`, `Guild.bans`, `channel.bulkDelete`,
channel permission-overwrite + `setRateLimitPerUser`, message `pin/unpin`, message components +
`ButtonBuilder`/`StringSelectMenuBuilder`, `messageCreate` for text-prefix), `pg`, `pino`. Vitest for
tests.

**Storage**: PostgreSQL (Supabase) via the existing repository. **One new table** (migration `0008`)
for per-guild component→role bindings; one new `Repository` read. No change to existing tables. The
004 `self_assignable_roles` whitelist is reused unchanged as the authorization for the component and
text-prefix role styles. **No moderation-records table** — that is the 008 feature, deliberately out
of scope (FR-021).

**Testing**: Vitest. Unit: the sanction capabilities and their guards against fake member/guild views
(timeout range, kick/ban outcomes, ban-list add/remove/list/bulk per-id, hierarchy + native-permission
refusals, self/bot-target refusal); the message/channel capabilities against fake channel views
(purge count + age-skip, slowmode range, lock/unlock overwrite, pin toggle); the extended
`isModerator` gate for the new capabilities; the component resolver (binding + whitelist intersection,
mirroring the 005 reaction resolver); the text-prefix parser + dispatch-enabled flag; the intents
assertion (Message Content present only when the style is enabled, absent by default). Where a live DB
is reachable, a DB-integration check exercises the new binding read against real Postgres with named
test rows + cleanup, as in 005.

**Target Platform**: Same single always-on Cloud Run service; no topology change. New slash commands
register via the existing `deploy-commands` script. The text-prefix style's Message Content intent is
an opt-in deploy/config choice, off by default.

**Performance Goals**: Each moderation command defers immediately (as 004/005 do) and responds within
Discord's interaction window; a sanction is one indexed permission check + one platform write. A
component activation is a binding read + a role write. Bulk operations (bulk ban, purge) report
per-item outcomes and respect the platform's batch limits.

**Constraints**: Least-privilege — sanctions add only the specific management permissions their
commands need (Moderate/Kick/Ban Members, Manage Messages, Manage Channels) as **operator grants on
the bot's role**, not new gateway intents; components need **no** new intent; only text-prefix adds
the **Message Content** privileged intent, opt-in and isolated (FR-015, SC-006). Bindings/config are
runtime-mutable data; the gate/guard/parse logic is typed, tested code (Principle IV). Member-facing
replies ephemeral (FR-016). The webhook → routing → delivery pipeline and all 004/005 behavior are
untouched (FR-020). **No new durable bot record** (FR-021). No spec/FR citations in shipped code
(Principle V).

**Scale/Scope**: ~10 new slash commands (grouped), one capability area (`moderation/`) with sanction
+ channel/message functions, one component dispatcher + registry + binding table + repository read,
one text-prefix dispatcher + config, an extended standing map, intent/config plumbing, and tests.
Larger than 004/005 but uniformly additive and pattern-consistent; decomposes into independent
increments (sanctions → ban-list → message/channel → components → text-prefix).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against snackbyte-discord Constitution v1.0.0:

| Principle | Gate for this feature | Status |
|-----------|-----------------------|--------|
| I. Patterns Over Instances | Sanctions/channel/message actions are self-registering slash commands dispatched generically through the existing `interactionCreate` router; the component and text-prefix styles are **new interaction adapters** over the unchanged role/nickname capabilities, dispatched by a component registry (by `customId`) and a message dispatcher — no capability logic rewritten (FR-013, FR-019). Each new module registers at its one wiring point; no central switch enumerates commands, components, or styles. This is the interaction-surface-as-extension-axis design continued. | ✅ PASS |
| II. Verify Before Process | No inbound webhook path is touched. The bot-side analogue is the **authorization gate before any mutation**: sanctions gate on the invoker's native permission + hierarchy guards; role-granting styles gate on the whitelist + bot-position guard — a member/moderator can never effect a change they are not entitled to, and a component/text command can never bypass the whitelist. Least privilege preserved: sanctions add permission grants not intents; components add no intent; **Message Content stays off** unless text-prefix is explicitly enabled, and the bot boots without it (SC-006). | ✅ PASS |
| III. Idempotent, Rate-Limited Delivery | This feature delivers no routed messages, so the delivery chokepoint is unaffected. All platform writes go through discord.js's REST client (its rate-limit queue applies). Actions are idempotent by construction where it matters: re-banning an already-banned id, unbanning a non-banned id, and repeated component clicks each converge to a single consistent state (spec edge cases). Bulk operations report per-item outcomes rather than aborting. | ✅ PASS |
| IV. Runtime-Mutable Routing, Compile-Time-Safe Logic | Component bindings and the text-prefix enablement/prefix are operator-editable runtime data (edited like routes/whitelist/mappings, FR-014); the sanction guards, hierarchy checks, native-permission gate, whitelist intersection, and text-prefix parser are typed, reviewed, tested code. A data row can never change how a sanction is authorized or how a role grant is gated. | ✅ PASS |
| V. Pinned, Typed, Tested + Speckit-in-Speckit | Node 24, strict TS, `check:all` stays green; shipped code states the rules directly and cites no FR/spec/principle. If `specs/` were deleted every shipped file still makes sense. | ✅ PASS |
| VI. Always-On Resilience | Liveness/readiness unchanged. A throwing command is contained by the existing `interactionCreate` try/catch → ephemeral error; a throwing component/text handler is contained by its dispatcher's per-handler guard (the same pattern as `bindHandlers`), so one failure never disconnects the gateway or affects other styles (FR-018). A DB-unavailable binding read fails that one activation gracefully while the bot and all commands keep working. Enabling/disabling text-prefix (and its intent) is a clean boot-time choice; the bot boots either way. | ✅ PASS |
| VII. Secrets By Reference | No new secret. Binding rows hold non-secret guild/message/component/role identifiers; the text-prefix config holds a prefix string and an enablement flag, not a secret; the bot token is already config. Nothing secret enters a row or a log; moderation logs carry ids/outcomes/reasons, not message content (the bot only receives message text when text-prefix is explicitly enabled, and even then does not log it). | ✅ PASS |

**Nuances recorded (not violations):**
- As in 004/005, Principle II is written for inbound webhook verification; this is a bot feature with
  no inbound payload. The analogous load-bearing boundary is the **authorization gate** (native
  permission + hierarchy for sanctions; whitelist + bot-position for role styles), treated with the
  same "checked before any side effect" rigor.
- **Message Content** is a privileged intent and the one genuine least-privilege sensitivity here. The
  design keeps it **off by default and isolated to the text-prefix style** — every other capability
  and style works without it, and the intents test asserts it is absent unless the style is enabled.
  This is the deliberate, minimal exception the constitution's "privileged intents optional and
  isolated" clause explicitly allows.
- **Statelessness (FR-021)** is an explicit design constraint: this feature adds no durable
  moderation record. The one new table is a component→role binding (configuration, like the 005
  reaction mapping), not moderation history. Anything needing history is 008, gated on the 007 store.

**Result**: PASS — no violations, no Complexity Tracking entries required. (Re-checked after Phase 1
below: still PASS — the design adds no engine, no branch-on-instance, no new secret, and no durable
moderation record.)

## Project Structure

### Documentation (this feature)

```text
specs/006-bot-depth-completion/
├── plan.md              # This file
├── research.md          # Phase 0 — sanction/channel APIs & guards; component dispatch; text-prefix + Message Content isolation; extending the standing gate
├── data-model.md        # Phase 1 — component_role_bindings table + repository read; text-prefix config; no moderation-records table (that's 008)
├── quickstart.md        # Phase 1 — sanction/purge/channel commands; seed a component menu; enable text-prefix; the guards
├── contracts/
│   ├── sanctions.md       # timeout/kick/ban/unban/list/bulk + purge/slowmode/lock/pin: options, gates, guards, refusals, audit reason
│   └── interaction-styles.md # component (button/select) + text-prefix adapters over role/nickname; the shared gate; the Message Content isolation
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

Extends the existing tree. **New** files marked `NEW`; ★ folders are the extension points 001/004/005
established. All new styles reuse `src/bot/members/` unchanged; sanctions/channel/message logic lives
in `src/bot/moderation/` beside the existing `standing.ts`.

```text
snackbyte-discord/
├── migrations/
│   └── 0008_component_role_bindings.sql   # NEW: per-guild (message, component) → role binding table
├── src/
│   ├── config.ts                     # EDIT: add text-prefix enablement + prefix (opt-in; drives the Message Content intent)
│   ├── db/
│   │   ├── repository.ts             # EDIT: add listComponentRoleBindings(guildId) + its record type
│   │   └── pg-repository.ts          # EDIT: implement it (parameterized SELECT)
│   └── bot/
│       ├── client.ts                 # EDIT: conditionally add the Message Content intent ONLY when text-prefix is enabled (off by default)
│       ├── moderation/               # ★ capability area (interaction-style-agnostic)
│       │   ├── standing.ts           # EDIT: extend ModeratedCapability + permission map with timeout/kick/ban/purge/slowmode/…
│       │   ├── sanctions.ts          # NEW: timeoutMember/clearTimeout/kickMember/banMember/unban/listBans/bulkBan capabilities + hierarchy guards
│       │   └── channel.ts            # NEW: purgeMessages/setSlowmode/lockChannel/unlockChannel/pinMessage capabilities
│       ├── components/               # ★ NEW: component interaction style
│       │   ├── resolve.ts            # NEW: resolveComponentRole(bindings, whitelist, componentKey) → role id | null (mirrors 005 reaction resolve)
│       │   ├── registry.ts           # NEW: self-registering component handlers dispatched by customId
│       │   └── index.ts              # NEW: the one wiring point for component handlers
│       ├── text/                     # ★ NEW: text-prefix interaction style (opt-in, needs Message Content)
│       │   └── prefix.ts             # NEW: parse a prefixed message → role/nickname capability call; no-op when disabled
│       ├── events/
│       │   ├── interaction-create.ts # EDIT: after the command branch, route component interactions to the component registry
│       │   ├── message-create.ts     # NEW: messageCreate handler for text-prefix (guarded by the enablement flag)
│       │   └── index.ts              # EDIT: register message-create; import components/index
│       └── commands/
│           ├── timeout.ts  kick.ts  ban.ts  unban.ts  bans.ts       # NEW: member-sanction slash commands
│           ├── purge.ts  slowmode.ts  lock.ts  pin.ts               # NEW: message/channel moderation slash commands
│           └── index.ts               # EDIT: register the new commands at the one wiring point
└── tests/
    └── machinery/
        ├── moderation-sanctions.test.ts   # NEW: timeout range/clear, kick/ban, ban-list add/remove/list/bulk, hierarchy + permission refusals, self/bot-target
        ├── moderation-channel.test.ts     # NEW: purge count/age-skip, slowmode range, lock/unlock, pin toggle, permission refusals
        ├── moderation-standing.test.ts     # EDIT: assert the new capabilities map to the right native permissions
        ├── component-resolve.test.ts       # NEW: binding+whitelist intersection, unmapped/stale → null (mirrors reaction-resolve)
        ├── text-prefix.test.ts             # NEW: prefix parsing, disabled → no-op, same gate as slash
        └── bot-intents.test.ts             # EDIT: Message Content absent by default; present only when text-prefix enabled
```

**Structure Decision**: Two moves. (1) A `moderation/` capability area (already seeded by 005's
`standing.ts`) grows to hold the sanction and channel/message logic as pure-ish functions over minimal
member/guild/channel views — unit-testable with plain objects, exactly like `members/`. The
sanction/purge/channel **slash commands** are thin adapters onto it, and the extended `isModerator`
gate is the shared native-permission check. (2) Two new interaction-style folders, `components/` and
`text/`, sit beside the existing styles as **adapters onto the unchanged `members/` role/nickname
capabilities** — `components/resolve.ts` mirrors 005's `reactions/resolve.ts` (a binding+whitelist
intersection), and `text/prefix.ts` parses a message into the same capability call. The component
dispatcher hangs off the existing `interactionCreate` (a new branch after the command check, keyed by
`customId`); text-prefix hangs off a new `messageCreate` handler gated by the enablement flag that
also drives the conditional Message Content intent. The only new data is the component-binding table
(one table, one read); the whitelist, command/event registries, `interactionCreate`/`bindHandlers`
containment, `getContext().repo`, the migration ledger, and the ephemeral-reply pattern are reused
unchanged. This keeps every remaining interaction style a matter of adding another adapter — no engine
to touch — and holds the stateless line (the only table is configuration, not moderation history).

## Complexity Tracking

No constitution violations; no justifications required. (Table omitted.)

The one item worth a sentence (not a violation): this is a **larger** feature than 004/005 (multiple
command groups + two new styles). The mitigation is decomposition, not a design compromise — the spec
priorities (US1/US2 sanctions P1 → US3 ban-list / US4 channel / US5 components P2 → US6 text-prefix P3)
give independently-shippable increments, and `/speckit-tasks` will phase them so an MVP (member
sanctions) lands and is verifiable before the breadth. Each increment reuses the same gate/guard/
adapter patterns, so breadth adds instances, not complexity.
