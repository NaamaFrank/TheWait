import { query, queryOne, transaction } from './pool.js';

/** Cleared tasks - the ledger XP, streaks and badges are all computed from. */

function toCompletion(row) {
  if (!row) return null;

  return {
    id: row.id,
    accountId: row.account_id,
    deviceId: row.device_id,
    suggestionId: row.suggestion_id,
    category: row.category,
    bucket: row.bucket,
    waitId: row.wait_id,
    xp: row.xp,
    at: row.completed_at
  };
}

export async function allCompletionsFor(accountId) {
  const rows = await query('SELECT * FROM completions WHERE account_id = $1', [accountId]);
  return rows.map(toCompletion);
}

export async function insertCompletion(completion, { keep }) {
  return transaction(async (run) => {
    const [row] = await run(
      `INSERT INTO completions (id, account_id, device_id, suggestion_id, category, bucket, wait_id, xp, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))
       RETURNING *`,
      [
        completion.id,
        completion.accountId,
        completion.deviceId ?? null,
        completion.suggestionId,
        completion.category,
        completion.bucket,
        completion.waitId,
        completion.xp,
        // The domain lets the database stamp it; imports and tests set it.
        completion.at ?? null
      ]
    );

    await run(
      `DELETE FROM completions
       WHERE account_id = $1
         AND id NOT IN (
           SELECT id FROM completions WHERE account_id = $1 ORDER BY completed_at DESC LIMIT $2
         )`,
      [completion.accountId, keep]
    );

    return toCompletion(row);
  });
}

/**
 * XP and cleared-task counts per account since `since`.
 *
 * Aggregated in the database rather than by reading every completion in the
 * system into memory - this one is the leaderboard's whole query, and it runs
 * across all devices rather than just the caller's.
 */
export async function scoresSince(since) {
  const rows = await query(
    `SELECT account_id, SUM(xp)::bigint AS score, COUNT(*)::bigint AS tasks
     FROM completions
     WHERE completed_at >= $1
     GROUP BY account_id`,
    [since]
  );

  return rows.map((row) => ({
    accountId: row.account_id,
    score: row.score,
    tasksCleared: row.tasks
  }));
}

/**
 * When the last task was cleared inside one wait.
 *
 * For a wait nobody ended, this is the best evidence there is of when the
 * person was still actually there.
 */
export async function lastCompletionAt(accountId, waitId) {
  const row = await queryOne(
    `SELECT max(completed_at) AS at FROM completions
     WHERE account_id = $1 AND wait_id = $2`,
    [accountId, waitId]
  );

  return row?.at ?? null;
}
