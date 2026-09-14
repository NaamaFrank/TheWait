// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import {
  endDatabase,
  query,
  resetDatabase,
  skipWithoutDatabase
} from './helpers/database.mjs';
import {
  countDevices,
  createAccountForDevice,
  findAccountByDevice,
  findAccounts,
  updateAccount
} from '../server/db/accounts.repo.js';
import { insertCompletion, scoresSince } from '../server/db/completions.repo.js';
import { allSessionsFor, deleteSession, insertSession, listSessionsFor } from '../server/db/sessions.repo.js';

/**
 * The storage layer, against a real Postgres.
 *
 * These replace the old JSON-file tests and check the same guarantees the file
 * store used to make - round trips, per-device limits, concurrent writes - plus
 * the ones only a database can offer: constraints and referential integrity.
 */

const options = { skip: skipWithoutDatabase };

const DEVICE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** Accounts created per test, so rows can be attached to them. */
const accountFor = new Map();

async function makeAccount(deviceId = DEVICE) {
  const account = await createAccountForDevice({
    deviceId,
    account: {
      accountId: randomUUID(),
      cityId: 5391959,
      locationMode: 'manual',
      displayName: `anon_${deviceId.slice(0, 6)}`,
      tint: '#FFC53D',
      avatar: '🦊',
      visible: true
    }
  });

  accountFor.set(deviceId, account.accountId);
  return account;
}

const idOf = (deviceId) => accountFor.get(deviceId);

function sessionRow(deviceId = DEVICE, overrides = {}) {
  const startedAt = overrides.startedAt ?? new Date().toISOString();

  return {
    id: randomUUID(),
    accountId: idOf(deviceId),
    deviceId,
    waitId: randomUUID(),
    label: 'Prompt run',
    durationSeconds: 120,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 120_000).toISOString(),
    cityId: 5391959,
    ...overrides
  };
}

function completionRow(deviceId = DEVICE, overrides = {}) {
  return {
    id: randomUUID(),
    accountId: idOf(deviceId),
    deviceId,
    suggestionId: 's001',
    category: 'body',
    bucket: 'micro',
    waitId: null,
    xp: 20,
    ...overrides
  };
}

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
});

beforeEach(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
  accountFor.clear();
});

after(async () => {
  if (skipWithoutDatabase) return;
  await endDatabase();
});

test('an account round-trips', options, async () => {
  const created = await makeAccount();

  assert.ok(created.accountId, 'an account was made for it');
  assert.equal(created.visible, true);
  assert.equal(created.status, null);
  // Timestamps come back as ISO strings, not Dates, so the API stays stable.
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const read = await findAccountByDevice(DEVICE);
  assert.deepEqual(read, created);
});

test('registering the same device twice does not duplicate or overwrite', options, async () => {
  await makeAccount();
  await updateAccount(idOf(DEVICE), { displayName: 'Naama' });

  // A second cold-start request must not reset the profile.
  const again = await makeAccount();
  assert.equal(again.displayName, 'Naama');

  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM devices');
  assert.equal(n, 1);
  assert.equal(await countDevices(idOf(DEVICE)), 1);
});

test('an update touches only the fields it is given', options, async () => {
  await makeAccount();
  await updateAccount(idOf(DEVICE), { displayName: 'Naama', status: 'making coffee' });

  const afterTint = await updateAccount(idOf(DEVICE), { tint: '#3DDC84' });
  assert.equal(afterTint.displayName, 'Naama', 'the name survived a tint change');
  assert.equal(afterTint.status, 'making coffee');

  // Null is a value, not an omission: it clears the status.
  const cleared = await updateAccount(idOf(DEVICE), { status: null });
  assert.equal(cleared.status, null);
  assert.equal(cleared.displayName, 'Naama');
});

test('a session round-trips and is listed newest first', options, async () => {
  await makeAccount();

  const older = sessionRow(DEVICE, { startedAt: new Date(Date.now() - 60 * 60_000).toISOString() });
  const newer = sessionRow(DEVICE, { startedAt: new Date().toISOString() });

  await insertSession(older, { keep: 500 });
  await insertSession(newer, { keep: 500 });

  const listed = await listSessionsFor(idOf(DEVICE), 10);
  assert.deepEqual(listed.map((session) => session.id), [newer.id, older.id]);
  assert.equal(listed[0].waitId, newer.waitId);
});

