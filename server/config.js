import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '127.0.0.1',
  rootDir: path.resolve(serverDir, '..'),
  publicDir: path.resolve(serverDir, '..', 'public'),

  /** Committed reference data: the region catalogue and the suggestions. */
  dataDir: path.resolve(serverDir, '..', 'data'),

  /**
   * The Postgres database. Required - there is no local file fallback, so what
   * runs in development is what runs in production.
   */
  databaseUrl: process.env.DATABASE_URL ?? null,

  /**
   * Managed providers require TLS; a local container has no certificate. On by
   * default for anything that is not plainly localhost.
   */
  databaseSsl:
    process.env.DATABASE_SSL === 'true' ||
    (process.env.DATABASE_SSL !== 'false' &&
      !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.DATABASE_URL ?? '')),

  /** Connections per instance. Several instances share the database's limit. */
  dbPoolSize: Number(process.env.DB_POOL_SIZE) || 10,

  /** Max accepted JSON request body. */
  // Large enough for a 200KB photo once base64 has inflated it by a third.
  maxBodyBytes: 512 * 1024,

  /** A presence heartbeat is considered live for this long. */
  presenceTtlMs: 90 * 1000,

  /** Upper bound on a single logged wait, guards against clock skew / bad clients. */
  maxSessionSeconds: 6 * 60 * 60,

  /** Sessions retained per device. */
  maxSessionsPerDevice: 500,

  /** Completed suggestions retained per device. */
  maxCompletionsPerDevice: 2000,

  /** How many rows the leaderboard returns. */
  leaderboardSize: 8
};
