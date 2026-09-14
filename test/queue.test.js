// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { ensureDevice } from '../server/domain/devices.js';
import { recordCompletion } from '../server/domain/progress.js';
import {
  blockSuggestionFor,
  buildQueue,
  createUserTask,
  getUserTasks,
  removeUserTask,
  sizeFor,
  skipSuggestion
} from '../server/domain/queue.js';

/**
 * What to offer next.
 *
 * The catalogue used to be the whole story: a random shuffle of items written
 * for a stranger, with no memory of what you had turned down and no room for
 * anything you wanted to do yourself.
 */

const options = { skip: skipWithoutDatabase };
const DEVICE = '11111111-1111-4111-8111-111111111111';

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
});

beforeEach(async () => {
  if (skipWithoutDatabase) return;
  await query('TRUNCATE accounts, devices, sessions, completions, pairing_codes, active_waits, task_skips, user_tasks CASCADE');
  await ensureDevice(DEVICE);
});

after(async () => {
  if (skipWithoutDatabase) return;
  await endDatabase();
});

/** Whether `id` turns up at all across a good many draws. */
async function offeredWithin(id, draws = 40) {
  for (let i = 0; i < draws; i += 1) {
    const { items } = await buildQueue(DEVICE, { seconds: 30, count: 6 });
    if (items.some((item) => item.id === id)) return true;
  }

  return false;
}

/* --- Skips ---------------------------------------------------------------- */

test('a suggestion turned down often enough stops being offered', options, async () => {
  const { items } = await buildQueue(DEVICE, { seconds: 30, count: 1 });
  const passed = items[0].id;

  assert.equal(await offeredWithin(passed), true, 'it is in the pool to begin with');

  for (let i = 0; i < 3; i += 1) await skipSuggestion(DEVICE, passed);

  assert.equal(await offeredWithin(passed), false, 'three passes is enough');
});

test('one skip is not a verdict', options, async () => {
  const { items } = await buildQueue(DEVICE, { seconds: 30, count: 1 });
  const passed = items[0].id;

  await skipSuggestion(DEVICE, passed);

  // Not in the mood today is a different thing from never again.
  assert.equal(await offeredWithin(passed), true);
});

test('never again means never again', options, async () => {
  const { items } = await buildQueue(DEVICE, { seconds: 30, count: 1 });
  const banned = items[0].id;

  await blockSuggestionFor(DEVICE, banned);

  assert.equal(await offeredWithin(banned), false);
});

/* --- What you are up for -------------------------------------------------- */

test('asking for one kind of thing gets that kind of thing', options, async () => {
  const { items } = await buildQueue(DEVICE, { seconds: 120, count: 4, category: 'body' });

  assert.ok(items.length);
  assert.deepEqual([...new Set(items.map((item) => item.category))], ['body']);
});

/* --- Your own ------------------------------------------------------------- */

test('your own tasks are offered first, at the size you gave them', options, async () => {
  const { task } = await createUserTask(DEVICE, { title: 'Water the plants', bucket: 'short' });

  const fits = await buildQueue(DEVICE, { seconds: 120, count: 3 });
  assert.equal(fits.items[0].id, task.id, 'you already decided this one was worth doing');
  assert.equal(fits.items[0].mine, true);

  const tooShort = await buildQueue(DEVICE, { seconds: 20, count: 3 });
  assert.equal(tooShort.items.some((item) => item.mine), false, 'not in a twenty second gap');
});

test('your own task scores what any task of that size scores', options, async () => {
  const { task } = await createUserTask(DEVICE, { title: 'Book the dentist', bucket: 'short' });
  const { items } = await buildQueue(DEVICE, { seconds: 120, count: 1 });

  assert.equal(items[0].xp, 25, 'the short bucket, same as the catalogue pays');

  // It used to be rejected outright: the catalogue was the only place a task
  // could come from, so clearing your own was a 400.
  const progress = await recordCompletion(DEVICE, { suggestionId: task.id }, { tzOffsetMinutes: 0 });
  assert.equal(progress.score, 25);
  assert.equal(progress.tasksCleared, 1);
});

test('a task needs a title and a real size', options, async () => {
  await assert.rejects(() => createUserTask(DEVICE, { title: '   ', bucket: 'short' }), /needs a title/);
  await assert.rejects(() => createUserTask(DEVICE, { title: 'Fine', bucket: 'enormous' }), /size of wait/);
});

test('removing one takes it out of the queue but leaves the history', options, async () => {
  const { task } = await createUserTask(DEVICE, { title: 'Water the plants', bucket: 'short' });
  await recordCompletion(DEVICE, { suggestionId: task.id }, { tzOffsetMinutes: 0 });

  await removeUserTask(DEVICE, task.id);

  assert.equal((await getUserTasks(DEVICE)).tasks.length, 0);

  const [{ n }] = await query('SELECT count(*)::int AS n FROM completions');
  assert.equal(n, 1, 'what you did still happened');

  await assert.rejects(() => removeUserTask(DEVICE, task.id), /No such task/);
});

/* --- How big it dares go -------------------------------------------------- */

/**
 * The app cannot know how long *this* wait will be, so it never bets on it.
 * Offering a twenty minute task eight minutes in is a bet, and a lost one if
 * the answer lands a minute later. Your own median is an observed fact, and it
 * is what caps the size.
 */
test('the size never exceeds what your waits usually run to', options, () => {
  const shortWaits = [90, 120, 150, 100, 180].map((durationSeconds) => ({ durationSeconds }));

  assert.equal(sizeFor(30, shortWaits).id, 'micro');
  assert.equal(sizeFor(200, shortWaits).id, 'short');
  // Half an hour into a wait, from someone whose waits are two minutes long.
  assert.equal(sizeFor(2000, shortWaits).id, 'short', 'capped, however long this one drags on');
});

test('someone who really does wait a long time gets the long ones', options, () => {
  const longWaits = [600, 900, 1200, 800, 1100].map((durationSeconds) => ({ durationSeconds }));

  assert.equal(sizeFor(2000, longWaits).id, 'long');
  assert.equal(sizeFor(30, longWaits).id, 'micro', 'and still starts small');
});

test('a forgotten timer does not talk it into longer tasks', options, () => {
  // Four short waits and one laptop left open overnight.
  const withAbandoned = [90, 120, 150, 100, 6 * 3600].map((durationSeconds) => ({ durationSeconds }));

  assert.equal(sizeFor(2000, withAbandoned).id, 'short');
});

test('a brand new account is not second-guessed', options, () => {
  assert.equal(sizeFor(2000, []).id, 'long', 'nothing to go on, so the catalogue decides');
  assert.equal(sizeFor(2000, [{ durationSeconds: 60 }]).id, 'long', 'one wait is not a pattern');
});
