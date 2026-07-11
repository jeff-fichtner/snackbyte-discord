# Feature Specification: Reaction-Roles & Moderation (BED-BOT parity, Phase 3)

**Feature Branch**: `005-reaction-roles-moderation`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Phase-3 bot depth remaining: reaction-roles (assign a whitelisted role by reacting to an operator-configured message) over the existing role capability, and moderation (acting on OTHER members) — growing /nick and role management to target another member, gated by a moderator-permission check. Member sanctions (kick/ban/timeout) and additional interaction styles are deferred to the Phase-3-remainder spec (006)."

## Clarifications

### Session 2026-07-11

- Q: When a member removes their mapped reaction, does the bot remove the role unconditionally, or
  only if the reaction was how they got it? → A: **Unconditionally** — the reaction is the source of
  truth (react = have role, un-react = lose role). Standard reaction-role model; stateless, no
  provenance tracking. If the member also self-assigned the same role, un-reacting still removes it.
- Q: Which emoji kinds can a reaction-role mapping use — unicode, custom, or both? → A: **Both.** A
  mapping stores the emoji by its stable identity: the unicode codepoint for a standard emoji, the
  numeric emoji ID for a custom server emoji (so a custom-emoji rename does not break the mapping,
  matching how roles are keyed by stable ID).
- Q: Can one (message, emoji) map to more than one role? → A: **No — one (message, emoji) → one
  role** (the standard one-emoji-one-role convention). Uniqueness key is `(server, message, emoji)`;
  the grant path is a single lookup. The same role MAY still be targeted by multiple different
  mappings (other emoji or messages) — that is unconstrained.

## User Scenarios & Testing *(mandatory)*

<!--
  Reaction-roles and moderation are the two remaining Phase-3 capabilities named in
  ARCHITECTURE.md §4. Both are exposed through the interaction-handler registries over the
  shared role/nickname capability logic already built in 004 — no capability logic is rewritten.
-->

### User Story 1 - A member self-assigns a whitelisted role by reacting (Priority: P1)

An operator posts (or designates) a message that says, in effect, "react with 🔔 for the
Announcements role." A member reacts to that message with the configured emoji and receives the
role; removing their reaction removes the role. The member never types a command — the reaction is
the input. The bot only ever grants roles an operator has explicitly made self-assignable — the
exact same whitelist that governs the self-assign command today.

**Why this priority**: This is the headline capability of the "reaction-roles" half of the feature
and the most-requested BED-BOT-style interaction the hub still lacks. It proves the interaction
surface is genuinely extensible — a new input style over unchanged capability logic — which is the
architectural point of the whole phase.

**Independent Test**: With one role mapped to one emoji on one operator-configured message, a member
adds the reaction (gets the role), removes the reaction (loses the role), and reacting with an
un-mapped emoji does nothing — verifiable entirely through the member's reactions and the resulting
role membership, with no command and no other capability present.

**Acceptance Scenarios**:

1. **Given** an operator-configured reaction-role mapping (message + emoji → whitelisted role) and a
   member who lacks the role, **When** the member adds that emoji reaction to that message, **Then**
   the bot grants the role to that member.
2. **Given** the same mapping and a member who has the role via that mapping, **When** the member
   removes their reaction, **Then** the bot removes the role from that member.
3. **Given** a message with a reaction-role mapping, **When** a member reacts with an emoji that is
   NOT mapped on that message, **Then** the bot makes no role change.
4. **Given** a reaction-role mapping whose role is NOT on the self-assignable whitelist (or no longer
   is), **When** a member reacts, **Then** the bot makes no role change — the whitelist is the
   authorization, exactly as for the self-assign command.
5. **Given** a reaction-role mapping whose role sits at or above the bot's own highest role, **When**
   a member reacts, **Then** the bot makes no change and the failure is diagnosable (logged), never a
   crash — the same bot-position guard as the command path.

---

### User Story 2 - An operator configures a reaction-role mapping (Priority: P1)

An operator decides that reacting with a specific emoji on a specific message grants a specific
whitelisted role, and records that mapping as runtime data — the same way the whitelist and routes
are edited today, with no code change and no redeploy. Adding a mapping makes that reaction live;
removing it stops further grants through that reaction.

