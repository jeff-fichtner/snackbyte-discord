/**
 * PostgreSQL connection pool, constructed from config. One pool per process, shared by
 * the repository. SSL is enabled for hosted databases (e.g. Supabase) via the URL.
 */
import { Pool } from 'pg';

/** Create a pg Pool for the given connection string. */
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    // Hosted Postgres (Supabase) requires TLS; allow the managed cert chain.
    ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });
}
