# Phase 1 Data Model: Self-Service Roles & Nicknames

This feature adds **one new table** (the per-guild whitelist) and **one repository method** to read
it. No existing table changes. Members and their roles/nicknames are live Discord state, not stored.

## `self_assignable_roles` (NEW — migration `0006`)

The operator-curated whitelist. The presence of a row authorizes self-assignment of that role in
that guild; absence means not self-assignable. This is the entire authorization surface for FR-002.

| Column       | Type        | Notes |
|--------------|-------------|-------|
| `guild_id`   | text        | The server the entry applies to (per-guild scope, FR-014). |
| `role_id`    | text        | Stable role identifier (rename-proof; the role-picker decision relies on IDs). |
| `created_at` | timestamptz | Audit of when it was made self-assignable. |

- **Primary key / uniqueness**: `UNIQUE (guild_id, role_id)` — a role is whitelisted at most once per
  guild; makes operator edits idempotent and prevents duplicate entries.
- **Index**: the unique `(guild_id, role_id)` covers the hot read (list a guild's assignable roles);
  no separate index needed.
- **No foreign keys**: `guild_id`/`role_id` are Discord identifiers, not rows in this DB (the same
  way `discord_targets.guild_id`/`channel_id` are external ids). A whitelisted role that no longer
  exists in the guild is detected at command time (absent from the live guild), not by a DB FK.
- **Operator curation**: rows are added/removed directly in the table editor (FR-005, FR-006 — the
  system never auto-inserts). Read live per command, so an add/remove governs the next request.

### Validation rules

- A row's `role_id` is just an identifier — the system does not validate at write time that the role
  exists or is non-elevated (operators own that choice; the bot-position guard prevents escalation at
  use time, per the spec's elevated-role edge case).
- `guild_id` and `role_id` are both required (a partial row is meaningless); the unique constraint
  plus NOT NULL columns enforce a well-formed entry.

## Repository method (NEW)

Added to the existing `Repository` interface (and its Pg implementation), behind which all DB access
already flows:

- **`listSelfAssignableRoles(guildId: string): Promise<string[]>`** — returns the set of whitelisted
  `role_id`s for the guild (empty array when none). A parameterized `SELECT role_id FROM
  self_assignable_roles WHERE guild_id = $1`. This single read backs both the toggle authorization
  check (is the chosen role's id in the set?) and the list command (FR-003).

No other repository change. Membership/role/nickname state is read from the live discord.js
`GuildMember`, not the DB.

## Entities not stored by this feature

- **Server member**: the actor and subject; the bot acts on the live `GuildMember` (its current roles
  and nickname). Nothing about the member is persisted here.
- **Role**: a live Discord role; this feature stores only its identifier in a whitelist row, never a
  copy of its name/position (those are read live, so a rename or reposition is always current).
- **Operator**: not a stored entity; the existing operator-facing data surface (table editor) is the
  curation mechanism. No new auth/identity is introduced.

## What does NOT change (explicit, to bound implementation)

- No change to `routes`, `discord_targets`, `delivery_log`, `sources`, or any existing index.
- No change to the `DeliveryService`, the routing engine, or the inbound webhook path (FR-015).
- The migration is additive (a new table); it runs once via the existing `schema_migrations` ledger.
