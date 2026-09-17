/**
 * Test database.
 *
 * Tests run against a real Postgres, not a stub: the queries are the thing most
 * worth checking, and a fake would only prove the fake works. `npm run db:up`
 * starts one locally.
 *
 * When no database is configured the suites that need one skip with a visible
 * reason rather than passing silently.
 */
import { assertDisposable } from './env.mjs';
import { closePool, query } from '../../server/db/pool.js';
import { migrate } from '../../server/db/migrate.js';

export const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;

export const skipWithoutDatabase = databaseUrl
  ? false
  : 'needs a database: run `npm run db:up`, then set DATABASE_URL';

let prepared = false;

/** Applies the schema once per process, then empties every table. */
export async function resetDatabase() {
  if (!prepared) {
    assertDisposable(databaseUrl);
    await migrate({ log: false });
    prepared = true;
  }

  await query('TRUNCATE devices, sessions, completions CASCADE');
}

export async function endDatabase() {
  await closePool();
}

export { query };
