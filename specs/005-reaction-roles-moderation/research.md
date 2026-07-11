# Phase 0 — Research: Reaction-Roles & Moderation

Focused decisions the plan depends on. Each is a resolved choice (no open `NEEDS CLARIFICATION`),
with the rationale and the rejected alternative.

## 1. Receiving reaction events without Message Content

**Decision**: Add the `GuildMessageReactions` gateway intent and the `Message` + `Reaction`
partials. Do **not** add Message Content.

**Rationale**: `messageReactionAdd` / `messageReactionRemove` are delivered under
`GuildMessageReactions`. The event payload carries the message id, channel/guild, the reacting user,
and the emoji — everything the reaction-role resolution needs — **without** the privileged Message
Content intent (which only gates the *text* of a message). A reaction to a message the bot has not
cached this session (an older message, or after a restart) arrives as a **partial**; enabling the
`Message` and `Reaction` partials lets the handler still resolve the message id and emoji (fetching
the full object if ever needed), satisfying FR-006. This keeps the bot least-privilege (Principle
II) and keeps the `bot-intents` test's load-bearing assertion — Message Content is OFF — true.

**Alternatives rejected**: (a) Message Content intent — unnecessary; the bot never reads message
text, and requesting it violates least privilege and would trip the intents guard. (b) No partials —
would silently drop reactions on un-cached messages, failing FR-006.

## 2. Emoji identity — matching a reaction to a mapping

