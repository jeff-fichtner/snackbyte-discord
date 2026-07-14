// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool } from '../../src/db/client.js';
import { PgRepository } from '../../src/db/pg-repository.js';
import type { Pool } from 'pg';

// DB-integration test for the component-binding read against REAL Postgres. Runs only when
// DATABASE_URL is set; otherwise self-skips so the offline check:all stays green. Uses synthetic,
// clearly-named test guild ids and cleans up every row it inserts (safe against a shared database).

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_GUILD = 'test-guild-006-component-db';
const OTHER_GUILD = 'test-guild-006-component-db-other';

describe.skipIf(!DATABASE_URL)('listComponentRoleBindings — against real Postgres', () => {
  let pool: Pool;
  let repo: PgRepository;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    repo = new PgRepository(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS component_role_bindings (
        guild_id       text NOT NULL,
        component_key  text NOT NULL,
        component_kind text NOT NULL CHECK (component_kind IN ('button', 'select')),
        role_id        text NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (guild_id, component_key)
      )`);
    await pool.query('DELETE FROM component_role_bindings WHERE guild_id = ANY($1)', [
      [TEST_GUILD, OTHER_GUILD],
    ]);
    await pool.query(
      `INSERT INTO component_role_bindings (guild_id, component_key, component_kind, role_id)
       VALUES
         ($1, 'role:announcements', 'button', 'role-announce'),
         ($1, 'menu:roles::events', 'select', 'role-events'),
         ($2, 'role:games', 'button', 'role-games')`,
      [TEST_GUILD, OTHER_GUILD],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM component_role_bindings WHERE guild_id = ANY($1)', [
      [TEST_GUILD, OTHER_GUILD],
    ]);
    await pool.end();
  });

  it('returns the guild bindings mapped to the domain shape', async () => {
    const bindings = await repo.listComponentRoleBindings(TEST_GUILD);
    expect(bindings).toHaveLength(2);
    const byRole = Object.fromEntries(bindings.map((b) => [b.roleId, b]));
    expect(byRole['role-announce']).toEqual({
      componentKey: 'role:announcements',
      roleId: 'role-announce',
    });
    expect(byRole['role-events']).toEqual({
      componentKey: 'menu:roles::events',
      roleId: 'role-events',
    });
  });

  it("scopes to the guild — another guild's binding is not returned", async () => {
    const bindings = await repo.listComponentRoleBindings(TEST_GUILD);
    expect(bindings.some((b) => b.roleId === 'role-games')).toBe(false);
    const other = await repo.listComponentRoleBindings(OTHER_GUILD);
    expect(other.map((b) => b.roleId)).toEqual(['role-games']);
  });

  it('returns an empty array for a guild with no bindings', async () => {
    expect(await repo.listComponentRoleBindings('guild-with-no-bindings-xyz')).toEqual([]);
  });
});
