import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from './pool.js';

/**
 * Schema migration.
 *
 * Each step runs once, in order, inside a transaction, and is recorded. Adding
 * a column later means appending a step - never editing an old one, because a
 * deployed database has already run it.
 *
 * Taking a lock around the whole thing means several app instances starting at
 * the same moment cannot race to create the same table, which is the normal
 * case on a rolling deploy.
 */

const dbDir = path.dirname(fileURLToPath(import.meta.url));

/** Arbitrary but fixed: the lock key this app uses while migrating. */
const LOCK_KEY = 8_147_231;

const steps = [
  {
    name: '001-initial-schema',
    sql: () => fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8')
  },
  {
    name: '002-accounts',
    sql: () => fs.readFileSync(path.join(dbDir, '002-accounts.sql'), 'utf8')
  },
  {
    name: '003-active-waits',
    sql: () => fs.readFileSync(path.join(dbDir, '003-active-waits.sql'), 'utf8')
  },
  {
    name: '004-avatars',
    sql: () => fs.readFileSync(path.join(dbDir, '004-avatars.sql'), 'utf8')
  },
  {
    name: '005-chosen-avatars',
    sql: () => fs.readFileSync(path.join(dbDir, '005-chosen-avatars.sql'), 'utf8')
  },
  {
    name: '006-wait-last-seen',
    sql: () => fs.readFileSync(path.join(dbDir, '006-wait-last-seen.sql'), 'utf8')
  },
  {
    name: '007-task-memory',
    sql: () => fs.readFileSync(path.join(dbDir, '007-task-memory.sql'), 'utf8')
  },
  {
    name: '008-task-memory-shown',
    sql: () => fs.readFileSync(path.join(dbDir, '008-task-memory-shown.sql'), 'utf8')
  },
  {
    name: '009-agent-tokens',
    sql: () => fs.readFileSync(path.join(dbDir, '009-agent-tokens.sql'), 'utf8')
  }
];

export async function migrate({ log = true } = {}) {
  const applied = await transaction(async (run) => {
    await run('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);

    await run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const done = new Set((await run('SELECT name FROM schema_migrations')).map((row) => row.name));
    const ran = [];

    for (const step of steps) {
      if (done.has(step.name)) continue;

      await run(step.sql());
      await run('INSERT INTO schema_migrations (name) VALUES ($1)', [step.name]);
      ran.push(step.name);
    }

    return ran;
  });

  if (log && applied.length) {
    console.log(`[the-wait] applied ${applied.length} migration(s): ${applied.join(', ')}`);
  }

  return applied;
}