**Why this priority**: Without an operator-defined mapping there is nothing for US1 to act on. The
mapping is the configuration surface the reaction capability reads, so it is foundational and P1
alongside US1.

**Independent Test**: An operator adds a (message, emoji, role) mapping as runtime data; a member's
reaction then grants the role (US1). The operator removes the mapping; a later reaction grants
nothing — all with no redeploy.

**Acceptance Scenarios**:

1. **Given** an operator records a (message, emoji, role) mapping in runtime data, **When** a member
   next reacts with that emoji on that message, **Then** the role is granted, with no redeploy.
2. **Given** an operator removes a mapping, **When** a member next reacts, **Then** no role is
   granted, with no redeploy.
3. **Given** a mapping that references a role not on the self-assignable whitelist, **When** a member
   reacts, **Then** no role is granted — a mapping does not bypass the whitelist, and the system never
   auto-adds the role to the whitelist.
4. **Given** the reaction-role mappings, **When** an operator inspects them, **Then** they contain
   only mappings an operator placed there, each scoped to the server it applies to.

---

### User Story 3 - A moderator sets or clears another member's nickname (Priority: P1)

A moderator needs to fix or clear another member's server nickname (e.g. an offensive display name)
without hand-editing through the platform UI. They run the nickname command naming a target member
and a new nickname (or no nickname, to reset). The bot verifies the invoker holds moderator
standing, then changes the target's nickname — the piece Discord's built-in `/nick` cannot do. A
member without moderator standing can still change only their own nickname (the 004 behavior is
unchanged for them).

**Why this priority**: This is the concrete first slice of "moderation" named in ARCHITECTURE.md —
growing `/nick` to act on other members — and the reason the hub's `/nick` exists as a superset of
the built-in. It is the moderation counterpart to US1 and independently valuable.

**Independent Test**: A moderator sets a target member's nickname (it changes) and resets it (it
clears); a non-moderator naming another member is refused with no change, while still being able to
change their own — verifiable through the command and the target's resulting display name.

**Acceptance Scenarios**:

1. **Given** an invoker with moderator standing and a target member, **When** the invoker runs the
   nickname command naming that member and a valid nickname, **Then** the target's nickname changes
   and the bot confirms privately to the invoker.
2. **Given** the same invoker and target, **When** the invoker runs the command naming the member and
   no nickname, **Then** the target's nickname is cleared (reset to the account name).
3. **Given** an invoker WITHOUT moderator standing, **When** they run the command naming another
   member, **Then** the bot refuses, makes no change, and explains they can only change their own
   nickname — the invoker's own-nickname capability from 004 still works.
4. **Given** a moderator and a target whose nickname the bot cannot change (the target outranks the
   bot, or the bot lacks the permission), **When** the moderator tries, **Then** the bot refuses
   safely with a diagnosable reason and makes no change.

---

### User Story 4 - A moderator grants or removes a role on another member (Priority: P2)

A moderator needs to give another member a role, or take one away, on the member's behalf — not
limited to the self-assignable whitelist, because moderating means managing roles a member could not
self-assign. They run a role command naming a target member and a role; the bot verifies moderator
standing and the bot-position guard, then applies the change. Ordinary members remain limited to
self-assigning whitelisted roles on themselves (004 behavior unchanged).

**Why this priority**: Cross-member role management is core moderation parity, but it is independent
of nickname moderation (US3) and of reaction-roles (US1/US2) — the feature is valuable if this slips
to a follow-up, so it sits below the P1 slices.

**Independent Test**: A moderator grants a non-whitelisted role to a target member (applied) and
removes it (removed); a non-moderator attempting the same is refused; the bot refuses safely for a
role above its own position — verifiable through the command and the target's role membership.

**Acceptance Scenarios**:

1. **Given** a moderator, a target member, and a role the bot can manage, **When** the moderator
   grants the role, **Then** the target gains it and the bot confirms privately to the invoker.
2. **Given** the same and a role the target already has, **When** the moderator removes it, **Then**
   the target loses it.
3. **Given** an invoker WITHOUT moderator standing, **When** they try to change another member's
   role, **Then** the bot refuses and makes no change.
4. **Given** a role at or above the bot's own highest role, or a target that outranks the bot, **When**
   a moderator tries, **Then** the bot refuses safely with a diagnosable reason and changes nothing.

