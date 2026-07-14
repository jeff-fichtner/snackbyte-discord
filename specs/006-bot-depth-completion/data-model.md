# Phase 1 — Data Model: Bot-Depth Completion

One new table (component→role bindings, configuration). No moderation-records table — that is 008.
No change to existing tables. The 004 `self_assignable_roles` whitelist is reused unchanged as the
authorization for the component and text-prefix role styles.

## New table: `component_role_bindings`

An operator-curated binding: activating a specific message component (a button, or an option of a
select menu) grants a specific self-assignable role. The component style's analogue of the 005
`reaction_role_mappings`. Curated directly in the table editor (like routes / whitelist / reaction
mappings); the app never auto-inserts a row (FR-014).

| Column          | Type          | Notes |
|-----------------|---------------|-------|
| `guild_id`      | `text`        | Discord guild id. Scopes the binding (FR-013). |
| `component_key` | `text`        | The component's stable identity — the `customId` of the button, or `customId` + option value for a select option. The match key the dispatcher looks up. |
| `component_kind`| `text`        | `'button'` or `'select'` — human-readable discriminator; `CHECK (component_kind IN ('button','select'))`. |
| `role_id`       | `text`        | Stable role id to toggle. Not FK'd (external Discord id). |
| `created_at`    | `timestamptz` | Default `now()`. |

**Primary key**: `(guild_id, component_key)` — one component maps to exactly one role (mirrors the
one-emoji-one-role rule from 005). A role may appear in many bindings.

**No foreign keys**: `role_id` / `component_key` are external identifiers. A role deleted or
de-whitelisted after a binding is created is detected at activation time (whitelist intersection fails
or the live role is gone) → clean no-op, not a referential error (FR-018).

**Authorization is the intersection**, exactly as for reactions: a binding grants a role only when the
binding row exists AND `role_id` is on the guild's `self_assignable_roles` whitelist. A binding to a
non-whitelisted role is a no-op; the app never auto-adds to the whitelist (FR-013).

### Migration `0008_component_role_bindings.sql`

```sql
CREATE TABLE IF NOT EXISTS component_role_bindings (
  guild_id       text NOT NULL,
  component_key  text NOT NULL,
  component_kind text NOT NULL CHECK (component_kind IN ('button', 'select')),
  role_id        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, component_key)
);
```

## Repository additions

### Interface (`src/db/repository.ts`)

```ts
export interface ComponentRoleBinding {
  componentKey: string;   // button customId, or select customId+value
  roleId: string;
}

// added to interface Repository:
/** Component→role bindings an operator has configured in this guild (empty when none). */
listComponentRoleBindings(guildId: string): Promise<ComponentRoleBinding[]>;
```

### PostgreSQL implementation (`src/db/pg-repository.ts`)

```ts
async listComponentRoleBindings(guildId: string): Promise<ComponentRoleBinding[]> {
  const { rows } = await this.pool.query(
    `SELECT component_key, role_id FROM component_role_bindings WHERE guild_id = $1`,
    [guildId],
  );
  return rows.map((r) => ({ componentKey: r.component_key, roleId: r.role_id }));
}
```

Read live per activation (no cache) — an operator add/remove governs the next activation with no
restart, the same freshness contract as routes / whitelist / reaction mappings (FR-014).

## Non-persistent state (config, not a table)

- **Text-prefix enablement + prefix** — a process config value (`src/config.ts`), not a row: whether
  the text-prefix style is enabled for this deployment and the prefix it listens for. Drives both the
  `messageCreate` handler and the conditional Message Content intent. Absent/false by default.

## Entities recap (spec → model)

| Spec entity | Model |
|-------------|-------|
| Sanction action | Not persisted — acts on live member/channel state + the platform's audit log & ban list. No table. |
| Component binding | `component_role_bindings` row; PK `(guild_id, component_key)`; the component style's mapping. |
| Text-prefix style configuration | Process config (enablement flag + prefix), not a row. |
| Self-assignable role entry (004) | `self_assignable_roles` — unchanged; the authorization every role style intersects. |
| Moderator / Target | Not stored — evaluated per invocation from live permission/hierarchy state. |

## What is NOT added (the stateless boundary)

- **No moderation-records table** — no infraction history, no warnings, no modlog persistence, no
  temp-ban expiry records (all are 008, gated on the 007 store). FR-021.
- No new secret; no change to `sources`, `routes`, `discord_targets`, `delivery_log`,
  `self_assignable_roles`, or `reaction_role_mappings`.
