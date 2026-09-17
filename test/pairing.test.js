// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { insertCompletion } from '../server/db/completions.repo.js';
import { insertSession } from '../server/db/sessions.repo.js';
import { ensureDevice, updateDevice } from '../server/domain/devices.js';
import {
  cancelPairingCodes,
  createPairingCode,
  normaliseCode,
  redeemPairingCode
} from '../server/domain/pairing.js';
import { buildProgress } from '../server/domain/progress.js';

/**
 * Linking two devices to one account.
 *
 * A pairing code is a bearer token: whoever has it gets the account. Most of
 * these are about the ways that could go wrong.
 */

const options = { skip: skipWithoutDatabase };

const PHONE = 'aaaaaaaa-1111-4111-8111-111111111111';
const LAPTOP = 'bbbbbbbb-2222-4222-8222-222222222222';
const STRANGER = 'cccccccc-3333-4333-8333-333333333333';

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
});

beforeEach(async () => {
  if (skipWithoutDatabase) return;
  await query('TRUNCATE accounts, devices, sessions, completions, pairing_codes CASCADE');
});

after(async () => {
  if (skipWithoutDatabase) return;
  await endDatabase();
});

test('a device is its own account until it is linked', options, async () => {
  const phone = await ensureDevice(PHONE);
  const laptop = await ensureDevice(LAPTOP);

  assert.notEqual(phone.accountId, laptop.accountId, 'two devices, two people');
  assert.equal(phone.deviceCount, 1);
});

test('linking makes two devices one person', options, async () => {
  await ensureDevice(PHONE);
  await updateDevice(PHONE, { displayName: 'Naama', cityId: 293397 });
  await ensureDevice(LAPTOP);

  const { code } = await createPairingCode(PHONE);
  const result = await redeemPairingCode(LAPTOP, code);

  const phone = await ensureDevice(PHONE);
  assert.equal(result.device.accountId, phone.accountId, 'the same account');
  assert.equal(result.device.displayName, 'Naama', 'and the same profile');
  assert.equal(result.device.city.name, 'Tel Aviv');
  assert.equal(result.device.deviceCount, 2);
});

test('the joining device brings its own history with it', options, async () => {
  const phone = await ensureDevice(PHONE);
  const laptop = await ensureDevice(LAPTOP);

  // Each device earned something before they met.
  for (const account of [phone.accountId, laptop.accountId]) {
    await insertSession(
      {
        id: randomUUID(),
        accountId: account,
        waitId: randomUUID(),
        label: 'Prompt run',
        durationSeconds: 120,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        cityId: 5391959
      },
      { keep: 500 }
    );

    await insertCompletion(
      { id: randomUUID(), accountId: account, suggestionId: 's001', category: 'body', bucket: 'micro', xp: 20 },
      { keep: 2000 }
    );
  }

  const { code } = await createPairingCode(PHONE);
  const result = await redeemPairingCode(LAPTOP, code);

  assert.equal(result.moved.sessions, 1, 'the laptop\'s wait came across');
  assert.equal(result.moved.completions, 1);

  // Nothing was stranded on an account nobody can reach any more.
  const progress = await buildProgress(LAPTOP, { tzOffsetMinutes: 0 });
  assert.equal(progress.score, 40, 'both devices\' XP, on one account');
  assert.equal(progress.tasksCleared, 2);

  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM accounts');
  assert.equal(n, 1, 'the emptied account is gone');
});

test('a code works exactly once', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);
  await ensureDevice(STRANGER);

  const { code } = await createPairingCode(PHONE);
  await redeemPairingCode(LAPTOP, code);

  await assert.rejects(() => redeemPairingCode(STRANGER, code), /expired or has already been used/);
});

test('an expired code is refused', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);

  const { code } = await createPairingCode(PHONE);
  await query("UPDATE pairing_codes SET expires_at = now() - interval '1 minute'");

  await assert.rejects(() => redeemPairingCode(LAPTOP, code), /expired/);
});

test('a made-up code is refused', options, async () => {
  await ensureDevice(LAPTOP);

  await assert.rejects(() => redeemPairingCode(LAPTOP, 'ZZZZ-9999'), /expired or has already been used/);
  await assert.rejects(() => redeemPairingCode(LAPTOP, 'nope'), /eight characters/);
});

test('a device cannot pair with itself', options, async () => {
  await ensureDevice(PHONE);
  const { code } = await createPairingCode(PHONE);

  await assert.rejects(() => redeemPairingCode(PHONE, code), /from this account/);
});

test('only one live code exists at a time', options, async () => {
  await ensureDevice(PHONE);

  const first = await createPairingCode(PHONE);
  const second = await createPairingCode(PHONE);

  // Two valid codes is two chances to intercept one.
  assert.equal(second.code, first.code);
  assert.equal(second.reused, true);

  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM pairing_codes WHERE claimed_at IS NULL');
  assert.equal(n, 1);
});