---

### Edge Cases

- **Reaction on a message with no mapping**: a member reacting to any un-configured message, or with
  an un-mapped emoji, produces no role change and no error — the bot ignores reactions it has no
  mapping for.
- **Mapped role deleted, or removed from the whitelist, after the mapping was created**: a reaction
  produces a clean no-op (no crash); the failure is diagnosable (logged) and an operator can prune
  the stale mapping. A mapping never re-authorizes a role the whitelist no longer allows.
- **Reaction event arrives for a message not in the bot's cache** (older message, or after a
  restart): the bot still resolves the mapping and acts — reaction handling does not depend on the
  message having been seen live this session.
- **The bot's own reactions / bot-account reactions**: reactions added by the bot itself (e.g. to
  seed the emoji on a mapping message) do not grant roles to the bot and are ignored.
- **Rapid add/remove of the same reaction**: the member ends in a single consistent has/has-not state
  for that role — no duplicate grant, no partial state.
- **Member holds the same role by another means, then un-reacts**: removing the mapped reaction
  removes the role regardless of a prior self-assign, a second mapping, or a manual grant — the
  reaction is the source of truth and no provenance is tracked (FR-001). A member who wants the role
  back re-reacts or self-assigns it again.
- **Moderator targets themselves**: a moderator using a cross-member command on their own account is
  handled deterministically (either treated as the self-path or refused with a clear message), never
  a half-action.
- **Moderator targets the bot**: refused safely — the bot does not sanction, re-role, or re-nickname
  itself into an inconsistent state.
- **Moderator standing changes mid-session**: authorization is evaluated per invocation from the
  invoker's current permissions, so revoking moderator standing takes effect on the next command.
- **Message Content intent is off**: this is the normal, shipped state for 005 — no capability here
  requires it. Reaction add/remove events arrive under the Guild Message Reactions intent, and
  cross-member moderation reads its target/value/reason from command options, not message text. The
  bot boots and serves every 005 capability with Message Content off, preserving least privilege
  (Principle II). ARCHITECTURE.md's note tying "moderation" to Message Content refers to a later
  text-scanning moderation capability, not the option-driven commands in this spec.

## Requirements *(mandatory)*

### Functional Requirements

**Reaction-roles**

- **FR-001**: A member MUST be able to receive a self-assignable role by adding a configured emoji
  reaction to a configured message, and MUST lose that role by removing the reaction — with no
  command typed. The reaction is the source of truth: removing a mapped reaction MUST remove the role
  unconditionally, even if the member also holds it by another means (self-assign command, another
  mapping, or a manual grant) — the system tracks no role provenance. The role granted is identified
  by a stable role identifier so a role rename does not break the mapping.
- **FR-002**: A reaction MUST grant a role ONLY when (a) an operator has recorded a (message, emoji,
  role) mapping for it AND (b) that role is on the operator-curated self-assignable whitelist. Either
  condition failing MUST result in no role change. A mapping MUST NOT bypass or auto-populate the
  whitelist.
- **FR-003**: The reaction-role mappings MUST be operator-editable runtime data (changeable without a
  code change or redeploy); an added mapping governs the next reaction and a removed mapping stops
  further grants immediately. The system MUST NOT auto-create mappings.
- **FR-003a**: A given (server, message, emoji) MUST map to at most one role — that triple is the
  mapping's uniqueness key and the grant path is a single lookup, not a fan-out. The same role MAY be
  targeted by multiple distinct mappings (different emoji and/or messages); that is not constrained.
- **FR-004**: Reaction-role mappings MUST scope to the server they apply to, so a mapping in one
  server does not act in another. A mapping MUST support both unicode and custom server emoji,
  identifying each by its stable identity — the unicode codepoint for a standard emoji, the numeric
  emoji ID for a custom emoji — so a custom-emoji rename does not break the mapping and a reaction is
  matched by identity rather than by display name.
- **FR-005**: Reaction handling MUST reuse the existing role capability and its bot-position /
  permission guard — a reaction that targets a role the bot cannot manage MUST be a safe, diagnosable
  no-op, never a crash or partial change. Adding this reaction interaction style MUST NOT require
  changing the role capability logic (a new input adapter over unchanged capability).
