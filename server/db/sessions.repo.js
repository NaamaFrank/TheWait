import { query, queryOne, transaction } from './pool.js';

/** Logged waits. */

function toSession(row) {
  if (!row) return null;

  return {
    id: row.id,
    accountId: row.account_id,
    deviceId: row.device_id,
    waitId: row.wait_id,
    label: row.label,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cityId: row.city_id,
    createdAt: row.created_at
  };
}

export async function listSessionsFor(accountId, limit) {
  // The count comes back with the row rather than as a second pass: the list
  // is short, and "what did I do in that wait" is the reason to show it.
  const rows = await query(
    `SELECT s.*,
            (SELECT count(*) FROM completions c
             WHERE c.wait_id = s.wait_id AND s.wait_id IS NOT NULL)::int AS tasks_cleared
     FROM sessions s
     WHERE s.account_id = $1
     ORDER BY s.started_at DESC
     LIMIT $2`,
    [accountId, limit]
  );

  return rows.map((row) => ({ ...toSession(row), tasksCleared: row.tasks_cleared ?? 0 }));
}

/** Every session for an account, for the analytics and progress passes. */
export async function allSessionsFor(accountId) {
  const rows = await query('SELECT * FROM sessions WHERE account_id = $1', [accountId]);
  return rows.map(toSession);
}

/**
 * Inserts a wait and trims the device's history to `keep`.
 *
 * Both in one transaction: a crash between them would leave a device permanently
 * over its limit, and the delete has to see the row that was just written.
 */
export async function insertSession(session, { keep }) {
  return transaction(async (run) => {
    const [row] = await run(
      `INSERT INTO sessions (id, account_id, device_id, wait_id, label, duration_seconds, started_at, ended_at, city_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        session.id,
        session.accountId,
        session.deviceId ?? null,
        session.waitId,
        session.label,
        session.durationSeconds,
        session.startedAt,
        session.endedAt,
        session.cityId
      ]
    );

    await run(
      `DELETE FROM sessions
       WHERE account_id = $1
         AND id NOT IN (
           SELECT id FROM sessions WHERE account_id = $1 ORDER BY started_at DESC LIMIT $2
         )`,
      [session.accountId, keep]
    );

    return toSession(row);
  });
}

export async function deleteSession(accountId, sessionId) {
  const row = await queryOne(
    'DELETE FROM sessions WHERE account_id = $1 AND id = $2 RETURNING id',
    [accountId, sessionId]
  );

  return row ? 1 : 0;
}
