# Feature Specification: Self-Service Roles & Nicknames (BED-BOT parity)

**Feature Branch**: `004-bot-roles-nicknames`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Core bot-depth parity with the collaborator's self-hosted bot (BED-BOT) — self-assignable roles, a list of assignable roles, self-service nicknames, all gated by an operator-editable whitelist so members can only touch explicitly-allowed roles."

## Clarifications

### Session 2026-06-30

- Q: How does a member specify which role to self-assign in the command? → A: The command takes a
  native **role parameter** — the member picks an actual server role from the platform's role
  picker (which shows role names). The picker is not pre-filtered, so a member can pick a
  non-self-assignable role; that pick is then refused by the whitelist check (FR-002). The system
  works in stable role identifiers, so a role rename does not break the whitelist and a deleted role
  is cleanly detected. Chosen for long-term flexibility: the same whitelist data can later drive
  buttons/select-menus/reaction-roles (Phase-3 spec 005) without changing the capability logic —
  the role picker is just one input adapter onto the capability (Principle I).
- Q: How does an operator add/remove roles from the self-assignable whitelist in this feature? → A:
  Direct runtime-data editing only (the existing operator table-editor surface, the same way routes
  are curated today) — no in-Discord operator command ships in 004. US4 is satisfied by editing the
  whitelist data; it requires no new command code. A convenient in-Discord operator command to
  manage the whitelist is deferred to the admin/diagnostics spec (006), not dropped.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member self-assigns a whitelisted role (Priority: P1)

A server member wants to give themselves a role the operators have made available for self-service
(e.g. a notification opt-in, a pronoun tag, a game-interest role) without pinging an admin. They run
a command and select the role; if they don't have it, the bot adds it; if they already have it, the
bot removes it (a toggle). The bot only ever touches roles an operator has explicitly marked
self-assignable — selecting any other role is refused.

**Why this priority**: This is the core parity capability and the security boundary in one. It is
the single most-used BED-BOT behavior the hub must match, and the whitelist enforcement is what
makes self-service safe. Everything else in this feature supports or surrounds it.

**Independent Test**: With one role marked self-assignable and one not, a member toggles the
allowed role on (gets it), toggles it again (loses it), and is refused when naming the non-allowed
role — verifiable entirely through the member's command and the resulting role membership, with no
other capability present.

**Acceptance Scenarios**:

1. **Given** a role is on the self-assignable whitelist and the member does not have it, **When**
   the member runs the self-assign command for that role, **Then** the bot adds the role to the
   member and confirms, privately to that member.
2. **Given** the same role and a member who already has it, **When** the member runs the command
   for that role, **Then** the bot removes the role and confirms the removal (toggle behavior).
3. **Given** a role that is NOT on the whitelist, **When** a member runs the command and selects it,
   **Then** the bot refuses, makes no change to the member's roles, and explains that the role is
   not self-assignable.
4. **Given** a whitelisted role that sits higher than the bot's own highest role (so the bot lacks
   the standing to manage it), **When** a member tries to self-assign it, **Then** the bot refuses
   safely with a diagnosable reason and makes no change, rather than erroring out.

---

### User Story 2 - A member sees which roles are self-assignable (Priority: P2)

Before assigning, a member wants to know what roles are even available to self-assign. They run a
list command and get the current set of self-assignable roles. This is how a member discovers the
options without trial and error, and it reflects operator edits to the whitelist immediately.

**Why this priority**: Discovery makes the self-assign capability usable, but the assign capability
(US1) delivers value on its own; a member who already knows a role name can use US1 without this.

**Independent Test**: With a known set of roles on the whitelist, a member runs the list command
and sees exactly those roles; after an operator adds or removes one from the whitelist, the next
listing reflects the change with no redeploy.

**Acceptance Scenarios**:

1. **Given** a set of roles marked self-assignable, **When** a member runs the list command,
   **Then** the bot replies with that set (and only that set), privately to the member.
2. **Given** an empty whitelist, **When** a member runs the list command, **Then** the bot replies
   that no roles are currently self-assignable, rather than an empty or confusing response.
3. **Given** an operator adds a role to the whitelist, **When** a member runs the list command
   afterward, **Then** the newly-added role appears without any deploy or restart.

---

### User Story 3 - A member sets or resets their own nickname (Priority: P2)

A member wants to change their display name in the server, or revert to their account name, without
admin help. They run a command with the new nickname to set it, or with no nickname to reset it.
The bot enforces the platform's length limit and refuses anything invalid with a clear message.

**Why this priority**: Self-service nicknames are part of BED-BOT parity and frequently used, but
they are independent of the role capabilities — the feature is still valuable for roles alone if
nicknames slip, and vice versa.

