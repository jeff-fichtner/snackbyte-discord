# Contract: Member-Management Capability Logic

The interaction-style-agnostic logic in `src/bot/members/`. These functions hold the authorization
gate and the role/nickname mechanics; the slash commands (and, later, buttons/reactions in 005) are
adapters that call them. Keeping this separate from any interaction surface is the Principle-I split
made concrete, and is what makes the security boundary unit-testable without a live interaction.

Each function takes the inputs it needs and returns a **structured outcome** (not a reply), so the
caller renders it. Outcomes distinguish: changed (added / removed / set / cleared), and refused (with
a machine-distinguishable reason: `not-whitelisted`, `bot-cannot-manage`, `invalid-input`,
`role-not-found`). No function reads a slash interaction or writes a Discord reply.

## `toggleSelfRole(member, role, whitelistRoleIds)`

- **Inputs**: the invoking `GuildMember`, the chosen `Role`, the set of whitelisted role IDs for the
  member's guild.
- **Gate (evaluated before any mutation, in order)**:
  1. `role.id ∈ whitelistRoleIds` — else refuse `not-whitelisted` (FR-002). No change.
  2. the bot can manage `role`: the bot's highest role is above `role`'s position AND the bot holds
     `ManageRoles` — else refuse `bot-cannot-manage` with a diagnosable reason (FR-007). No change.
- **Action**: if `member.roles.cache.has(role.id)` → `member.roles.remove(role)` (outcome: removed);
  else `member.roles.add(role)` (outcome: added). Idempotent by construction — converges to a single
  has/has-not state (spec "concurrent toggles" edge case).
- **Self-only**: the function only ever receives the invoking member; there is no parameter for
  another member (FR-010).
- **Backstop**: the add/remove is wrapped so a race (role deleted between gate and call) surfaces as a
  `role-not-found` refusal, never a throw to the caller.

## `listSelfAssignableRoles(guild, whitelistRoleIds)`

- **Inputs**: the `Guild` (to resolve IDs to live roles), the whitelisted role IDs.
- **Output**: the list of currently-existing roles whose IDs are whitelisted (name + id for display).
  IDs with no matching live role are omitted (stale/deleted). Empty input or all-stale → an empty
  result the caller renders as "none available" (FR-003).
- **No mutation**; read-only.

## `setOwnNickname(member, value)`

- **Inputs**: the invoking `GuildMember`, and `value`: a string to set, or `undefined`/absent to reset.
- **Gate**:
  1. if `value` is provided: it MUST be ≤ 32 characters and not whitespace-only — else refuse
     `invalid-input` stating the limit (FR-004). No change.
  2. the bot can manage the member's nickname: the member does not outrank the bot AND the bot holds
     `ManageNicknames` — else refuse `bot-cannot-manage` (FR-008). No change.
- **Action**: `member.setNickname(value ?? null)` — a value sets it (outcome: set); `null` clears it
  so the member displays under their account name (outcome: cleared). (FR-004)
- **Self-only**: operates only on the invoking member (FR-010).
- **Backstop**: wrapped so an unexpected API error surfaces as a clean refusal, never a throw.

## Invariants (verifiable by unit test, no live Discord)

- **No bypass of the whitelist**: there is no input to `toggleSelfRole` that adds a role whose id is
  not in `whitelistRoleIds` (SC-002). Test with a non-whitelisted role → `not-whitelisted`, no
  mutation called.
- **Never acts above the bot**: with the bot positioned below the target role/member, every path is a
  `bot-cannot-manage` refusal with zero mutation calls (SC-006).
- **Nickname limit**: a 33-character value and a whitespace-only value both refuse with no mutation
  (SC-004); a 32-character value is accepted.
- **Toggle determinism**: calling toggle on a member who has the role removes it; on one who lacks it
  adds it — exactly one mutation, the expected direction.
- **Self-only is structural**: the functions take a single member and never a second; there is no
  code path that mutates a member other than the one passed in (SC-002).
