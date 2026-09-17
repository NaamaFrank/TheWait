import pg from 'pg';
import { config } from '../config.js';

/**
 * The Postgres connection pool.
 *
 * One pool for the process, created lazily so importing a domain module in a
 * test does not open sockets. Everything goes through `query` or `transaction`;
 * nothing else in the app knows what a client is.
 */

/*
 * `timestamptz` comes back as a JavaScript Date by default, which then gets
 * serialised by whatever locale the process happens to have. The app speaks ISO
 * strings everywhere, so keep them as the strings Postgres already sends.
 */
const TIMESTAMPTZ_OID = 1184;
pg.types.setTypeParser(TIMESTAMPTZ_OID, (value) => new Date(value).toISOString());

/*
 * `bigint` (the type COUNT and SUM return) is parsed to a string by default,
 * because it can exceed Number.MAX_SAFE_INTEGER. Nothing here counts that high,
 * and a string would silently break every arithmetic comparison.
 */
const BIGINT_OID = 20;
pg.types.setTypeParser(BIGINT_OID, (value) => Number(value));

let pool = null;

export function getPool() {
  if (pool) return pool;

  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. The Wait needs a Postgres database - see the README for a one-line local one.'
    );
  }

  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Managed providers terminate unencrypted connections; local ones have no
    // certificate to verify. Both are covered by asking for TLS without
    // demanding a chain we cannot check from here.
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
  });

  // A pool error is emitted on idle clients, and is fatal if unhandled.
  pool.on('error', (error) => {
    console.error('[the-wait] idle database client error:', error.message);
  });

  return pool;
}

/** Runs one statement. Parameters are always bound, never interpolated. */
export async function query(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

/** Runs one statement and returns the first row, or null. */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/**
 * Runs `work` inside a transaction on a single client, rolling back if it
 * throws. `work` is handed a `query` of the same shape as the module-level one.
 */
export async function transaction(work) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await work((text, params = []) => client.query(text, params).then((r) => r.rows));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Closes the pool. Used when a process or a test is finished with it. */
export async function closePool() {
  if (!pool) return;

  const closing = pool;
  pool = null;
  await closing.end();
}