**Independent Test**: A member sets a valid nickname (it changes), sets one over the length limit
(refused with a clear reason, no change), and resets (nickname cleared back to the account name) —
all verifiable through the member's command and their resulting display name.

**Acceptance Scenarios**:

1. **Given** a member and a valid new nickname within the length limit, **When** the member runs
   the set-nickname command, **Then** their server nickname changes to it and the bot confirms
   privately.
2. **Given** a nickname longer than the platform's 32-character limit, **When** the member submits
   it, **Then** the bot refuses with a message stating the limit and makes no change.
3. **Given** a member with a nickname set, **When** the member runs the command with no nickname
   provided (reset), **Then** their nickname is cleared and they display under their account name.
4. **Given** a member whose nickname the bot cannot change because the member outranks the bot,
   **When** they try, **Then** the bot refuses safely with a diagnosable reason and makes no change.

---

### User Story 4 - An operator curates the self-assignable whitelist (Priority: P1)

An operator decides which roles members may self-assign, editing that set as runtime data (the same
way routes are edited today) — no code change, no deploy. Adding a role makes it immediately
self-assignable; removing it immediately stops further self-assignment. Elevated/staff/admin roles
are never silently includable in a way that lets a member escalate.

**Why this priority**: The whitelist is the safety boundary the whole feature depends on; without an
operator-curated set there is nothing for US1/US2 to enforce against. It is foundational, hence P1
alongside US1.

**Independent Test**: An operator marks a role self-assignable; a member can then self-assign it
(US1). The operator removes it; the member can no longer self-assign it and it disappears from the
listing (US2) — all without a deploy.

**Acceptance Scenarios**:

1. **Given** an operator marks a role self-assignable in the whitelist data, **When** a member next
   tries to self-assign that role, **Then** it succeeds (it is now allowed), with no redeploy.
2. **Given** an operator removes a role from the whitelist, **When** a member next tries to
   self-assign that role, **Then** it is refused, with no redeploy.
3. **Given** the whitelist data, **When** an operator inspects it, **Then** it contains only role
   references an operator placed there — the system never auto-adds a role to the whitelist.

---

### Edge Cases

- **Role deleted after being whitelisted**: a member self-assigning a role that no longer exists in
  the server gets a clear "that role no longer exists" refusal, not a crash; an operator can prune
  the stale whitelist entry.
- **Bot lacks the Manage Roles / Manage Nicknames permission, or the role/member outranks the
  bot**: the bot refuses safely with a diagnosable reason and changes nothing — it never half-acts.
- **Member is not in a guild context** (e.g. command invoked where there is no member to modify):
  refused with a clear message; no error surfaced to the platform.
- **Whitelist names a role that is an elevated/staff role**: the system does not special-case role
  privilege beyond the bot-position guard, but the operator-only curation + the "never auto-add"
  rule mean such inclusion is an explicit operator act, and the bot-position guard still prevents
  assigning anything above the bot. (Operators are responsible for not whitelisting admin roles;
  the system makes that an explicit, visible choice, never an accident.)
- **Concurrent toggles** of the same role by the same member: the result is deterministic (the
  member ends in a single consistent has/has-not state), never a duplicated or partial assignment.
- **Nickname that is empty vs. only whitespace vs. reset**: an explicit reset clears the nickname;
  a whitespace-only value is treated as invalid (refused) rather than silently setting a blank name.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A member MUST be able to toggle a self-assignable role on themselves via a slash
  command: the role is added if the member lacks it and removed if the member has it. The member
  specifies the role by selecting an actual server role through the platform's native role picker
  (the picker shows role names; it is not pre-filtered to only assignable roles — a forbidden pick
  is handled by FR-002). The system identifies the role by a stable identifier, so a role rename
  does not change which whitelist entry it matches.
- **FR-002**: The system MUST refuse any self-assign request for a role that is not on the
  operator-curated self-assignable whitelist, making no change to the member's roles and returning a
  clear reason.
- **FR-003**: A member MUST be able to list the roles currently self-assignable, reflecting the
  current whitelist state; an empty whitelist MUST produce an explicit "none available" response.
- **FR-004**: A member MUST be able to set their own server nickname to a provided value, and to
  reset (clear) it by providing no value; a set value MUST be rejected if it exceeds the platform's
  32-character limit or is only whitespace, with no change made.
- **FR-005**: The self-assignable whitelist MUST be operator-editable runtime data (changeable
  without a code change or redeploy); an operator add takes effect on the next member request and an
  operator remove stops further self-assignment immediately.
- **FR-006**: The system MUST NOT automatically add any role to the whitelist; membership in the
  whitelist MUST only ever result from an explicit operator action.
