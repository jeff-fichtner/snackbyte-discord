# Phase 1 — Data Model: Reaction-Roles & Moderation

One new table. No change to existing tables. The 004 `self_assignable_roles` whitelist is read
unchanged as the authorization for reaction-granted roles.

## New table: `reaction_role_mappings`

An operator-curated binding: reacting with a specific emoji on a specific message in a specific guild
grants a specific role. Curated directly in the table editor (like `routes` and
`self_assignable_roles`); the app never auto-inserts a row (FR-003).

| Column        | Type          | Notes |
|---------------|---------------|-------|
| `guild_id`    | `text`        | Discord guild (server) id. Scopes the mapping (FR-004). |
| `message_id`  | `text`        | Discord message id the reaction is on. |
| `emoji_key`   | `text`        | **Stable emoji identity**: the custom emoji's numeric id, or the unicode codepoint string for a standard emoji. The match key (`emoji.id ?? emoji.name`). |
| `emoji_kind`  | `text`        | `'unicode'` or `'custom'` — a human-readable discriminator so an operator can read the row unambiguously; not used in the match (the key already disambiguates). `CHECK (emoji_kind IN ('unicode','custom'))`. |
| `role_id`     | `text`        | Stable role id to grant/revoke. Not FK'd (external Discord id). |
| `created_at`  | `timestamptz` | Default `now()`. |

**Primary key**: `(guild_id, message_id, emoji_key)` — enforces one-emoji-on-a-message → one role
(Clarification Q3). A role may appear in multiple rows (reachable from several emoji/messages); that
is unconstrained.

**No foreign keys**: `role_id`, `message_id`, `guild_id` are external Discord identifiers, not rows
in this database — exactly as `self_assignable_roles` does. A role deleted (or de-whitelisted) after
a mapping is created is detected at reaction time (the whitelist intersection fails, or the live role
is gone), producing a clean no-op, not a referential error (spec edge cases, FR-005).

**Authorization is the intersection, not the row**: a mapping row does **not** by itself authorize a
grant. At reaction time the resolver requires BOTH (a) a matching mapping row AND (b) `role_id`
present in that guild's `self_assignable_roles` whitelist. A mapping to a non-whitelisted role is a
no-op and the system never auto-adds the role to the whitelist (FR-002).

### Migration `0007_reaction_role_mappings.sql`

```sql
CREATE TABLE IF NOT EXISTS reaction_role_mappings (
  guild_id   text NOT NULL,
  message_id text NOT NULL,
  emoji_key  text NOT NULL,
  emoji_kind text NOT NULL CHECK (emoji_kind IN ('unicode', 'custom')),
  role_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, message_id, emoji_key)
);

-- Reactions are resolved by (guild, message, emoji); the primary key already indexes that lookup.
-- A secondary index on (guild_id, message_id) speeds "all mappings on this message" if ever needed,
-- but the per-reaction path uses the full PK, so no extra index is added now.
```

## Repository additions

### Interface (`src/db/repository.ts`)

```ts
/** A reaction-role mapping row (operator-curated). */
export interface ReactionRoleMapping {
  messageId: string;
  emojiKey: string;   // custom emoji id, or unicode codepoint string
  roleId: string;
}

// added to interface Repository:
/** Reaction-role mappings an operator has configured in this guild (empty when none). */
listReactionRoleMappings(guildId: string): Promise<ReactionRoleMapping[]>;
```

### PostgreSQL implementation (`src/db/pg-repository.ts`)

```ts
async listReactionRoleMappings(guildId: string): Promise<ReactionRoleMapping[]> {
  const { rows } = await this.pool.query(
    `SELECT message_id, emoji_key, role_id FROM reaction_role_mappings WHERE guild_id = $1`,
    [guildId],
  );
  return rows.map((r) => ({ messageId: r.message_id, emojiKey: r.emoji_key, roleId: r.role_id }));
}
```

Read live per reaction (no cache), so an operator add/remove governs the next reaction with no
restart (FR-003) — the same freshness contract as routes and the whitelist.

## Entities recap (spec → model)

| Spec entity | Model |
|-------------|-------|
| Reaction-role mapping | `reaction_role_mappings` row; PK `(guild_id, message_id, emoji_key)`; emoji stored by stable identity. |
| Self-assignable role entry (from 004) | `self_assignable_roles` — **unchanged**; read as the authorization the mapping must intersect. |
| Moderator | Not stored — evaluated per invocation from the invoker's live native permission (FR-010). |
| Target member | Not stored — acted on in live guild state. |

## What is NOT added

- No provenance/ledger table (reaction is source of truth, unconditional removal — Clarification Q1).
- No moderator-role table (native permission — FR-010).
- No change to `sources`, `routes`, `discord_targets`, `delivery_log`, or `self_assignable_roles`.
