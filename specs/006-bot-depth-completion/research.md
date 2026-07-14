# Phase 0 — Research: Bot-Depth Completion

Focused decisions the plan depends on. Each is a resolved choice with rationale and the rejected
alternative. No open `NEEDS CLARIFICATION`.

## 1. Extending the standing gate for sanctions (native per-capability permission)

**Decision**: Extend the existing `ModeratedCapability` union and `REQUIRED_PERMISSION` map in
`src/bot/moderation/standing.ts` with the new capabilities: `timeout → Moderate Members`,
`kick → Kick Members`, `ban / unban / ban-list → Ban Members`, `purge / pin → Manage Messages`,
`slowmode / lock → Manage Channels`. `isModerator(view, capability)` is unchanged — every new command
gates through the same one-line check.

**Rationale**: 005 established native-permission gating as the moderation authorization model
(zero-config, always-current, least-privilege). Sanctions are the same model with more capabilities,
so extending the map is the minimal, drift-free change — one gate, many capabilities, no new store.
It also keeps the intents/permissions least-privilege: the bot needs the *permission* granted on its
role (an operator act), not a new gateway intent.

**Alternatives rejected**: a separate moderator-role store (new config + table, deferred value, breaks
the 005 model); per-command bespoke permission checks (drift risk — the shared map guarantees
consistency).

## 2. Member sanction capabilities + hierarchy guards

**Decision**: Implement each sanction as a capability function over minimal views (like `members/`):
`timeoutMember(view, durationMs)`, `clearTimeout(view)`, `kickMember(view, reason)`,
`banMember(view, {reason, deleteMessageSeconds})`. Each applies, in order: the native-permission gate
(caller-side, via `isModerator`), then the **bot-position** guard (bot outranks target + holds the
permission) AND the **invoker-position** guard (target below the invoking moderator's highest role) —
reusing the exact guard shape from 005's `setMemberRole`. A self-target or bot-target is refused before
any action. Timeout duration is validated against the platform max (28 days) and positivity.

**Rationale**: FR-004/FR-005/FR-007 require the guards run before any mutation and every failure be a
safe refusal. Modeling sanctions as view-based capabilities makes the guards unit-testable with plain
objects and keeps the slash command a thin adapter (Principle I), identical to how role/nickname work.
The invoker-position guard mirrors Discord's own rule (a mod can't sanction someone above their own
highest role) — the same escalation guard 005 added for cross-member role grants.

**Alternatives rejected**: putting guard logic in the command modules (not unit-testable, drift across
commands); a single mega "sanction" capability with a mode flag (obscures the distinct outcomes and
per-action parameters — separate functions read clearer and test cleaner).

## 3. Ban-list management (by-id, unban, list, bulk) — designed with ban as one model

**Decision**: The ban surface is one coherent capability set over the guild ban list, not just present
members: `banMember` accepts either a present member OR a user id (pre-emptive); `unban(userId)`,
`listBans()`, and `bulkBan(userIds[])` complete it. Ban-by-id and unban operate on the platform's ban
list directly (they need only the Ban Members permission, no member-hierarchy check since an absent
user has no role position to compare — the bot-position guard still applies where a present member is
targeted). `bulkBan` reports a per-id outcome array and never aborts the batch on one bad id.

**Rationale**: The spec's scope decision (do the full ban cluster together) means ban/unban/list/bulk
are designed as one model rather than ban now + unban later — avoiding an awkward re-open of `/ban` and
a lopsided "ban without unban." Pre-emptive ban and unban are inverses over the same ban list, so
building them together is less total work. Per-id bulk outcomes satisfy FR-003's "one bad id must not
abort the rest."

**Alternatives rejected**: present-members-only ban with unban/by-id deferred (re-opens the design
later, ships an asymmetric command set); aborting bulk on first failure (fails the FR-003 requirement
and is hostile to raid-response, the main bulk use case).

## 4. Message & channel moderation

**Decision**: Implement `purgeMessages(channelView, count)`, `setSlowmode(channelView, seconds)`,
`lockChannel/unlockChannel(channelView)` (via the member send-permission overwrite),
`pinMessage/unpinMessage(messageView)` as capabilities over minimal channel/message views, each gated
by the relevant native permission (Manage Messages for purge/pin, Manage Channels for slowmode/lock).
Purge respects the platform's 14-day bulk-delete age limit: messages older than that are **reported as
skipped**, not errored. Slowmode/lock on an unsupported channel type is a clean refusal.