- **FR-006**: A reaction event for a message the bot has not cached this session (e.g. an older
  message, or after a restart) MUST still be resolved against the mappings and acted on — reaction
  handling MUST NOT require the message to have been observed live.
- **FR-007**: Reactions by the bot's own account, and reactions with no matching mapping, MUST be
  ignored with no role change.

**Cross-member moderation (nickname & roles)**

- **FR-008**: A moderator MUST be able to set or clear ANOTHER member's server nickname by naming
  that member; a non-moderator MUST be refused when targeting another member while retaining the
  ability to change their own nickname (the 004 self-nickname behavior is unchanged). The same
  32-character limit and whitespace-only rejection apply to the value.
- **FR-009**: A moderator MUST be able to grant or remove a role on another member, not limited to
  the self-assignable whitelist; a non-moderator MUST be refused when targeting another member while
  retaining self-assign of whitelisted roles on themselves.
- **FR-010**: Every cross-member action MUST verify the invoker's moderator standing from the
  invoker's current server permissions at invocation time; a change to those permissions MUST take
  effect on the next invocation. Moderator standing is the invoker's native platform permission for
  the capability being exercised — the Manage Nicknames permission gates cross-member nickname
  changes, and the Manage Roles permission gates cross-member role changes. This is zero-config,
  always-current, and least-privilege (an operator confers standing by granting the ordinary
  platform permission); no separate moderator-role store is introduced by this feature.
- **FR-011**: Every cross-member action MUST enforce the bot-position / permission guard already used
  in 004 — the bot MUST refuse to act on a role or member at or above its own position, or when it
  lacks the required permission, failing safely with a diagnosable reason and changing nothing.

**Cross-cutting**

- **FR-012**: Member-facing responses to moderation commands MUST be private to the invoking
  moderator (not broadcast to the channel). Reaction-role grants happen silently (a reaction is not a
  command with a reply); any member-facing feedback for a failed reaction MUST NOT spam the channel.
- **FR-013**: The feature MUST operate with least-privilege gateway permissions — reaction-roles adds
  only the reaction event capability; moderation adds only the specific management permissions its
  shipped capabilities require. Any privileged intent (e.g. Message Content) MUST remain optional and
  isolated: the bot MUST boot and serve all non-dependent capabilities with it off.
- **FR-014**: A failure in any single reaction or command (missing permission, ranking conflict,
  deleted role, invalid input, un-cached message) MUST NOT crash the bot or affect other commands,
  reactions, or the inbound pipeline; it MUST be contained to that one invocation and be diagnosable.
- **FR-015**: The feature MUST NOT alter the existing inbound-webhook → routing → delivery pipeline,
  nor the existing self-service (own-role, own-nickname, list) commands from 004; it adds a reaction
  interaction style and cross-member capability only.
- **FR-016**: Each new capability MUST be a self-registering module dispatched generically (the
  reaction handler via the event registry; moderation via the command/interaction registries), with
  no central switch statement enumerating them and no edits to the dispatch core — consistent with the
  interaction-surface-as-extension-axis design.

### Key Entities *(include if feature involves data)*

- **Reaction-role mapping**: an operator-curated record binding a specific (server, message, emoji)
  to a specific whitelisted role. Scoped to a server. Holds stable identifiers for the message, the
  emoji, and the role. The emoji is stored by its stable identity — the unicode codepoint for a
  standard emoji, or the numeric emoji ID for a custom server emoji (rename-safe) — and both kinds
  are supported. The triple `(server, message, emoji)` is unique and maps to exactly one role (a role
  may appear in multiple mappings, but a given emoji-on-a-message resolves to a single role). Its
  presence plus a matching whitelist entry is the whole authorization; it never grants a role absent
  from the whitelist and is never auto-created.
- **Self-assignable role entry** (existing, from 004): the operator-curated whitelist a reaction-role
  mapping must intersect with. Unchanged by this feature; reused as the authorization for reactions.
- **Moderator**: a server member whose current permissions (or operator-designated moderator role —
  see FR-010) authorize acting on other members. Not a new auth system; evaluated per invocation from
  live permission state, not stored by this feature.
- **Target member**: the member whose nickname, roles, or membership a moderator changes. Acted on in
  live state; not stored by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can obtain a whitelisted role by reacting to an operator-configured message,
  and lose it by un-reacting, with no command and no operator involvement — the role membership
  matches the reaction state.
