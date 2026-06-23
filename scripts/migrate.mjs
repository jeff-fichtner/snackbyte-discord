/**
 * Applies SQL migrations under migrations/ to the database in DATABASE_URL, in order.
 * Idempotent: each migration uses CREATE ... IF NOT EXISTS / ON CONFLICT, so re-running
 * is safe. For local/dev and one-shot setup; a real migration tracker can come later.
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
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`Applying ${file} ...`);
    await client.query(sql);
  }
  console.log(`Applied ${files.length} migration(s).`);
} finally {
  await client.end();
}
