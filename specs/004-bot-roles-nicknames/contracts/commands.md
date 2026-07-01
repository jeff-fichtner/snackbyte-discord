# Contract: Self-Service Slash Commands

The three member-facing slash commands. Each follows the existing command pattern (a
`SlashCommandBuilder` definition + an `execute` that defers ephemerally, calls a capability function,
and edits in the outcome). All replies are **ephemeral** (FR-009). Each command is a thin adapter
onto a `src/bot/members/` capability (FR-011) — the command parses the interaction and renders the
outcome; the capability holds the authorization gate and the role/nickname mechanics.

All three self-register in `src/bot/commands/index.ts` and dispatch through the existing
`interactionCreate` listener (which already contains a throwing command — FR-013 backstop). They are
pushed to Discord via the existing `deploy-commands` script (guild-scoped in dev, global in prod).

## `/role` — toggle a self-assignable role on yourself

- **Option**: `role` (a required Discord **role** option — the native role picker; shows role names,
  not pre-filtered to assignable roles).
- **Behavior**: calls `toggleSelfRole(invokingMember, chosenRole, whitelist)`:
  - chosen role not in the guild whitelist → refuse: "That role isn't self-assignable." (FR-002)
  - bot can't manage the role (at/above the bot's highest role, or missing `ManageRoles`) → refuse
    with a diagnosable reason; no change. (FR-007)
  - else toggle: member has it → remove and confirm removal; member lacks it → add and confirm. (FR-001)
- **Reply**: ephemeral confirmation or refusal. Acts only on the invoking member — no target option
  exists (FR-010).

## `/roles` — list the roles you can self-assign

- **Options**: none.
- **Behavior**: calls `listSelfAssignableRoles(guild, whitelist)` → resolves the guild's whitelisted
  role IDs to current role names; replies with that set. Empty whitelist → "No roles are currently
  self-assignable." (FR-003)
- **Reply**: ephemeral. Reflects the live whitelist, so an operator edit shows up on the next call
  (FR-005). A whitelisted id with no matching live role is simply omitted (stale entry; the role was
  deleted).

## `/nick` — set or reset your own nickname

- **Option**: `nickname` (an **optional** string). Provided → set; omitted → reset (clear).
- **Behavior**: calls `setOwnNickname(invokingMember, value | undefined)`:
  - value over 32 characters, or only whitespace → refuse with a message stating the limit; no change.
    (FR-004)
  - bot can't manage the member's nickname (member outranks the bot, or missing `ManageNicknames`) →
    refuse with a diagnosable reason; no change. (FR-008)
  - value provided and valid → set nickname and confirm; omitted → clear nickname (display reverts to
    the account name) and confirm. (FR-004)
- **Reply**: ephemeral. Acts only on the invoking member (FR-010).

## Cross-command invariants (verifiable)

- **Ephemeral**: every reply uses the ephemeral flag — never broadcast to the channel (FR-009).
- **Self-only**: none of the three exposes a target-member option; the capability operates on the
  interaction's own member (FR-010). There is no input that changes another member.
- **No new intent**: the commands need only the already-present `Guilds`+`GuildMembers` intents and
  the `ManageRoles`/`ManageNicknames` *permissions*; no Message Content (FR-012).
- **Failure-contained**: an unexpected throw is caught by the existing `interactionCreate` handler →
  generic ephemeral error; expected refusals return specific messages from the capability (FR-013).
- **Webhook pipeline untouched**: these commands never call the routing/delivery path (FR-015).
