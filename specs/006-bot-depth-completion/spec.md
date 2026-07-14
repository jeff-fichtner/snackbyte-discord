# Feature Specification: Bot-Depth Completion — Moderation & Interaction Styles (Phase 3, part 2)

**Feature Branch**: `006-bot-depth-completion`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Bot-depth completion — as wide a swath as possible without introducing wildly out-of-scope architecture. (1) The full STATELESS moderation surface: timeout (+clear), kick, the ban cluster (ban present member, pre-emptive ban by id, unban, list bans, bulk ban, message-delete window), and message/channel moderation (bulk purge, slowmode, lock/unlock, pin/unpin) — all native-permission-gated, with audit-log reasons and hierarchy guards, failing safe. (2) Additional interaction styles over the EXISTING role/nickname capabilities — message components (buttons/selects) and text-prefix commands — each a new adapter onto the same capability logic reusing the same authorization gates. Text-prefix requires the Message Content intent, kept opt-in and isolated. DEFERRED (needs new persistent-store architecture): a warnings/infractions system, modlog history, auto-escalation, and auto-expiring temp-bans — these require durable state and land after the 007 storage work. Also deferred to 007: bot_state/kv and scheduled jobs."

## Clarifications

### Session 2026-07-11

- Q: Is the ban surface one overloaded `/ban` command or separate commands? → A: **One unified
  `/ban`** command carrying `member`, `user_id`, and `user_ids` options (plus `reason` and
  `delete_messages`); the command determines the mode (present-ban / pre-emptive ban-by-id / bulk)
  from which option is supplied. `/unban` and `/bans` (list) remain their own commands. Keeps the ban
  cluster one mental model, consistent with the "designed as one ban model" scope decision.
- Q: Is text-prefix enablement per-guild or process-wide? → A: **Process-wide** — one deployment
  on/off switch enables the text-prefix style AND requests the Message Content intent for the whole
  bot; off by default. This is honest about the privilege cost (the Message Content intent is
  per-connection/process, not per-guild — Discord cannot scope it per server), so "off" genuinely does
  not request the intent. A per-guild toggle is rejected as misleading (the intent would be on
  process-wide regardless).

## User Scenarios & Testing *(mandatory)*

