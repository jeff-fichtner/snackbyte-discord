/**
 * Applies SQL migrations under migrations/ to the database in DATABASE_URL, in filename
 * order. Each migration runs EXACTLY ONCE: applied filenames are recorded in a
 * schema_migrations table, and already-applied files are skipped on re-run. Each file is
 * applied inside a transaction so a failure leaves no partial migration.
 *
 * (Tracking matters: some migrations are not safe to replay — e.g. one that DROPs and
 * recreates an index against data a later migration already reshaped. "CREATE IF NOT EXISTS"
 * alone is not enough.)
 *
 *   npm run migrate
 */
import './load-env.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL (see .env.example) before running migrations.');
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
});

await client.connect();
try {
  // Ledger of applied migrations (filename = identity). Created once, idempotently.
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`Applying ${file} ...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  console.log(`Done. Applied ${ran} new migration(s); ${files.length - ran} already applied.`);
} finally {
  await client.end();
}
