import { query, queryOne, transaction } from './pool.js';

/**
 * Accounts, and the devices that reach them.
 *
 * A device is a way in, not an identity. The profile and everything earned live
 * on the account, so linking a second device makes one person rather than two.
 */

function toAccount(row) {
  if (!row) return null;

  return {
    accountId: row.account_id,
    displayName: row.display_name,
    status: row.status,
    cityId: row.city_id,
    locationMode: row.location_mode,
    tint: row.tint,
    avatar: row.avatar,
    visible: row.visible,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

/** The account a device belongs to, or null if the device is unknown. */
export async function findAccountByDevice(deviceId) {
  return toAccount(
    await queryOne(
      `SELECT a.* FROM accounts a
       JOIN devices d ON d.account_id = a.account_id
       WHERE d.device_id = $1`,
      [deviceId]
    )
  );
}

/**
 * Registers a device, creating the account it belongs to.
 *
 * Both rows in one transaction, and both tolerate a repeat: two requests from a
 * cold client arrive together often enough, and neither may produce a duplicate
 * or overwrite a profile that already exists.
 */
export async function createAccountForDevice({ deviceId, account }) {
  return transaction(async (run) => {
    await run(
      `INSERT INTO accounts (account_id, display_name, city_id, location_mode, tint, avatar, visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (account_id) DO NOTHING`,
      [
        account.accountId,
        account.displayName,
        account.cityId,
        account.locationMode,
        account.tint,
        account.avatar,
        account.visible
      ]
    );

    await run(
      `INSERT INTO devices (device_id, account_id, city_id, location_mode, display_name, tint, visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (device_id) DO UPDATE SET last_seen_at = now()`,
      [
        deviceId,
        account.accountId,
        account.cityId,
        account.locationMode,
        account.displayName,
        account.tint,
        account.visible
      ]
    );

    const [row] = await run(
      `SELECT a.* FROM accounts a
       JOIN devices d ON d.account_id = a.account_id
       WHERE d.device_id = $1`,
      [deviceId]
    );

    return toAccount(row);
  });
}

/** Column names are fixed here, never taken from the caller. */
const WRITABLE = {
  avatar: 'avatar',
  cityId: 'city_id',
  locationMode: 'location_mode',
  displayName: 'display_name',
  status: 'status',
  tint: 'tint',
  visible: 'visible'
};

export async function updateAccount(accountId, patch) {
  const columns = [];
  const values = [accountId];

  for (const [key, column] of Object.entries(WRITABLE)) {
    if (!(key in patch)) continue;
    values.push(patch[key]);
    columns.push(`${column} = $${values.length}`);
  }

  columns.push('last_seen_at = now()');

  return toAccount(
    await queryOne(`UPDATE accounts SET ${columns.join(', ')} WHERE account_id = $1 RETURNING *`, values)
  );
}

export async function touchAccount(accountId) {
  await query('UPDATE accounts SET last_seen_at = now() WHERE account_id = $1', [accountId]);
}

/** Only the accounts named, for the leaderboard's second pass. */
export async function findAccounts(accountIds) {
  if (!accountIds.length) return [];

  const rows = await query('SELECT * FROM accounts WHERE account_id = ANY($1::uuid[])', [accountIds]);
  return rows.map(toAccount);
}

/**
 * Whether this account has never been used.
 *
 * Asked so a brand-new device can be offered the chance to link. It has to be
 * a question about the *account*, not about local storage: a refresh clears
 * nothing on the server, and an account that already has a device paired to it,
 * a wait behind it or a name of its own is plainly not new.
 */
export async function isUntouchedAccount(accountId) {
  const row = await queryOne(
    `SELECT
       (SELECT count(*) FROM devices d WHERE d.account_id = $1) AS devices,
       (SELECT count(*) FROM sessions s WHERE s.account_id = $1) AS sessions,
       (SELECT count(*) FROM completions c WHERE c.account_id = $1) AS completions,
       (SELECT display_name FROM accounts a WHERE a.account_id = $1) AS display_name`,
    [accountId]
  );

  if (!row) return false;

  return (
    Number(row.devices) <= 1 &&
    Number(row.sessions) === 0 &&
    Number(row.completions) === 0 &&
    // A name that was never changed still looks like the one it was given.
    /^anon_[0-9a-f]{6}$/.test(row.display_name ?? '')
  );
}

/** How many devices reach this account. */
export async function countDevices(accountId) {
  const row = await queryOne('SELECT count(*)::bigint AS n FROM devices WHERE account_id = $1', [accountId]);
  return row?.n ?? 0;
}