test('a code can be withdrawn', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);

  const { code } = await createPairingCode(PHONE);
  await cancelPairingCodes(PHONE);

  await assert.rejects(() => redeemPairingCode(LAPTOP, code), /expired or has already been used/);
});

test('claiming a code retires every other one the account had out', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);
  await ensureDevice(STRANGER);

  const { code } = await createPairingCode(PHONE);
  await redeemPairingCode(LAPTOP, code);

  const [{ n }] = await query('SELECT count(*)::bigint AS n FROM pairing_codes WHERE claimed_at IS NULL');
  assert.equal(n, 0, 'nothing left that would let a third device in');
});

test('two devices racing on one code - only one wins', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);
  await ensureDevice(STRANGER);

  const { code } = await createPairingCode(PHONE);

  const results = await Promise.allSettled([
    redeemPairingCode(LAPTOP, code),
    redeemPairingCode(STRANGER, code)
  ]);

  const won = results.filter((result) => result.status === 'fulfilled');
  assert.equal(won.length, 1, 'the guard is on the update, so the loser sees no row');
});

test('codes are read the way people type them', options, async () => {
  assert.equal(normaliseCode('abcd1234'), 'ABCD-1234');
  assert.equal(normaliseCode('ABCD-1234'), 'ABCD-1234');
  assert.equal(normaliseCode('abcd 1234'), 'ABCD-1234');
  assert.equal(normaliseCode('  AbCd-1234  '), 'ABCD-1234');

  // The alphabet leaves these out precisely because they get substituted.
  assert.equal(normaliseCode('OIOI2345'), '0101-2345');

  assert.equal(normaliseCode('short'), null);
  assert.equal(normaliseCode(''), null);
  assert.equal(normaliseCode(null), null);
});

test('a generated code avoids the characters people misread', options, async () => {
  await ensureDevice(PHONE);
  const { code } = await createPairingCode(PHONE);

  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/, code);
  assert.ok(!/[OI01]/.test(code.replace('-', '')), 'no O, I, 0 or 1');
});

test('a profile change reaches every linked device', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);

  const { code } = await createPairingCode(PHONE);
  await redeemPairingCode(LAPTOP, code);

  await updateDevice(LAPTOP, { displayName: 'Naama', status: 'making coffee' });

  const onPhone = await ensureDevice(PHONE);
  assert.equal(onPhone.displayName, 'Naama', 'the phone sees what the laptop set');
  assert.equal(onPhone.status, 'making coffee');
});

test('unlinked devices remain strangers', options, async () => {
  await ensureDevice(PHONE);
  await updateDevice(PHONE, { displayName: 'Naama' });

  const stranger = await ensureDevice(STRANGER);
  assert.notEqual(stranger.displayName, 'Naama');
});

test('an account is only new until something happens to it', options, async () => {
  const { isNew } = await ensureDevice(PHONE);
  assert.equal(isNew, true, 'a device nobody has used');

  // A refresh changes nothing on the server, so the answer must not change.
  assert.equal((await ensureDevice(PHONE)).isNew, true, 'still new after reloading');

  await updateDevice(PHONE, { displayName: 'Naama' });
  assert.equal((await ensureDevice(PHONE)).isNew, false, 'naming yourself counts as using it');
});

test('a linked device is never treated as new', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);
  assert.equal((await ensureDevice(LAPTOP)).isNew, true);

  const { code } = await createPairingCode(PHONE);
  await redeemPairingCode(LAPTOP, code);

  // Otherwise the welcome would offer to link a device that already is linked.
  assert.equal((await ensureDevice(LAPTOP)).isNew, false);
  assert.equal((await ensureDevice(PHONE)).isNew, false, 'and neither is the one it joined');
});

test('an avatar is chosen from the offered set', options, async () => {
  const { avatar } = await ensureDevice(PHONE);
  assert.ok(avatar, 'everyone starts with one');

  const changed = await updateDevice(PHONE, { avatar: '🦄' });
  assert.equal(changed.avatar, '🦄');

  // Nothing arbitrary: this is rendered to every other viewer.
  await assert.rejects(() => updateDevice(PHONE, { avatar: '<img src=x>' }), /offered characters/);
  await assert.rejects(() => updateDevice(PHONE, { avatar: '💣' }), /offered characters/);
});

test('an avatar follows a linked device', options, async () => {
  await ensureDevice(PHONE);
  await ensureDevice(LAPTOP);

  const { code } = await createPairingCode(PHONE);
  await redeemPairingCode(LAPTOP, code);
  await updateDevice(PHONE, { avatar: '🐙' });

  assert.equal((await ensureDevice(LAPTOP)).avatar, '🐙');
});
