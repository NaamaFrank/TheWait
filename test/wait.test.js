// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { ensureDevice } from '../server/domain/devices.js';
import { createPairingCode, redeemPairingCode } from '../server/domain/pairing.js';
import { randomUUID } from 'node:crypto';
import {
  beginWait,
  continueWait,
  finishWait,
  getWait,
  holdWait,
  resolveStaleWait
} from '../server/domain/wait.js';
import { accountIdFor } from '../server/domain/devices.js';

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

/* --- Waits nobody was there to end --------------------------------------- */

/**
 * The clock does not care whether anyone is watching, so a laptop closed
 * mid-wait kept counting - real sessions of five and six hours, which dragged
 * every average and every record on the Stats screen with them.
 *
 * Nothing is ended automatically: a long wait can be genuine. The person is
 * asked, and the offer is always a moment that has already passed, so saying
 * yes can only ever shorten the wait.
 */

/** Rewinds the open wait, as if it had been running unattended. */
async function leaveRunning({ forMinutes, unwatchedMinutes }) {
  await query(
    `UPDATE active_waits
       SET started_at = now() - make_interval(mins => $1),
           resumed_at = now() - make_interval(mins => $1),
           last_seen_at = now() - make_interval(mins => $2)`,
    [forMinutes, unwatchedMinutes]
  );
}

test('a wait nobody watched is offered back, not banked in full', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 360, unwatchedMinutes: 354 });

  const wait = await getWait(PHONE);

  assert.ok(wait.stale, 'six hours with nobody there is not a wait');
  assert.equal(wait.stale.basis, 'last-seen');
  // Six hours on the clock, six minutes of anyone actually being there.
  assert.ok(wait.elapsedSeconds > 21_000, 'the clock really did run that long');
  assert.ok(wait.stale.suggestedElapsedSeconds < 400, 'the offer is the six minutes');
});

test('the last cleared task is better evidence than the last look', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 360, unwatchedMinutes: 354 });

  const accountId = await accountIdFor(PHONE);
  const [open] = await query('SELECT wait_id, resumed_at FROM active_waits WHERE account_id = $1', [accountId]);

  await query(
    `INSERT INTO completions (id, account_id, suggestion_id, category, bucket, wait_id, xp, completed_at)
     VALUES ($1, $2, 's001', 'body', 'micro', $3, 20, $4::timestamptz + interval '20 minutes')`,
    [randomUUID(), accountId, open.wait_id, open.resumed_at]
  );

  const wait = await getWait(PHONE);

  assert.equal(wait.stale.basis, 'last-task', 'someone was demonstrably there at that point');
  assert.ok(Math.abs(wait.stale.suggestedElapsedSeconds - 1200) < 30, 'twenty minutes, give or take');
});

test('accepting the offer logs the short wait, not the long one', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 360, unwatchedMinutes: 354 });

  // The screen reads the wait before it can show the question.
  const seen = await getWait(PHONE);
  assert.ok(seen.stale);

  const { session } = await resolveStaleWait(PHONE, { keep: false });

  assert.ok(session, 'it is still banked, just honestly');
  assert.ok(session.durationSeconds < 400, `logged ${session.durationSeconds}s, expected about 360`);
  assert.equal((await getWait(PHONE)).phase, 'idle');
});

test('reading the wait does not erase the gap that proves nobody was there', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 360, unwatchedMinutes: 354 });

  // Polling is what the screen does; it must not talk itself out of asking.
  for (let i = 0; i < 3; i += 1) assert.ok((await getWait(PHONE)).stale, `still stale on read ${i + 1}`);

  const { session } = await resolveStaleWait(PHONE, { keep: false });
  assert.ok(session.durationSeconds < 400, 'and the offer is still the short one');
});

test('saying it is still running keeps the wait and stops the asking', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 360, unwatchedMinutes: 354 });
  assert.ok((await getWait(PHONE)).stale);

  const kept = await resolveStaleWait(PHONE, { keep: true });

  assert.equal(kept.session, null, 'nothing was banked');
  assert.equal(kept.wait.phase, 'running');
  assert.equal((await getWait(PHONE)).stale, null, 'and it does not nag');
});

test('a long wait somebody is watching is left alone', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 40, unwatchedMinutes: 0 });

  assert.equal((await getWait(PHONE)).stale, null, 'forty minutes at the screen is a real wait');
});

test('a paused wait is never stale - it is not accruing anything', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await holdWait(PHONE);
  await query("UPDATE active_waits SET last_seen_at = now() - interval '6 hours'");

  assert.equal((await getWait(PHONE)).stale, null);
});

test('ending normally is unaffected by any of this', options, async () => {
  await ensureDevice(PHONE);
  await beginWait(PHONE);
  await leaveRunning({ forMinutes: 12, unwatchedMinutes: 0 });

  const { session } = await finishWait(PHONE);
  assert.ok(session.durationSeconds > 700, 'the full twelve minutes, as always');
});
