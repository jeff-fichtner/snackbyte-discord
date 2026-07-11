// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool } from '../../src/db/client.js';
import { PgRepository } from '../../src/db/pg-repository.js';
import type { Pool } from 'pg';

// DB-integration test for the reaction-role mapping read against REAL Postgres. It only runs when
// DATABASE_URL is set; otherwise it self-skips so the offline `check:all` stays green (the pure
// resolver tests still cover the logic). It uses a synthetic, clearly-named test guild id and
// cleans up every row it inserts, so it is safe against a shared database.

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_GUILD = 'test-guild-005-reaction-db';
const OTHER_GUILD = 'test-guild-005-reaction-db-other';

describe.skipIf(!DATABASE_URL)('listReactionRoleMappings — against real Postgres', () => {
  let pool: Pool;
  let repo: PgRepository;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    repo = new PgRepository(pool);
    // Ensure the table exists (idempotent; migration 0007 creates the same shape in prod).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reaction_role_mappings (
        guild_id   text NOT NULL,
        message_id text NOT NULL,
        emoji_key  text NOT NULL,
        emoji_kind text NOT NULL CHECK (emoji_kind IN ('unicode', 'custom')),
        role_id    text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (guild_id, message_id, emoji_key)
      )`);
    // Clean any residue from a prior aborted run.
    await pool.query('DELETE FROM reaction_role_mappings WHERE guild_id = ANY($1)', [
      [TEST_GUILD, OTHER_GUILD],
    ]);
    // Seed: two mappings in the test guild, one in another guild (to prove scoping).
    await pool.query(
      `INSERT INTO reaction_role_mappings (guild_id, message_id, emoji_key, emoji_kind, role_id)
       VALUES
         ($1, 'msg-1', '🔔', 'unicode', 'role-announce'),
         ($1, 'msg-1', '123456789012345678', 'custom', 'role-party'),
         ($2, 'msg-9', '🎮', 'unicode', 'role-games')`,
      [TEST_GUILD, OTHER_GUILD],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM reaction_role_mappings WHERE guild_id = ANY($1)', [
      [TEST_GUILD, OTHER_GUILD],
    ]);
    await pool.end();
  });

  it('returns the mappings for the guild, mapped to the domain shape', async () => {
    const mappings = await repo.listReactionRoleMappings(TEST_GUILD);
    expect(mappings).toHaveLength(2);
    const byRole = Object.fromEntries(mappings.map((m) => [m.roleId, m]));
    expect(byRole['role-announce']).toEqual({
      messageId: 'msg-1',
      emojiKey: '🔔',
      roleId: 'role-announce',
    });
    expect(byRole['role-party']).toEqual({
      messageId: 'msg-1',
      emojiKey: '123456789012345678',
      roleId: 'role-party',
    });
  });

  it("scopes to the guild — another guild's mapping is not returned", async () => {
    const mappings = await repo.listReactionRoleMappings(TEST_GUILD);
    expect(mappings.some((m) => m.roleId === 'role-games')).toBe(false);
    const other = await repo.listReactionRoleMappings(OTHER_GUILD);
    expect(other.map((m) => m.roleId)).toEqual(['role-games']);
  });

  it('returns an empty array for a guild with no mappings', async () => {
    const mappings = await repo.listReactionRoleMappings('guild-with-no-mappings-xyz');
    expect(mappings).toEqual([]);
  });
});