**Rationale**: These are stateless channel/message actions squarely in the moderation surface, sharing
the permission-gated, fail-safe shape. The 14-day skip and the unsupported-channel refusal are the two
real platform edge cases (FR-008/FR-009) and are handled as reported outcomes rather than thrown
errors, consistent with the "never a partial state / never a crash" rule.

**Alternatives rejected**: erroring the whole purge when some messages are too old (hostile — the
common case is "clear the last N," some of which may be old); deleting messages one-by-one to bypass
the bulk limit (rate-limit-hostile and slow — the platform's bulk delete is the right tool, with a
clear skip report for the remainder).

## 5. Component interaction style (buttons / select menus)

**Decision**: Add a **component dispatcher** hanging off the existing `interactionCreate`: after the
current chat-input-command branch, route `interaction.isButton()` / `isAnySelectMenu()` to a
component registry keyed by `customId`. A `resolveComponentRole(bindings, whitelist, componentKey)`
pure function (mirroring 005's `reactions/resolve.ts`) maps an operator-configured component binding to
a whitelisted role, then calls the **existing** `toggleSelfRole` capability. Bindings are runtime data
in a new `component_role_bindings` table.

**Rationale**: FR-011/FR-013 require components produce the same outcome as slash/reaction over the
unchanged capability, gated by the same whitelist. Components arrive under the **existing** interaction
gateway capability — **no new intent** — so this is purely a new adapter + resolver + binding store,
exactly parallel to how reactions were added in 005. Keying the registry by `customId` keeps dispatch
generic (Principle I, no switch). Reusing `interactionCreate` (rather than a separate listener) is
correct because component interactions arrive on the same event as commands; a new branch there is the
minimal change.

**Alternatives rejected**: a brand-new gateway listener for components (unnecessary — they share
`interactionCreate`); embedding role ids directly in the `customId` (works but makes the binding
un-editable as runtime data and couples the component to a role at creation — a binding table keeps it
operator-editable and whitelist-gated, per FR-014).

## 6. Text-prefix style + Message Content isolation

**Decision**: Add a `messageCreate` handler that, **only when the text-prefix style is enabled for the
process**, parses a prefixed message (e.g. `!role X`, `!roles`, `!nick Y`) and calls the corresponding
existing capability through the same gate as the slash command. Enablement is a config flag
(`src/config.ts`); the flag **also drives the conditional Message Content intent** in
`src/bot/client.ts` — the intent is added *only* when the flag is on. With the flag off (the default),
the handler is a no-op and the intent is absent, so the bot boots and every other style works.

**Rationale**: FR-012/FR-015/SC-006 require text-prefix to work like the slash equivalents but keep the
privileged Message Content intent opt-in and isolated. Gating both the handler *and* the intent on one
config flag makes "off" genuinely least-privilege (the intent isn't even requested) and "on" a
deliberate deploy choice. This is the single least-privilege-sensitive part of 006 and the design
keeps it isolated exactly as the constitution's privileged-intent clause requires.

**Alternatives rejected**: always requesting Message Content and gating only the handler (violates
least privilege — the intent would be requested even when unused, and the `bot-intents` test's
load-bearing "Message Content off" assertion would need weakening); a per-guild runtime toggle for the
intent (impossible — gateway intents are per-connection/process, not per-guild; per-guild enablement of
the *style* is possible but the *intent* is process-wide, so the honest model is a process/deploy
flag).

## 7. Statelessness boundary (no moderation-records store)

**Decision**: 006 introduces exactly **one** new table — `component_role_bindings` (configuration,
like the 005 reaction mapping) — and **no** moderation-history/infractions store. Sanctions write only
to the platform's own audit log (via the reason parameter on the platform call) and the platform's ban
list. Warnings, infraction history, modlog persistence, auto-escalation, and auto-expiring temp-bans
are explicitly out of scope (they need a durable store) and deferred to 008 on top of the 007 kv work.

**Rationale**: FR-021 makes statelessness a design constraint, not an accident — it is the boundary
that keeps 006 shippable now without the 007 storage architecture. The component binding table is
configuration (operator-curated, like routes/whitelist/mappings), not moderation state, so it does not
cross the line.

**Alternatives rejected**: a lightweight "recent actions" log table in 006 (crosses the stateless line
for little value — the platform audit log already records actions; a real infraction system is 008);
folding 007's kv store forward into 006 (widens scope into new persistence architecture, exactly what
the user's "no wildly out-of-scope architecture" boundary excludes).