**Decision**: Store and match the emoji by its **stable identity**: for a unicode emoji, the
codepoint string (the emoji character itself, e.g. `🔔`); for a custom server emoji, the numeric
emoji **id**. A discord.js `ReactionEmoji` exposes `id` (non-null only for custom emoji) and `name`
(the unicode char for standard emoji, the custom emoji's name otherwise). The match key is therefore
`emoji.id ?? emoji.name`.

**Rationale**: Custom-emoji names are mutable and non-unique; the numeric id is stable and unique, so
matching on `id` survives a rename (mirroring how roles are keyed by stable id, FR-004). Unicode
emoji have no id — the codepoint *is* the stable identity. `emoji.id ?? emoji.name` yields one
canonical key for both kinds with no branching in the match itself. The mapping table stores this
key plus a small discriminator so an operator reading the row can tell a unicode entry from a custom
one.

**Alternatives rejected**: matching on the display name (breaks on custom-emoji rename, ambiguous for
duplicate names); storing the full serialized emoji (`name:id`) — redundant, and the id alone is the
stable part.

## 3. Reaction removal semantics — unconditional (source-of-truth model)

**Decision**: Removing a mapped reaction removes the role **unconditionally**, even if the member
also holds it via a self-assign, a second mapping, or a manual grant. No role provenance is tracked.

**Rationale**: This is the standard reaction-role model (react = has role, un-react = has-not) and it
keeps the capability stateless — the mapping table plus the live role membership are the only state,
no "how did this member get this role" ledger. Provenance tracking would add a store this feature
deliberately avoids and a class of reconciliation bugs. The rare cost (un-reacting strips a
separately-obtained role) is recoverable by re-reacting or self-assigning. (Clarification Q1.)

**Alternatives rejected**: provenance-aware removal (only remove if the reaction granted it) —
requires new per-(member, role, source) state; grant-only "sticky" reactions — breaks the toggle
expectation members have.

## 4. Mapping cardinality — one (message, emoji) → one role

**Decision**: `(guild_id, message_id, emoji_key)` is the primary key of the mapping table; it maps
to exactly one role. A role may appear in many mappings (reachable from several emoji/messages), but
a given emoji-on-a-message resolves to a single role. (Clarification Q3.)

**Rationale**: The one-emoji-one-role convention is what members expect and what every mainstream
reaction-role bot does by default. A single-column-set primary key makes the resolution a single
lookup (no fan-out loop), makes operator config unambiguous, and gives the DB the uniqueness
guarantee for free. The reverse direction (a role from multiple mappings) is naturally unconstrained
and needs no special handling.

**Alternatives rejected**: many-roles-per-(message,emoji) — rare, and a member wanting several roles
reacts with several emoji; unconstrained many-to-many — ambiguous config, harder to reason about and
test.

## 5. Reusing the 004 authorization gate for reactions

**Decision**: The reaction path calls the **same** role capability gate as `/role`: role must be on
the guild whitelist AND the bot must be positioned above it AND hold Manage Roles. The reaction only
adds a *mapping-exists* precondition and the *explicit direction* (add on react, remove on un-react)
in front of that gate. Implemented as new explicit entry points (`grantSelfRole` / `revokeSelfRole`)
that share the gate with the existing `toggleSelfRole`, rather than a parallel copy.

**Rationale**: FR-002 requires a reaction to honor the whitelist exactly as the command does, and
FR-005 requires no rewrite of the capability logic. Sharing the gate guarantees the two paths cannot
drift (a role becoming non-whitelisted instantly stops both). `toggleSelfRole` computes direction
from current membership; the reaction path needs *directed* add/remove (the reaction state, not a
toggle, is authoritative), so explicit `grant`/`revoke` entry points over the shared gate is the
right shape.

**Alternatives rejected**: reusing `toggleSelfRole` for reactions — wrong semantics (a repeated
add-reaction event must not toggle a role off); duplicating the gate in the reaction module — risks
divergence, violates FR-005.

## 6. Moderator standing — native per-capability permission

**Decision**: "Moderator" for a cross-member action is the invoker's **native** platform permission
for that capability: Manage Nicknames gates cross-member nickname changes; Manage Roles gates
cross-member role changes. Evaluated per invocation from the invoker's live permissions. No
operator-designated moderator-role store. (Clarification / FR-010.)

**Rationale**: Zero-config, always-current, least-privilege — an admin confers standing by granting
the ordinary Discord permission, the same mechanism that already governs the bot's own guard. It
needs no new table and no curation surface. Because it reads live permissions, revoking standing
takes effect on the very next invocation (spec edge case).

**Alternatives rejected**: operator-designated moderator role (new config + store, deferred value);
either/or (most flexible, most code — over-engineering now).

## 7. Growing `/nick` and `/role` vs. adding new commands

**Decision**: Grow the existing `/nick` and `/role` with an **optional** target-user option rather
than adding `/nick-other` / `/role-other`. With no target (or the invoker as target), the command is
the 004 self-service path unchanged; with a different target, the moderator gate runs.

**Rationale**: Recorded product decision — `/nick` is deliberately the superset of Discord's built-in
(the cross-member case is the piece the built-in can't do), and one command whose capability grows is
the chosen UX. It keeps the surface small and the self path byte-for-byte compatible (SC-007). The
same reasoning applies to `/role` for symmetry.

**Alternatives rejected**: separate cross-member commands (fragments the UX, contradicts the
superset decision); a subcommand form (`/nick set`/`/nick other`) — heavier, no benefit here.

## 8. Cross-member role management is not whitelist-bounded

**Decision**: A moderator granting/removing a role on another member is **not** limited to the
self-assignable whitelist (FR-009); it is bounded only by the bot-position guard. The whitelist
still bounds *self*-service (the 004 path) and *reactions* (FR-002).

**Rationale**: Moderation means managing roles a member could not self-assign — restricting a
moderator to the self-service whitelist would defeat the capability. The safety boundary for
moderation is the invoker's Manage Roles permission plus the bot-position guard, not the whitelist.

**Alternatives rejected**: whitelist-bounded moderation (defeats the purpose); no bot-position guard
(would let the bot attempt roles above itself and error — the guard must still apply).

## 8a. Guarding against privilege escalation via cross-member role grants

**Decision**: In addition to the bot-position guard, the cross-member role grant refuses when the
**target role is at or above the _invoking moderator's_ own highest role** (a moderator may not grant
a role they do not themselves outrank). This mirrors Discord's own hierarchy rule for role
assignment and is checked in the capability alongside the existing bot-position guard.

**Rationale**: Manage Roles permission alone does not let a user assign a role above their own
highest role; enforcing only the bot-position guard would let a moderator hand out a role they could
not assign through the Discord UI, an escalation path. Reading the invoker's highest position (the
adapter already reads the bot's) closes it. This does not apply to the self-service or reaction paths
(those are whitelist-bounded and self-only).

**Alternatives rejected**: bot-position guard only (leaves the escalation open); deferring the
invoker-position check to 006 (it is cheap and belongs with the capability it guards).

## 9. Silent reaction grants; ephemeral moderation replies

**Decision**: A reaction grant/revoke produces **no channel message** (a reaction is not a command
with a reply); a failure is logged, not posted, to avoid channel spam (FR-012). Moderation command
replies are **ephemeral** to the invoking moderator, matching 004.

**Rationale**: Reaction-role UX is silent by convention — members see the role appear, not a bot
reply per reaction. Posting per-reaction feedback would be noise and a spam vector. Moderation
outcomes are private to the actor, consistent with the existing self-service commands.

**Alternatives rejected**: DM-on-reaction-failure (noisy, and DMs are often closed) — logging is the
right diagnosability surface; public moderation replies (leaks moderation activity to the channel).
