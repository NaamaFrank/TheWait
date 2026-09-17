import { query, queryOne, transaction } from './pool.js';

/**
 * Pairing codes.
 *
 * A code is a bearer token for an account, so it is short-lived, single-use,
 * and rate-limited. It is never written to a log or returned to anyone but the
 * device that asked for it.
 */

export async function insertCode({ code, accountId, expiresAt }) {
  const row = await queryOne(
    `INSERT INTO pairing_codes (code, account_id, expires_at)
     VALUES ($1, $2, $3)
     RETURNING code, expires_at`,
    [code, accountId, expiresAt]
  );

  return { code: row.code, expiresAt: row.expires_at };
}

/** Any live code this account has already issued, so it is not asked twice. */
export async function findLiveCode(accountId) {
  const row = await queryOne(
    `SELECT code, expires_at FROM pairing_codes
     WHERE account_id = $1 AND claimed_at IS NULL AND expires_at > now()
     ORDER BY expires_at DESC LIMIT 1`,
    [accountId]
  );

  return row ? { code: row.code, expiresAt: row.expires_at } : null;
}

/** Retires every live code for an account - used after one is claimed. */
export async function revokeCodes(accountId) {
  await query(
    'UPDATE pairing_codes SET claimed_at = now() WHERE account_id = $1 AND claimed_at IS NULL',
    [accountId]
  );
}

/**
 * Claims a code, moving the device onto that account and taking its history
 * with it.
 *
 * The claim is an UPDATE guarded on both `claimed_at IS NULL` and the expiry,
 * so two devices racing on the same code cannot both win - the second sees no
 * row. Everything after it happens in the same transaction, so a failure part
 * way through cannot leave a half-merged account.
 */
export async function claimCode({ code, deviceId, currentAccountId }) {
  return transaction(async (run) => {
    const [claimed] = await run(
      `UPDATE pairing_codes SET claimed_at = now()
       WHERE code = $1 AND claimed_at IS NULL AND expires_at > now()
       RETURNING account_id`,
      [code]
    );

    if (!claimed) {
      // Record the miss, so guessing can be noticed and slowed down.
      await run('UPDATE pairing_codes SET attempts = attempts + 1 WHERE code = $1', [code]);
      return { ok: false, reason: 'invalid' };
    }

    const target = claimed.account_id;

    if (target === currentAccountId) return { ok: false, reason: 'same-account' };

    // Anything this device already recorded joins the account it is linking to,
    // rather than being stranded on an account nobody can reach again.
    const [{ count: movedSessions }] = await run(
      'WITH moved AS (UPDATE sessions SET account_id = $1 WHERE account_id = $2 RETURNING 1) SELECT count(*)::bigint AS count FROM moved',
      [target, currentAccountId]
    );

    const [{ count: movedCompletions }] = await run(
      'WITH moved AS (UPDATE completions SET account_id = $1 WHERE account_id = $2 RETURNING 1) SELECT count(*)::bigint AS count FROM moved',
      [target, currentAccountId]
    );

    await run('UPDATE devices SET account_id = $1 WHERE device_id = $2', [target, deviceId]);

    // The account this device came from is now unreachable and empty.
    const [{ n: remaining }] = await run(
      'SELECT count(*)::bigint AS n FROM devices WHERE account_id = $1',
      [currentAccountId]
    );

    if (Number(remaining) === 0) {
      await run('DELETE FROM accounts WHERE account_id = $1', [currentAccountId]);
    }

    return { ok: true, accountId: target, movedSessions, movedCompletions };
  });
}

/** Housekeeping: codes that can no longer be used serve no purpose. */
export async function purgeExpiredCodes() {
  const rows = await query(
    "DELETE FROM pairing_codes WHERE expires_at < now() - interval '1 day' RETURNING code"
  );

  return rows.length;
}
