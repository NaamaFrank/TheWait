// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { endDatabase, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { insertCompletion } from '../server/db/completions.repo.js';
import { ensureDevice } from '../server/domain/devices.js';
import { insertSession } from '../server/db/sessions.repo.js';
import { buildProgress, recordCompletion } from '../server/domain/progress.js';
import { buildLeaderboard } from '../server/domain/leaderboard.js';

const options = { skip: skipWithoutDatabase };

/**
 * Every device referenced here needs an account before its rows can exist.
 * `ensureDevice` is the same call the API makes on first contact.
 */
const ACCOUNTS = new Map();

async function ensureRow(deviceId) {
  if (ACCOUNTS.has(deviceId)) return ACCOUNTS.get(deviceId);

  const device = await ensureDevice(deviceId);
  ACCOUNTS.set(deviceId, device.accountId);
  return device.accountId;
}

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
});

after(async () => {
  if (skipWithoutDatabase) return;
  await endDatabase();
});

const DEVICE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything runs at UTC so `tzOffsetMinutes: 0` makes local time predictable. */
const UTC = { tzOffsetMinutes: 0 };

function dayAgo(days, hour = 12) {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

/** Writes a completion directly, so a test can place it on a past day. */
async function seedCompletion({ deviceId = DEVICE, at, xp = 20, category = 'body', waitId = null }) {
  const accountId = await ensureRow(deviceId);
  await insertCompletion(
    {
      id: randomUUID(),
      accountId,
      deviceId,
      suggestionId: 's001',
      category,
      bucket: 'micro',
      waitId,
      xp,
      // Placed on a specific day, which is the whole point of these tests.
      at: at.toISOString()
    },
    { keep: 5000 }
  );
}

async function seedSession({ deviceId = DEVICE, startedAt, durationSeconds, waitId = null }) {
  const accountId = await ensureRow(deviceId);
  await insertSession(
    {
      id: randomUUID(),
      accountId,
      deviceId,
      waitId,
      label: 'Prompt run',
      durationSeconds,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + durationSeconds * 1000).toISOString(),
      cityId: 5391959
    },
    { keep: 5000 }
  );
}

test('a completion is scored from the catalogue, not from the request', options, async () => {
  await ensureRow(DEVICE);
  const progress = await recordCompletion(DEVICE, { suggestionId: 's001', xp: 9999 }, UTC);

  // s001 is a micro-bucket task, which the catalogue prices at 20.
  assert.equal(progress.score, 20);
  assert.equal(progress.tasksCleared, 1);
});

test('an unknown suggestion is rejected', options, async () => {
  await assert.rejects(() => recordCompletion(DEVICE, { suggestionId: 'nope' }, UTC), /suggestionId/);
});

test('the streak counts back over consecutive days and stops at a gap', options, async () => {
  const device = '55555555-5555-4555-8555-555555555555';

  // Today, yesterday, the day before - then a missing day, then one more.
  for (const days of [0, 1, 2, 4]) await seedCompletion({ deviceId: device, at: dayAgo(days) });

  const progress = await buildProgress(device, UTC);

  assert.equal(progress.streakDays, 3, 'the day-4 completion is on the far side of a gap');
  assert.equal(progress.week.filter((day) => day.done).length, 4);
  assert.equal(progress.week.at(-1).isToday, true, 'the strip ends on today');
});

test('a streak survives not having cleared anything yet today', options, async () => {
  const device = '66666666-6666-4666-8666-666666666666';
  for (const days of [1, 2, 3]) await seedCompletion({ deviceId: device, at: dayAgo(days) });

  const progress = await buildProgress(device, UTC);
  assert.equal(progress.streakDays, 3, 'the day is not over yet');
});

test('waits are attributed to the tasks cleared during them', options, async () => {
  const device = '77777777-7777-4777-8777-777777777777';
  const start = dayAgo(0, 10);
  const waitId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  // One wait with two tasks cleared inside it, and one wait with none.
  await seedSession({ deviceId: device, startedAt: start, durationSeconds: 600, waitId });
  await seedCompletion({ deviceId: device, at: new Date(start.getTime() + 60_000), category: 'body', waitId });
  await seedCompletion({ deviceId: device, at: new Date(start.getTime() + 120_000), category: 'learn', waitId });

  await seedSession({
    deviceId: device,
    startedAt: dayAgo(0, 14),
    durationSeconds: 600,
    waitId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  });

  const progress = await buildProgress(device, UTC);

  assert.equal(progress.waitsToday, 2);
  assert.equal(progress.putToWorkPercent, 50, 'one of the two waits was used');
  assert.equal(progress.reclaimedTodaySeconds, 600, 'only the used wait counts as reclaimed');

  // 600s split across two tasks, against 1200s of total window time.
  const byId = Object.fromEntries(progress.mix.map((slice) => [slice.id, slice.percent]));
  assert.equal(byId.body, 25);
  assert.equal(byId.learn, 25);
  assert.equal(byId.idle, 50);
});

