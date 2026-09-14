// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { ensureDevice } from '../server/domain/devices.js';
import { createPairingCode, redeemPairingCode } from '../server/domain/pairing.js';
import { beginWait, continueWait, finishWait, getWait, holdWait } from '../server/domain/wait.js';

/**
 * The wait in progress.
 *
 * It used to live in each browser's localStorage, so a wait running on a phone
 * showed as paused on the laptop signed in to the same account. It belongs to
 * the account now, and these are about the two devices agreeing.
 */

const options = { skip: skipWithoutDatabase };

const PHONE = 'aaaaaaaa-1111-4111-8111-111111111111';
const LAPTOP = 'bbbbbbbb-2222-4222-8222-222222222222';

/** Two devices on one account, as a paired pair would be. */
async function linkedPair() {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);

  const { code } = await createPairingCode(PHONE);
  await redeemPairingCode(LAPTOP, code);
}

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
});

beforeEach(async () => {
  if (skipWithoutDatabase) return;
  await query('TRUNCATE accounts, devices, sessions, completions, pairing_codes, active_waits CASCADE');
});

after(async () => {
  if (skipWithoutDatabase) return;
  await endDatabase();
});

test('a device with no wait is idle', options, async () => {
  await ensureDevice(PHONE);

  const wait = await getWait(PHONE);
  assert.equal(wait.phase, 'idle');
  assert.equal(wait.elapsedSeconds, 0);
  assert.equal(wait.waitId, null);
});

test('a wait started on one device is running on the other', options, async () => {
  await linkedPair();

  const started = await beginWait(LAPTOP);
  const onPhone = await getWait(PHONE);

  assert.equal(onPhone.phase, 'running', 'the phone sees the desktop\'s wait');
  assert.equal(onPhone.waitId, started.waitId, 'and it is the same wait');
});

test('pausing on one device holds the clock on both', options, async () => {
  await linkedPair();
  await beginWait(LAPTOP);

  await holdWait(PHONE);

  assert.equal((await getWait(LAPTOP)).phase, 'paused');
  assert.equal((await getWait(PHONE)).phase, 'paused');
});

test('resuming on one device runs it on both', options, async () => {
  await linkedPair();
  await beginWait(PHONE);
  await holdWait(PHONE);

  await continueWait(LAPTOP);

  assert.equal((await getWait(PHONE)).phase, 'running');
  assert.equal((await getWait(LAPTOP)).phase, 'running');
});

test('pausing twice is not an error', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);

  await holdWait(PHONE);
  const again = await holdWait(PHONE);

  // Two devices can both press pause; the second is agreement, not a fault.
  assert.equal(again.phase, 'paused');
});

test('ending banks one session, and only one', options, async () => {
  await linkedPair();
  await beginWait(PHONE);

  const ended = await finishWait(LAPTOP);
  assert.ok(ended.session, 'the wait was logged');
  assert.equal(ended.wait.phase, 'idle');

  // The other device pressing end finds nothing left to bank.
  const second = await finishWait(PHONE);
  assert.equal(second.session, null);

  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM sessions');
  assert.equal(n, 1, 'one wait, one row');
});

test('the logged session carries the wait it came from', options, async () => {
  await ensureDevice(PHONE);
  const started = await beginWait(PHONE);
  const ended = await finishWait(PHONE);

  assert.equal(ended.session.waitId, started.waitId, 'so cleared tasks attach to it');
  assert.ok(ended.session.durationSeconds >= 1);
});

test('starting again replaces whatever was running', options, async () => {
  await linkedPair();
  const first = await beginWait(PHONE);
  const second = await beginWait(LAPTOP);

  assert.notEqual(second.waitId, first.waitId);

  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM active_waits');
  assert.equal(n, 1, 'one account, one wait');
});

test('an unlinked device keeps its own wait', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);

  await beginWait(PHONE);

  assert.equal((await getWait(LAPTOP)).phase, 'idle', 'strangers do not share a clock');
});

test('the clock is measured by the server, not the caller', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);

  // Bank a known amount by rewriting what the row says was already counted.
  await query("UPDATE active_waits SET accumulated_ms = 90000, resumed_at = now() - interval '5 seconds'");

  const wait = await getWait(PHONE);
  assert.ok(wait.elapsedSeconds >= 95 && wait.elapsedSeconds <= 96, `got ${wait.elapsedSeconds}`);
});