- **FR-007**: The bot MUST refuse to add or remove a role it does not have the standing to manage —
  specifically a role positioned at or above the bot's own highest role, or when it lacks the
  required permission — failing safely with a diagnosable reason and changing nothing.
- **FR-008**: The bot MUST refuse to change a nickname it cannot manage (the target outranks the
  bot, or the bot lacks the permission), failing safely with a diagnosable reason and changing
  nothing.
- **FR-009**: Member-facing responses to these commands MUST be private to the requesting member
  (not broadcast to the channel).
- **FR-010**: The role-toggle and nickname commands MUST act ONLY on the invoking member — a member
  MUST NOT be able to change another member's roles or nickname through these commands. (Acting on
  other members is a moderation capability outside this feature's scope.)
- **FR-011**: Each capability (self-assign a role, list assignable roles, manage own nickname) MUST
  be implemented as logic that a slash command invokes, structured so the same capability could
  later be offered through another interaction style without rewriting the capability logic.
- **FR-012**: The feature MUST operate with least-privilege gateway permissions — only what
  role/nickname management requires — and MUST NOT require the privileged message-content
  capability; the bot MUST continue to boot and function with that capability off.
- **FR-013**: A command failure (invalid input, missing permission, ranking conflict, deleted role)
  MUST NOT crash the bot or affect other commands; it MUST return a clear, member-actionable message
  for that one invocation.
- **FR-014**: The whitelist MUST scope correctly to the server it applies to, so a role
  self-assignable in one server is not treated as self-assignable in another (the system supports
  per-server whitelists, not a single global list).
- **FR-015**: The feature MUST NOT alter the existing inbound-webhook → routing → delivery pipeline;
  it adds member-management capability only.

### Key Entities *(include if feature involves data)*

- **Self-assignable role entry**: an operator-curated record marking a specific server role as
  available for member self-assignment. Scoped to a server. Holds a **stable role identifier** and
  the server it applies to (identifier-based, so a role rename does not break the entry). The
  presence of an entry is the whole authorization — no entry means not self-assignable.
- **Server member**: the actor for the self-service commands; the subject whose roles and nickname
  are changed. Not stored by this feature beyond what the platform already holds — the bot acts on
  live member state.
- **Operator**: the actor who curates the whitelist (via the same runtime-data editing surface used
  for other operational state today). Not a new auth system; the editing surface is the existing
  operator-facing data store.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can self-assign and later self-remove a whitelisted role entirely through a
  single command, with no operator involvement, in under 10 seconds per action.
- **SC-002**: 100% of self-assign attempts for non-whitelisted roles are refused with no role
  change — there is no input by which a member obtains a role not on the whitelist, and no input by
  which a member changes another member's roles or nickname through these commands.
- **SC-003**: A member can discover the full set of self-assignable roles via one command, and the
  set matches the operator's current whitelist exactly.
- **SC-004**: A member can set a valid nickname and reset it; nicknames over the 32-character limit
  are refused 100% of the time with no change.
- **SC-005**: An operator can make a role self-assignable, or stop it being self-assignable, by
  editing runtime data alone — the change governs the next member request with zero redeploys.
- **SC-006**: The bot never assigns or removes a role above its own position and never changes a
  nickname it cannot manage; every such case is a safe refusal, never a crash or partial change.
- **SC-007**: Introducing this feature causes no change to inbound webhook routing or delivery — the
  existing pipeline behaves identically.

## Assumptions

- The hub already runs an always-on gateway bot that can receive and respond to slash-command
  interactions and observe guild members; this feature adds commands and a whitelist store, not a
  new bot or connection.
- The whitelist store reuses the existing operator-editable runtime-data approach (a database table
  edited through the same admin surface as routing today) — no new admin UI is built here.
- "Operator curates the whitelist" means editing that data directly (the day-one admin surface);
  a dedicated in-Discord operator command to manage the whitelist is out of scope for this feature
  and is deferred to the admin/diagnostics spec (006) — it is not required for members to use
  self-service against an operator-set list.
- The platform's nickname length limit is 32 characters; the bot enforces this rather than relying
  on the platform to reject, so the member gets a clear message.
- Role management obeys the platform's role-hierarchy rule: a bot can only manage roles below its
  own highest role. The bot-position guard (FR-007) encodes this; operators must position the bot's
  role above the roles it should manage.
- This feature is slash-command-only. The capabilities are structured so reaction-driven and
  component/button styles can be added later (next Phase-3 spec) without changing the capability
  logic, but none of those styles ship here.
- The privileged message-content capability is NOT used; it remains off and is the subject of a
  later spec (moderation / reaction-roles).
- Whitelisting an elevated/admin role is prevented from causing escalation by the bot-position guard
  and is otherwise treated as an explicit operator responsibility; the system does not maintain its
  own catalog of "which roles are privileged."