test('the mix always accounts for the whole window', options, async () => {
  const device = '88888888-8888-4888-8888-888888888888';
  const start = dayAgo(0, 9);
  const waitId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  await seedSession({ deviceId: device, startedAt: start, durationSeconds: 600, waitId });
  for (const [index, category] of ['body', 'learn', 'tidy', 'craft', 'play', 'reset'].entries()) {
    await seedCompletion({
      deviceId: device,
      at: new Date(start.getTime() + (index + 1) * 10_000),
      category,
      waitId
    });
  }

  const { mix } = await buildProgress(device, UTC);
  const total = mix.reduce((sum, slice) => sum + slice.percent, 0);

  assert.ok(mix.length <= 6, 'categories beyond the top few are collapsed into one row');
  assert.ok(Math.abs(total - 100) <= mix.length, `slices should cover the window, got ${total}%`);
});

test('badges unlock from real activity', options, async () => {
  const device = '99999999-9999-4999-8999-999999999999';
  const earned = async () => (await buildProgress(device, UTC)).badges.filter((b) => b.earned).map((b) => b.id);

  assert.deepEqual(await earned(), []);

  await seedCompletion({ deviceId: device, at: dayAgo(0) });
  assert.deepEqual(await earned(), ['first-blood']);

  await seedCompletion({ deviceId: device, at: dayAgo(0, 3) });
  assert.ok((await earned()).includes('night-shift'), '3am counts as the night shift');
});

test('the leaderboard ranks real players above padding by score alone', options, async () => {
  const device = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  // Enough XP to beat every sample player, which top out below 9,500.
  for (let i = 0; i < 600; i += 1) await seedCompletion({ deviceId: device, at: dayAgo(0), xp: 40 });

  const board = await buildLeaderboard(device, UTC);

  assert.equal(board.rows[0].isMe, true, 'a real player with the most XP leads');
  assert.equal(board.rows[0].simulated, false);
  assert.equal(board.me.rank, 1);
});

test('every padded row is flagged, and hidden devices stay off the board', options, async () => {
  const board = await buildLeaderboard(OTHER, UTC);

  for (const row of board.rows) {
    assert.equal(typeof row.simulated, 'boolean');
    if (row.simulated) assert.equal(row.isMe, false, 'padding is never the caller');
  }

  assert.ok(board.simulatedPlayers > 0);
  assert.equal(
    board.rows.filter((row) => !row.simulated).every((row) => row.score > 0),
    true,
    'real rows only appear once they have scored'
  );
});

test('a paused wait still keeps the tasks cleared after the pause', options, async () => {
  const device = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const waitId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const start = dayAgo(0, 8);

  /*
   * Ten minutes of clock across half an hour of wall time, because the wait was
   * paused. The task was cleared 25 minutes in - long past `startedAt + elapsed`,
   * which is what the old timestamp-containment join used as the window.
   */
  await seedSession({ deviceId: device, startedAt: start, durationSeconds: 600, waitId });
  await seedCompletion({
    deviceId: device,
    at: new Date(start.getTime() + 25 * 60_000),
    category: 'body',
    waitId
  });

  const progress = await buildProgress(device, UTC);

  assert.equal(progress.putToWorkPercent, 100, 'the wait was used, whatever the clock said');
  assert.equal(progress.reclaimedTodaySeconds, 600);
  assert.deepEqual(progress.mix, [{ id: 'body', label: 'Body', percent: 100, seconds: 600 }]);
});

test('a task cleared with no wait running scores but belongs to no wait', options, async () => {
  const device = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await seedSession({
    deviceId: device,
    startedAt: dayAgo(0, 11),
    durationSeconds: 300,
    waitId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
  });
  await seedCompletion({ deviceId: device, at: dayAgo(0, 11), xp: 40, waitId: null });

  const progress = await buildProgress(device, UTC);

  assert.equal(progress.score, 40, 'it still scores');
  assert.equal(progress.putToWorkPercent, 0, 'but the wait itself went unused');
});

test('sample players never outrank the top real player', options, async () => {
  const device = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';

  // A realistic week: a handful of tasks, not thousands of XP.
  for (let i = 0; i < 12; i += 1) await seedCompletion({ deviceId: device, at: dayAgo(i % 6), xp: 25 });

  const board = await buildLeaderboard(device, UTC);
  const real = board.rows.filter((row) => !row.simulated);
  const samples = board.rows.filter((row) => row.simulated);
  const topReal = Math.max(...real.map((row) => row.score));

  assert.equal(board.rows[0].simulated, false, 'a real player always leads the board');

  for (const row of samples) {
    assert.ok(row.score < topReal, `padding at ${row.score} should sit below the top real ${topReal}`);
  }
});

test('padding is scaled to the real field, not to a fixed fantasy', options, async () => {
  // A brand-new device on a board whose real scores are small.
  const board = await buildLeaderboard('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', { ...UTC, limit: 8 });
  const samples = board.rows.filter((row) => row.simulated);
  const topReal = Math.max(0, ...board.rows.filter((row) => !row.simulated).map((row) => row.score));

  for (const row of samples) {
    assert.ok(row.score <= Math.max(1400, topReal), `padding at ${row.score} is out of scale`);
    assert.ok(row.tasksCleared >= 1, 'a scored player has cleared something');
  }
});

test('padding disappears once there are enough real players', options, async () => {
  const devices = Array.from({ length: 9 }, (_, i) => `2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c0${i}`);
  for (const [index, id] of devices.entries()) {
    await seedCompletion({ deviceId: id, at: dayAgo(0), xp: 20 + index });
  }

  const board = await buildLeaderboard(devices[0], { ...UTC, limit: 8 });

  assert.equal(board.rows.filter((row) => row.simulated).length, 0, 'a full table needs no padding');
  assert.ok(board.realPlayers >= 8);
});