<!--
  The widest coherent bot-depth slice: the full STATELESS moderation surface plus the remaining
  interaction styles. "Stateless" is the deliberate boundary — every capability here acts on live
  platform state (members, messages, channels, the platform's own ban list and audit log) and needs
  NO new persistent store. Anything requiring durable bot-owned records (a warnings/infractions
  history) is deferred until the 007 storage work exists. Both areas follow Principle I — a
  capability is logic, an interaction style is an adapter — so the new styles reuse the exact
  authorization gates the slash and reaction styles already use, and no existing capability logic is
  rewritten.
-->

### User Story 1 - A moderator times a member out (Priority: P1)

A moderator temporarily silences a disruptive member without removing them. They run a timeout
command naming the member and a duration (optionally a reason); the bot verifies the invoker's native
timeout permission and the hierarchy guards, applies a self-expiring timeout, and records the reason
in the audit log. A moderator can also clear an active timeout early.

**Why this priority**: Timeout is the most-used, least-destructive, fully-reversible sanction — the
safest slice to establish the whole sanction shape (permission gate, hierarchy guards, audit reason,
safe refusal) that kick, ban, and message moderation all reuse.

**Independent Test**: A moderator times out a member for a set duration (restricted for that window,
auto-restored after) and clears it early; a non-moderator is refused; an unmanageable target is a safe
refusal — verifiable through the command and the member's timeout state.

**Acceptance Scenarios**:

1. **Given** an invoker with the native timeout permission and a manageable target, **When** they run
   the timeout command with a member and a valid duration, **Then** the member is timed out for that
   duration, the reason (if given) is recorded in the audit log, and the bot confirms privately.
2. **Given** a member currently timed out, **When** a moderator runs the command to clear the timeout,
   **Then** the timeout is lifted immediately.
3. **Given** an invoker WITHOUT the native timeout permission, **When** they run the command, **Then**
   the bot refuses, applies nothing, and explains they lack permission.
4. **Given** a target the bot cannot manage (outranks the bot, or missing permission), **When** a
   moderator tries, **Then** the bot refuses safely with a diagnosable reason and applies nothing.

---

### User Story 2 - A moderator kicks or bans a member present in the server (Priority: P1)

A moderator removes a present member — kick (they can rejoin with a new invite) or ban (they cannot
rejoin). They run the command naming the member, optionally a reason, and for ban optionally a
message-delete window (purge the banned user's recent messages). The bot verifies the native
permission and hierarchy guards, applies the action, and records the reason in the audit log.

**Why this priority**: Kick and ban of a present member are core moderation parity and share the exact
gate/guard shape from US1. A moderation feature without removal is incomplete, so this is P1 alongside
timeout.

**Independent Test**: A moderator kicks a member (removed, can rejoin) and bans another (removed,
cannot rejoin, optional recent-message purge), each with a recorded reason; a non-moderator is
refused; an unmanageable target is a safe refusal — verifiable through the command and the target's
server membership.

**Acceptance Scenarios**:

1. **Given** an invoker with the native kick permission and a manageable present target, **When** they
   run kick, **Then** the member is removed (may rejoin) with the reason recorded, confirmed privately.
2. **Given** an invoker with the native ban permission and a manageable present target, **When** they
   run ban (optionally with a message-delete window), **Then** the member is removed and prevented from
   rejoining, any selected recent messages are purged, and the reason is recorded.
3. **Given** an invoker without the required native permission, **When** they run kick or ban, **Then**
   the bot refuses and takes no action.
4. **Given** a target that outranks the invoking moderator, or that the bot cannot manage, **When** a
   moderator tries, **Then** the bot refuses safely with a diagnosable reason and takes no action.

---

### User Story 3 - A moderator manages the ban list (pre-emptive ban, unban, list) (Priority: P2)

A moderator manages the server's ban list beyond present members: pre-emptively ban a user by id
before they ever join (block a known bad actor), unban a previously-banned user, and view who is
banned and why. They run the relevant command with a user id (or pick from the ban list); the bot
verifies the native ban permission and applies the change against the platform's ban list, recording
reasons in the audit log.

**Why this priority**: Ban-list management completes the ban surface and is designed together with
US2 (one coherent ban model — ban, unban, list, pre-emptive — rather than shipping ban without its
inverse). It is P2 because present-member removal (US2) delivers the core need; ban-list curation is
the important-but-secondary extension of it.

**Independent Test**: A moderator pre-emptively bans a user id not in the server (that user cannot
join), unbans them (they can join again), and lists the current bans to see entries and reasons; a
non-moderator is refused — verifiable through join attempts and the ban-list contents.

**Acceptance Scenarios**:

1. **Given** an invoker with the native ban permission and a user id not currently in the server,
   **When** they run the pre-emptive ban command, **Then** that user is added to the ban list and
   cannot join, with the reason recorded.
2. **Given** a banned user, **When** a moderator runs unban for that user, **Then** the user is
   removed from the ban list and may join again.
3. **Given** existing bans, **When** a moderator lists the ban list, **Then** they see the banned
   users and recorded reasons, privately.
4. **Given** an invoker without the native ban permission, **When** they attempt any ban-list action,
   **Then** the bot refuses with no change.
5. **Given** a bulk-ban of several user ids at once, **When** a moderator runs it, **Then** each valid
   id is banned and the outcome (which succeeded / which failed and why) is reported, without one bad
   id aborting the rest.

---

### User Story 4 - A moderator moderates messages and channels (Priority: P2)

A moderator cleans up or controls a channel: bulk-delete (purge) recent messages, set slowmode,
lock/unlock a channel (deny/allow members sending), and pin/unpin a message. They run the relevant
command; the bot verifies the native message/channel-management permission and applies the change.

**Why this priority**: Message and channel moderation is a distinct target (messages/channels rather
than members) but is squarely part of the stateless moderation surface and shares the
permission-gated, fail-safe shape. It is P2 because member sanctions (US1/US2) are the more central
moderation need; channel cleanup supports them.

**Independent Test**: A moderator purges N recent messages (they disappear), sets slowmode (sends are
rate-limited), locks a channel (members can't send) then unlocks it, and pins/unpins a message; a
non-moderator is refused — verifiable through the channel state and message presence.

**Acceptance Scenarios**:

1. **Given** an invoker with the native message-management permission, **When** they purge a specified
   count of recent messages, **Then** those messages are deleted and the bot reports how many, subject
   to the platform's bulk-delete constraints (e.g. messages older than the platform's bulk limit are
   reported as skipped, not errored).
2. **Given** an invoker with the native channel-management permission, **When** they set slowmode to a
   valid interval, **Then** members' sends in that channel are rate-limited to it; setting it to zero
   clears slowmode.
3. **Given** the same, **When** they lock the channel, **Then** members can no longer send; unlocking
   restores sending.
4. **Given** the same, **When** they pin (or unpin) a message, **Then** the message's pinned state
   changes accordingly.
5. **Given** an invoker lacking the required permission for any of these, **When** they run it, **Then**
   the bot refuses with no change.

---

### User Story 5 - A member uses a whitelisted role via a button or select menu (Priority: P2)

An operator posts a message with buttons (or a select menu) for self-assignable roles. A member
activates one and the corresponding whitelisted role is toggled on them — the same result as the slash
command or a reaction, through a different input, with no command typed.

**Why this priority**: Component-based role menus are the most-requested modern reaction-role
alternative and prove the interaction-surface-as-extension-axis design a second time (after
reactions). They enhance UX for a capability members already have, so they sit below the moderation
P1 work.

**Independent Test**: With an operator-configured button/menu bound to a whitelisted role, a member
activates it (role toggled on), activates again (off), and a component bound to a non-whitelisted role
does nothing — reusing the same whitelist gate as the slash and reaction styles.

**Acceptance Scenarios**:

1. **Given** an operator-configured component bound to a whitelisted role and a member who lacks it,
   **When** the member activates it, **Then** the bot toggles the role on and confirms privately.
2. **Given** the same component and a member who has the role, **When** they activate it, **Then** the
   bot toggles it off.
3. **Given** a component bound to a role NOT on the whitelist, **When** a member activates it, **Then**
   the bot makes no change — the whitelist is the authorization, exactly as for slash and reaction.
4. **Given** a component bound to a role the bot cannot manage, **When** a member activates it, **Then**
   the bot refuses safely (privately) and makes no change, never a crash.

---

### User Story 6 - A member uses a text-prefix command (Priority: P3)

On a deployment that has opted into the text-prefix style (a process-wide on/off switch, off by
default), a member types a prefixed message command
(e.g. `!role Announcements`, `!roles`, `!nick NewName`) and the existing capability runs — the same
result as the slash command, through a text message. This style requires the privileged
message-content capability, kept opt-in and isolated: the bot boots and every other style works with
it off.

**Why this priority**: Text-prefix is the BED-BOT-native input style and completes parity, but it is
lowest priority — it duplicates capabilities reachable through slash, reaction, and components, and is
the only style requiring a privileged intent, so it is the most isolated and least essential slice.

**Independent Test**: With text-prefix enabled, a member types the role/nickname prefix commands and
gets the same outcomes as the slash equivalents; with the style (and its intent) disabled, those
messages do nothing and every other style still works.

**Acceptance Scenarios**:

1. **Given** text-prefix enabled and message-content on, **When** a member types the role-toggle prefix
   command with a whitelisted role, **Then** the role is toggled under the same authorization gate as
   the slash command.
2. **Given** the same, **When** a member types the nickname prefix command, **Then** their nickname is
   set/reset under the same rules as the slash command.
3. **Given** message-content OFF (or the style disabled), **When** a member types a prefix command,
   **Then** nothing happens for that style AND every other style (slash, reaction, components) works
   and the bot boots normally.
4. **Given** a text-prefix command for a non-whitelisted role or an unmanageable target, **When** a
   member sends it, **Then** it is refused under the same gate as the other styles, with no change.

---

### Edge Cases

- **Moderator sanctions themselves or the bot**: refused with a clear message; never a half-action.
- **Sanction target outranks the invoking moderator** (not just the bot): refused — a moderator may
  not sanction someone at or above their own highest role, mirroring the platform's rule.
- **Kick a user not in the server**: a clear "not a member" no-op, never an error (kick has no
  pre-emptive form; ban does).
- **Pre-emptive ban of an already-banned id / unban of a not-banned id**: each is a clear, idempotent
  "already banned" / "not banned" message, not an error.
- **Bulk ban with a mix of valid/invalid ids**: valid ids are banned, invalid ones reported per-id;
  one bad id never aborts the batch (US3 scenario 5).
- **Timeout duration out of range**: above the platform maximum (28 days) or non-positive is refused
  with a clear message stating the allowed range, no partial application.
- **Purge across the platform's bulk-delete age limit**: messages older than the platform's bulk limit
  (14 days) cannot be bulk-deleted; the command reports them as skipped rather than failing the whole
  purge.
- **Slowmode / lock on a channel type that doesn't support it** (e.g. a category, a thread where it
  differs): refused with a clear message, no partial state.
- **Component or text-prefix binding references a role deleted or de-whitelisted after configuration**:
  activating it is a clean no-op (no crash); the failure is diagnosable and an operator can prune it.
- **A stale/expired component interaction** (an old message's button clicked much later): a safe no-op
  or a clear "no longer active" response, never an unhandled error.
- **Message-content capability toggled off while text-prefix bindings exist**: the text-prefix style
  stops receiving input; no other style is affected and the bot stays healthy.
- **Rapid repeated component clicks**: the member ends in a single consistent has/has-not role state,
  never duplicated or partial (same idempotency as the other styles).

## Requirements *(mandatory)*

### Functional Requirements

**Member sanctions (timeout / kick / ban / ban-list)**

- **FR-001**: A moderator MUST be able to time out another member for a specified in-range duration
  (gated by the native timeout permission), the timeout MUST self-expire, and a moderator MUST be able
  to clear an active timeout early.
- **FR-002**: A moderator MUST be able to kick a present member (removed, may rejoin — native kick
  permission) and to ban a present member (removed, cannot rejoin — native ban permission), with an
  optional message-delete window on ban that purges the banned user's recent messages.
- **FR-003**: A moderator MUST be able to manage the ban list beyond present members: pre-emptively
  ban a user by id (blocks future join), unban a user by id, list current bans with reasons, and bulk
  ban multiple ids in one action — all gated by the native ban permission. A bulk action MUST report
  per-id outcomes and MUST NOT let one bad id abort the rest. The ban actions (present-member ban,
  pre-emptive ban-by-id, bulk ban) MUST be exposed as ONE unified `/ban` command whose supplied option
  (`member` / `user_id` / `user_ids`) selects the mode; `unban` and `bans` (list) are separate
  commands.
- **FR-004**: Every moderation action MUST forward an optional operator-supplied reason to the
  platform's audit log wherever the platform accepts one (member sanctions — timeout/kick/ban/unban —
  and message/channel actions that support an audit reason, e.g. purge/lock), so the action is
  attributable. Where the platform does not accept a reason for an action, the reason is simply not
  recorded for it (no failure).
- **FR-005**: Every member sanction MUST enforce the hierarchy guards before acting: the bot can
  manage the target (target below the bot's highest role, bot holds the required permission) AND the
  target is below the invoking moderator's own highest role. A guard failure MUST be a safe refusal
  that changes nothing.
- **FR-006**: A timeout duration MUST be validated against the platform's allowed range; out-of-range
  or non-positive durations MUST be refused with a clear message and no partial effect.
- **FR-007**: A sanction by a member lacking the required native permission MUST be refused with no
  effect; member-sanction commands MUST refuse a self-target and a bot-target.

**Message & channel moderation**

- **FR-008**: A moderator MUST be able to bulk-delete (purge) a specified count of recent messages in
  a channel, gated by the native message-management permission; messages beyond the platform's
  bulk-delete age limit MUST be reported as skipped rather than failing the whole action.
- **FR-009**: A moderator MUST be able to set/clear a channel's slowmode interval and lock/unlock a
  channel (deny/allow member sends), gated by the native channel-management permission; an unsupported
  channel type MUST be refused with a clear message, no partial state.
- **FR-010**: A moderator MUST be able to pin and unpin a message, gated by the native
  message-management permission.

**Additional interaction styles (over existing capabilities)**

- **FR-011**: A member MUST be able to toggle a self-assignable role by activating an
  operator-configured message component (a button or a select-menu option) bound to that role,
  producing the same outcome as the slash and reaction styles.
- **FR-012**: A member MUST be able to invoke the existing role and nickname capabilities via
  text-prefix commands when that style is enabled, producing the same outcomes as the slash
  equivalents.
- **FR-013**: Every additional style MUST reuse the EXISTING capability logic and its authorization
  gates (the self-assignable whitelist, the bot-position guard) unchanged — a component or text
  command can never grant a role the whitelist does not allow, and adding a style MUST NOT require
  changing the capability logic (a new input adapter only).
- **FR-014**: Component **bindings** MUST be operator-editable runtime data (changeable without a code
  change or redeploy), consistent with routes, the whitelist, and reaction-role mappings; the system
  MUST NOT auto-create bindings. (Text-prefix *enablement* is the exception: it is a process-wide
  deploy switch governed by FR-015, not runtime-editable data, because it toggles a per-connection
  privileged intent.)
- **FR-015**: The text-prefix style MUST require the privileged message-content capability and keep it
  opt-in and isolated: the bot MUST boot and every other style (slash, reaction, components) MUST
  function with message-content OFF. Enabling text-prefix MUST be a deliberate **process-wide** deploy
  choice (a single on/off switch, off by default) that both activates the style AND requests the
  message-content capability; when off, the capability MUST NOT be requested at all. Enablement is NOT
  per-guild — the underlying message-content capability is per-connection, so a per-guild toggle cannot
  reduce the privilege footprint.

**Cross-cutting**

- **FR-016**: Member-facing responses to moderation commands and component activations MUST be private
  to the acting member (not broadcast to the channel); a failed interaction MUST NOT spam the channel.
  (Purge/lock/slowmode necessarily change shared channel state; their confirmation to the invoker is
  still private.)
- **FR-017**: The feature MUST operate with least-privilege gateway permissions — moderation adds only
  the specific management permissions its commands require (moderate / kick / ban members, manage
  messages, manage channels); components need no new intent; only text-prefix adds the message-content
  capability, isolated per FR-015.
- **FR-018**: A failure in any single moderation action, component activation, or text command (missing
  permission, ranking conflict, deleted role, invalid input, unsupported channel, stale interaction)
  MUST NOT crash the bot or affect other commands, styles, reactions, or the inbound pipeline; it MUST
  be contained to that one invocation and be diagnosable.
- **FR-019**: Each new capability and style MUST be a self-registering module dispatched generically
  (sanction/message/channel commands via the command registry; components via the component dispatcher
  keyed by identifier; text-prefix via its own message dispatcher) — no central switch statement
  enumerating them and no edits to the dispatch core.
- **FR-020**: The feature MUST NOT alter the existing inbound-webhook → routing → delivery pipeline,
  nor the existing 004/005 self-service and cross-member commands, reactions, or their outcomes; it
  adds moderation capability and additional input styles only.
- **FR-021**: This feature MUST remain stateless with respect to bot-owned persistence: no capability
  here introduces a new durable bot record. Anything requiring durable moderation history (warnings /
  infractions / auto-escalation) is explicitly out of scope (see Out of Scope) and MUST NOT be
  partially built here.

### Key Entities *(include if feature involves data)*

- **Sanction action**: a moderation act (timeout / kick / ban / unban / purge / lock / slowmode / pin)
  on a target member, message, or channel, carrying an optional reason and any action-specific
  parameter (timeout duration, ban message-delete window, purge count, slowmode interval). NOT
  persisted by this feature beyond the platform's own audit log and ban list — the bot acts on live
  platform state.
- **Component binding**: an operator-curated record binding a message component (a button or a
  select-menu option, identified stably) to a self-assignable role. Scoped to a server; presence plus
  a matching whitelist entry is the whole authorization; never auto-created. Analogous to the 005
  reaction-role mapping, for the component style.
- **Text-prefix style configuration**: the **process-wide** deploy choice enabling the text-prefix
  style (and its required message-content capability) for the whole bot, plus the prefix it listens
  for. A single on/off switch, off by default (the style and the capability are both absent when off);
  not per-guild.
- **Self-assignable role entry** (existing, 004): the whitelist every role-granting style intersects
  with. Unchanged; reused as the authorization for components and text-prefix.
- **Moderator** / **Target**: the actor and the subject (member, message, or channel) of a moderation
  action; evaluated per invocation from live permission/hierarchy state, not stored by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A moderator can timeout (and clear), kick, ban a present member, pre-emptively ban by
  id, unban, list bans, and bulk ban — each in a single command with an optional audit-log reason;
  100% of the same attempts by a member lacking the required permission are refused with no effect.
- **SC-002**: The bot never sanctions a target it cannot manage or one at/above the invoking
  moderator's own position; every such case is a safe, diagnosable refusal, never a crash or partial
  action.
- **SC-003**: A timeout applies for the requested in-range duration and self-expires (clearable
  early); out-of-range durations are refused 100% of the time.
- **SC-004**: A moderator can purge recent messages, set/clear slowmode, lock/unlock a channel, and
  pin/unpin a message; messages beyond the bulk-delete age limit are reported as skipped, and
  unsupported channel types are refused — never a crash or partial state.
- **SC-005**: A member can toggle a whitelisted role through a button or select menu with the same
  result as the slash/reaction styles; 100% of component activations for a non-whitelisted role result
  in no change.
- **SC-006**: When text-prefix is enabled, members get identical role/nickname outcomes to the slash
  commands through prefixed messages; when its message-content capability is OFF, the bot boots and
  every other style works, with zero text-prefix effect.
- **SC-007**: Adding these styles requires no change to the existing role/nickname capability logic —
  the same authorization gate governs slash, reaction, component, and text-prefix inputs alike.
- **SC-008**: Introducing this feature causes no change to inbound webhook routing/delivery or to the
  existing 004/005 commands, reactions, and their outcomes — those behave identically, and no new
  durable bot record is introduced.

## Assumptions

- The hub already runs an always-on gateway bot with self-registering command/event/component
  registries and the shared role/nickname capability logic (004) plus the reaction style and
  cross-member moderation (005). This feature adds moderation capabilities and two more input adapters
  over that capability — not a new bot, engine, or persistence layer.
- "Moderator" for each action is the invoker's native platform permission for that action (Moderate
  Members for timeout; Kick Members for kick; Ban Members for ban/unban/ban-list; Manage Messages for
  purge/pin; Manage Channels for slowmode/lock), evaluated per invocation — consistent with the
  native-permission model chosen in 005. No moderator-role store is introduced.
- Member sanctions additionally require the bot to hold the corresponding permission and to outrank
  the target (the bot-position guard), plus the invoker-position guard so a moderator cannot sanction
  someone above their own highest role. (Message/channel actions are guarded by the bot's channel
  permissions rather than member hierarchy.)
- The platform's timeout maximum is 28 days and its bulk-delete age limit is 14 days; the bot enforces
  these so the member gets a clear message rather than relying on the platform to reject.
- Component (button/select) interactions are delivered under the existing interaction gateway
  capability and need NO new privileged intent; only the text-prefix style needs the message-content
  capability, off unless a server opts in.
- Component and text-prefix bindings reuse the existing operator-editable runtime-data approach (the
  same admin surface as routes, the whitelist, and reaction-role mappings); no new admin UI is built
  here, and a dedicated in-Discord operator command to manage them remains deferred to the
  admin/diagnostics work.
- The self-assignable whitelist (004) remains the whole authorization for every role-granting style; a
  component or text command is an additive input, never an authorization bypass.
- The feature is deliberately bounded to STATELESS moderation: it uses the platform's own audit log
  and ban list, and introduces no bot-owned durable store. A warnings/infractions system (which needs
  such a store) is deferred until the storage work exists — see Out of Scope.

## Out of Scope (Deferred — needs architecture this feature deliberately avoids)

Recorded so they are picked up later rather than dropped. The boundary is **new persistent-store
architecture**: this feature stops exactly where a capability would need a durable bot-owned record.

- **Warnings / infractions system** — issuing a warning, a persistent per-member infraction history,
  a modlog channel that records every action durably, auto-escalation (e.g. 3 warnings → mute), and
  auto-expiring temp-bans. All require a durable moderation-record store the hub does not yet have.
  These land as **spec 008** (their own moderation-records feature), built on the 007 storage work —
  i.e. after 007, not in it.
- **`bot_state`/kv** — a free-form per-guild key/value config store (the general persistence
  primitive the infractions system and other stateful features will build on). Deferred to 007
  (infrastructure).
- **Scheduled jobs** — cron-like scheduled actions reusing the delivery service (e.g. recurring
  posts, scheduled unbans). Reuses the delivery pipeline; may depend on the kv store; deferred to 007.
- **Voice moderation** (move/disconnect/server-mute in voice) — a distinct permission and target set;
  a small later addition, not part of the text/role/member surface here.

Grouping: 006 = the full **stateless** bot-interaction and moderation depth; 007 = the **stateful
infrastructure** (kv + scheduled jobs) that unlocks the infractions system and other durable features.
Each spec stays coherent and independently shippable.