- **SC-002**: 100% of reactions that lack a valid mapping OR whose role is not on the whitelist result
  in no role change — there is no reaction by which a member obtains a role not both mapped and
  whitelisted.
- **SC-003**: An operator can make a reaction grant a role, or stop it, by editing runtime data alone
  — the change governs the next reaction with zero redeploys.
- **SC-004**: A moderator can set and reset another member's nickname, and grant/remove a role on
  another member; 100% of the same attempts by a non-moderator are refused with no change, while the
  non-moderator's own-nickname / self-assign capability from 004 is unaffected.
- **SC-005**: The bot never grants, removes, or sanctions above its own position and never acts on a
  target it cannot manage; every such case is a safe, diagnosable refusal or no-op, never a crash or
  partial change.
- **SC-006**: Reaction-roles function with the Message Content privileged intent OFF, and the bot
  boots and serves every non-dependent capability with any privileged intent off (least privilege
  preserved).
- **SC-007**: Introducing this feature causes no change to inbound webhook routing/delivery or to the
  existing 004 self-service commands — those behave identically.

## Assumptions

- The hub already runs an always-on gateway bot with self-registering command and event registries
  and the shared role/nickname capability logic built in 004; this feature adds a reaction event
  handler and cross-member command paths over that capability, plus a mapping store — not a new bot,
  connection, or capability engine.
- Reaction-role mappings reuse the existing operator-editable runtime-data approach (a database table
  edited through the same admin surface as routes and the whitelist today) — no new admin UI is built
  here. A dedicated in-Discord operator command to manage mappings/whitelist remains deferred to the
  admin/diagnostics spec (Phase 2 remaining), not required for this feature.
- The self-assignable whitelist from 004 is the authorization for reaction-granted roles: a mapping
  is additive configuration, never an authorization bypass. Operators are responsible for not mapping
  a reaction to a role they have not also whitelisted.
- Reaction add/remove events are delivered under the Guild Message Reactions gateway intent and do
  NOT require the Message Content privileged intent; the reaction, emoji, message id, and reacting
  member are available without message text. Reaction-roles therefore ship without Message Content.
- Cross-member moderation reads its target member, role, and nickname value from command options
  (not from message text), so slash-command moderation likewise does not require Message Content.
  Message Content stays off unless a later text-scanning capability needs it.
- "Moderator standing" is the invoker's native platform permission for the capability (Manage
  Nicknames for cross-member nicknames, Manage Roles for cross-member roles), evaluated per
  invocation from live permission state — always current, no separate moderator-role store (FR-010).
- The bot is granted only Manage Roles + Manage Nicknames today (via a dedicated role, not
  Administrator) and its role sits above the roles/members it manages. This feature adds no new bot
  permissions — reaction-roles and cross-member nickname/role moderation are covered by the existing
  Manage Roles + Manage Nicknames grant.

## Out of Scope (Deferred to Spec 006 — Phase-3 remainder)

The following were considered and explicitly **deferred** to the next spec (006, the Phase-3
remainder), so they are on record to be picked up there rather than dropped:

- **Member sanctions — kick / ban / timeout** (the former US5). Deferred because they materially
  enlarge the surface (audit reasons, timeout durations, optional DM-on-action) and require new bot
  permissions (Kick / Ban / Moderate Members) beyond the Manage Roles + Manage Nicknames this feature
  keeps. BED-BOT parity does not require them (BED-BOT does roles/nicknames, not sanctions), so
  deferring them does not weaken the parity goal.
- **Additional interaction styles over the existing role/nickname capabilities** — buttons/selects
  and text-prefix commands (named in ARCHITECTURE.md §4 alongside reaction-roles). 005 ships the
  reaction interaction style; the remaining styles land in 006.
- **`bot_state`/kv free-form per-guild config** and **scheduled jobs reusing the delivery service**
  (ARCHITECTURE.md §4 Phase-3 remainder). Not part of reaction-roles or moderation; carried to 006.

Deferring these keeps 005 a clean, independently valuable slice (reaction-roles + cross-member
nickname/role moderation) and leaves 006 as a coherent "remaining interaction styles + moderation
sanctions + per-guild infra" feature.
