# Quickstart: Self-Service Roles & Nicknames

Validates that members can self-assign whitelisted roles, list them, and manage their own nickname —
all gated by the operator whitelist and the bot-position guard. References the
[commands contract](./contracts/commands.md), [capability contract](./contracts/role-capability.md),
and [data-model](./data-model.md) rather than repeating them.

## Prerequisites

- The hub running with `DATABASE_URL` and `DISCORD_BOT_TOKEN`, the bot **online in the test guild**.
- The bot's role positioned **above** the roles it will manage, and granted **Manage Roles** and
  **Manage Nicknames** permissions in the server (the operational precondition; a missing one is
  surfaced by the bot-position guard as a clean refusal, not a crash).
- Migration `0006` applied (`npm run migrate`).
- The new commands registered with Discord: `npm run deploy:commands` (guild-scoped instant in dev).
- Table-editor access to add rows to `self_assignable_roles`.

## Automated checks (run first)

```bash
npm run check:all          # format + lint + typecheck + test — must be green
npm test -- member         # the feature's unit tests (roles + nickname capabilities)
```

Expected: the capability unit tests prove the whole authorization gate without a live Discord — toggle
add/remove, non-whitelisted refusal, bot-position-guard refusal, self-only (no other-member path),
deleted-role handling, empty-list, and nickname set/reset/over-limit/whitespace.

## Manual end-to-end validation

### 1. Operator curates the whitelist (US4)

In the table editor, add a `self_assignable_roles` row: `guild_id = <test guild id>`,
`role_id = <a non-elevated role the bot's role is above>`. (Add a second row for a different role to
test the list.)

### 2. A member self-assigns and toggles (US1 / SC-001)

As a non-admin member, run `/role` and pick the whitelisted role.

**Expected**: the bot adds the role and confirms ephemerally; running `/role` again for the same role
removes it (toggle). The reply is visible only to that member (FR-009).

### 3. The whitelist boundary holds (US1 / SC-002)

Run `/role` and pick a role that is NOT in `self_assignable_roles` (e.g. an admin role).

**Expected**: refused — "that role isn't self-assignable" — with no change to the member's roles.
There is no pick that grants a non-whitelisted role.

### 4. List assignable roles (US2 / SC-003)

Run `/roles`.

**Expected**: exactly the roles currently in the guild's whitelist, by name, ephemerally. Remove a
row in the table editor and run `/roles` again → it's gone, no redeploy (SC-005). With the whitelist
empty → "no roles are currently self-assignable."

### 5. Nicknames (US3 / SC-004)

Run `/nick` with a valid name → display name changes. Run `/nick` with a 33+ character value →
refused, stating the limit, no change. Run `/nick` with no value → nickname cleared (reverts to
account name).

### 6. The bot-position guard (US1/US3 / SC-006)

Temporarily move the bot's role **below** a whitelisted role (or remove Manage Roles), then run
`/role` for that role.

**Expected**: a safe refusal with a diagnosable reason ("I can't manage that role — it's above
mine"), no change, no crash. Restore the bot's position afterward. (Same shape for `/nick` on a
member who outranks the bot.)

### 7. Self-only + no regression (SC-002 / SC-007)

Confirm none of the commands offer a way to target another member (no target option exists). Confirm
the webhook → routing → delivery pipeline still works (trigger a routed event as in 001/002/003) —
this feature does not touch it.

## Success signals (map to spec Success Criteria)

- **SC-001/SC-005**: self-assign/remove via one command; whitelist edited as data, no redeploy.
- **SC-002**: no input grants a non-whitelisted role or changes another member.
- **SC-003**: `/roles` matches the operator's whitelist exactly.
- **SC-004**: nickname set/reset works; over-limit refused 100%.
- **SC-006**: above-the-bot role/nickname is always a safe refusal, never a crash/partial change.
- **SC-007**: webhook routing/delivery unchanged (the existing suite stays green).
