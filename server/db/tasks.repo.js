import { query, queryOne } from './pool.js';

/** What the queue remembers: what you turned down, and what you wrote yourself. */

/* --- Skips ---------------------------------------------------------------- */

/**
 * Records that a suggestion was passed over.
 *
 * Counted rather than appended: the queue asks "how often" and "is it
 * blocked", and neither needs a row per press.
 */
export async function recordSkip(accountId, suggestionId) {
  await query(
    `INSERT INTO task_skips (account_id, suggestion_id, skips, last_skipped_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (account_id, suggestion_id) DO UPDATE
       SET skips = task_skips.skips + 1, last_skipped_at = now()`,
    [accountId, suggestionId]
  );
}

/** "Never show me this again" - a decision, not a mood. */
export async function blockSuggestion(accountId, suggestionId, blocked = true) {
  await query(
    `INSERT INTO task_skips (account_id, suggestion_id, skips, blocked)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (account_id, suggestion_id) DO UPDATE SET blocked = $3`,
    [accountId, suggestionId, blocked]
  );
}

export async function readSkips(accountId) {
  const rows = await query(
    'SELECT suggestion_id, skips, blocked FROM task_skips WHERE account_id = $1',
    [accountId]
  );

  return rows.map((row) => ({
    suggestionId: row.suggestion_id,
    skips: row.skips,
    blocked: row.blocked
  }));
}

/* --- Your own tasks ------------------------------------------------------- */

function toTask(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    bucket: row.bucket,
    createdAt: row.created_at
  };
}

export async function listUserTasks(accountId) {
  const rows = await query(
    `SELECT * FROM user_tasks
     WHERE account_id = $1 AND archived_at IS NULL
     ORDER BY created_at`,
    [accountId]
  );

  return rows.map(toTask);
}

export async function addUserTask(accountId, { id, title, bucket }) {
  return toTask(
    await queryOne(
      `INSERT INTO user_tasks (id, account_id, title, bucket)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, accountId, title, bucket]
    )
  );
}

/**
 * Archives rather than deletes.
 *
 * A completion carries the id of what was cleared, and a row that vanishes
 * takes the history pointing at it with it.
 */
export async function archiveUserTask(accountId, id) {
  return toTask(
    await queryOne(
      `UPDATE user_tasks SET archived_at = now()
       WHERE account_id = $1 AND id = $2 AND archived_at IS NULL
       RETURNING *`,
      [accountId, id]
    )
  );
}

export async function countUserTasks(accountId) {
  const row = await queryOne(
    'SELECT count(*)::int AS n FROM user_tasks WHERE account_id = $1 AND archived_at IS NULL',
    [accountId]
  );

  return row?.n ?? 0;
}
