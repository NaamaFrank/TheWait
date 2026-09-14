import { queryOne, transaction } from './pool.js';

/** The wait in progress, at most one per account. */

function toWait(row) {
  if (!row) return null;

  return {
    waitId: row.wait_id,
    startedAt: row.started_at,
    accumulatedMs: row.accumulated_ms,
    resumedAt: row.resumed_at,
    lastSeenAt: row.last_seen_at
  };
}

export async function findActiveWait(accountId) {
  return toWait(await queryOne('SELECT * FROM active_waits WHERE account_id = $1', [accountId]));
}

/**
 * Records that a device is looking right now.
 *
 * Deliberately separate from reading the wait. The gap since the last visit is
 * the only evidence that nobody was there, so whether to erase it is a
 * decision for the caller, not a side effect of looking.
 */
export async function markSeen(accountId) {
  return queryOne(
    'UPDATE active_waits SET last_seen_at = now() WHERE account_id = $1 RETURNING account_id',
    [accountId]
  );
}

/**
 * Starts a wait, replacing any that was already running.
 *
 * Replacing rather than refusing: two devices can both press start, and the
 * second one winning is less surprising than an error nobody asked for.
 */
export async function startWait(accountId, waitId) {
  return toWait(
    await queryOne(
      `INSERT INTO active_waits (account_id, wait_id, started_at, accumulated_ms, resumed_at, last_seen_at)
       VALUES ($1, $2, now(), 0, now(), now())
       ON CONFLICT (account_id) DO UPDATE
         SET wait_id = $2, started_at = now(), accumulated_ms = 0, resumed_at = now(),
             updated_at = now(), last_seen_at = now()
       RETURNING *`,
      [accountId, waitId]
    )
  );
}

/**
 * Banks the running segment and stops the clock.
 *
 * The arithmetic happens in the database, from its own clock, so a device with
 * a wrong system time cannot bank the wrong amount.
 */
export async function pauseWait(accountId) {
  return toWait(
    await queryOne(
      `UPDATE active_waits
       SET accumulated_ms = accumulated_ms + GREATEST(0, EXTRACT(EPOCH FROM (now() - resumed_at)) * 1000)::integer,
           resumed_at = NULL,
           updated_at = now()
       WHERE account_id = $1 AND resumed_at IS NOT NULL
       RETURNING *`,
      [accountId]
    )
  );
}

export async function resumeWait(accountId) {
  return toWait(
    await queryOne(
      `UPDATE active_waits SET resumed_at = now(), updated_at = now(), last_seen_at = now()
       WHERE account_id = $1 AND resumed_at IS NULL
       RETURNING *`,
      [accountId]
    )
  );
}

/**
 * Ends the wait and reports how long it ran, clearing it in the same
 * transaction so two devices cannot both log the same wait.
 */
export async function endWait(accountId, { endAt = null } = {}) {
  return transaction(async (run) => {
    /*
     * `endAt` rewinds the running segment to a moment that has already passed,
     * for a wait nobody was there to end. It can only ever shorten the wait:
     * GREATEST(0, ...) drops a moment before the clock last started, and the
     * live segment is capped at what has actually elapsed, so a bad or
     * far-future value cannot invent time that was never counted.
     */
    const [row] = await run(
      `DELETE FROM active_waits WHERE account_id = $1
       RETURNING wait_id, started_at,
         accumulated_ms + CASE WHEN resumed_at IS NULL THEN 0
           ELSE LEAST(
             GREATEST(0, EXTRACT(EPOCH FROM (COALESCE($2::timestamptz, now()) - resumed_at)) * 1000)::integer,
             GREATEST(0, EXTRACT(EPOCH FROM (now() - resumed_at)) * 1000)::integer
           ) END AS total_ms`,
      [accountId, endAt]
    );

    if (!row) return null;

    return {
      waitId: row.wait_id,
      startedAt: row.started_at,
      durationSeconds: Math.max(1, Math.round(Number(row.total_ms) / 1000))
    };
  });
}