test('the per-device limit trims only that device', options, async () => {
  await makeAccount();
  await makeAccount(OTHER);

  for (let i = 0; i < 5; i += 1) {
    await insertSession(sessionRow(DEVICE, { startedAt: new Date(Date.now() + i * 1000).toISOString() }), { keep: 3 });
  }
  await insertSession(sessionRow(OTHER), { keep: 3 });

  assert.equal((await allSessionsFor(idOf(DEVICE))).length, 3, 'trimmed to the limit');
  assert.equal((await allSessionsFor(idOf(OTHER))).length, 1, 'the other device is untouched');
});

test('concurrent writes are all persisted', options, async () => {
  await makeAccount();

  // The file store serialised these through a promise queue; a database does
  // not need to, but the guarantee has to hold either way.
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      insertSession(sessionRow(DEVICE, { startedAt: new Date(Date.now() + i * 1000).toISOString() }), { keep: 500 })
    )
  );

  assert.equal((await allSessionsFor(idOf(DEVICE))).length, 20);
});

test('deleting reports how many went, and only touches your own', options, async () => {
  await makeAccount();
  await makeAccount(OTHER);

  const mine = sessionRow(DEVICE);
  await insertSession(mine, { keep: 500 });

  assert.equal(await deleteSession(idOf(OTHER), mine.id), 0, 'another device cannot delete it');
  assert.equal(await deleteSession(idOf(DEVICE), mine.id), 1);
  assert.equal(await deleteSession(idOf(DEVICE), mine.id), 0, 'and it is gone');
});

test('scores are summed in the database, per device', options, async () => {
  await makeAccount();
  await makeAccount(OTHER);

  for (const xp of [20, 25, 40]) await insertCompletion(completionRow(DEVICE, { xp }), { keep: 2000 });
  await insertCompletion(completionRow(OTHER, { xp: 30 }), { keep: 2000 });

  const scores = await scoresSince(new Date(Date.now() - 60_000).toISOString());
  const mine = scores.find((row) => row.accountId === idOf(DEVICE));

  assert.equal(mine.score, 85, 'summed');
  assert.equal(mine.tasksCleared, 3, 'and counted');
  // Numbers, not the strings a bigint parses to by default.
  assert.equal(typeof mine.score, 'number');
});

test('scores outside the window are excluded', options, async () => {
  await makeAccount();
  await insertCompletion(completionRow(DEVICE, { xp: 20 }), { keep: 2000 });

  const future = await scoresSince(new Date(Date.now() + 60_000).toISOString());
  assert.deepEqual(future, []);
});

test('rows cannot outlive the account they belong to', options, async () => {
  await makeAccount();
  await insertSession(sessionRow(DEVICE), { keep: 500 });
  await insertCompletion(completionRow(DEVICE), { keep: 2000 });

  await query('DELETE FROM accounts WHERE account_id = $1', [idOf(DEVICE)]);

  assert.equal((await allSessionsFor(idOf(DEVICE))).length, 0, 'sessions went with it');
  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM completions');
  assert.equal(n, 0, 'and so did completions');
});

test('a session for an unknown account is refused', options, async () => {
  await assert.rejects(
    () => insertSession({ ...sessionRow(DEVICE), accountId: randomUUID(), deviceId: null }, { keep: 500 }),
    /foreign key/i
  );
});

test('the schema rejects nonsense', options, async () => {
  await makeAccount();

  await assert.rejects(
    () => insertSession(sessionRow(DEVICE, { durationSeconds: -5 }), { keep: 500 }),
    /check constraint/i,
    'a negative wait'
  );

  await assert.rejects(
    () => insertCompletion(completionRow(DEVICE, { xp: -1 }), { keep: 2000 }),
    /check constraint/i,
    'negative XP'
  );

  await assert.rejects(
    () => updateAccount(idOf(DEVICE), { locationMode: 'telepathy' }),
    /check constraint/i,
    'an invented location mode'
  );
});

test('only the accounts asked for are read back', options, async () => {
  await makeAccount();
  await makeAccount(OTHER);

  const found = await findAccounts([idOf(DEVICE)]);
  assert.deepEqual(found.map((account) => account.accountId), [idOf(DEVICE)]);

  assert.deepEqual(await findAccounts([]), [], 'and an empty ask costs no query');
});
