// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { buildAnalytics } from '../server/domain/analytics.js';
import { ensureDevice } from '../server/domain/devices.js';
import { buildProgress } from '../server/domain/progress.js';
import { listSessions } from '../server/domain/sessions.js';

/**
 * What the Stats screen is built from.
 *
 * Most of this was already being computed and thrown away - the hour buckets,
 * the peak hour, the change against the previous period - so these pin the
 * pieces the screen now actually draws.
 */

const options = { skip: skipWithoutDatabase };
const DEVICE = '11111111-1111-4111-8111-111111111111';
const UTC = { tzOffsetMinutes: 0 };
const DAY = 86_400_000;

let accountId;

async function seedWait({ daysAgo = 0, hour = 12, durationSeconds = 120, tasks = 0 }) {
  const startedAt = new Date(Date.now() - daysAgo * DAY);
  startedAt.setUTCHours(hour, 0, 0, 0);
  const waitId = randomUUID();

  await query(
    `INSERT INTO sessions (id, account_id, wait_id, label, duration_seconds, started_at, ended_at, city_id)
     VALUES ($1,$2,$3,'Prompt run',$4,$5,$6,5391959)`,
    [randomUUID(), accountId, waitId, durationSeconds, startedAt.toISOString(),
      new Date(startedAt.getTime() + durationSeconds * 1000).toISOString()]
  );

  for (let i = 0; i < tasks; i += 1) {
    await query(
      `INSERT INTO completions (id, account_id, suggestion_id, category, bucket, wait_id, xp, completed_at)
       VALUES ($1,$2,'s001','body','micro',$3,20,$4)`,
      [randomUUID(), accountId, waitId, new Date(startedAt.getTime() + 1000 * (i + 1)).toISOString()]
    );
  }

  return waitId;
}

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();
});

beforeEach(async () => {
  if (skipWithoutDatabase) return;
  await query('TRUNCATE accounts, devices, sessions, completions, pairing_codes, active_waits CASCADE');
  ({ accountId } = await ensureDevice(DEVICE));
});

after(async () => {
  if (skipWithoutDatabase) return;
  await endDatabase();
});

test('waits are counted into the hour they happened in', options, async () => {
  await seedWait({ hour: 17 });
  await seedWait({ hour: 17, daysAgo: 1 });
  await seedWait({ hour: 9, daysAgo: 2 });

  const { hourly, peakHour } = await buildAnalytics(DEVICE, UTC);

  assert.equal(hourly.length, 24, 'one bucket per hour, always');
  assert.equal(hourly[17].sessionCount, 2);
  assert.equal(hourly[9].sessionCount, 1);
  assert.equal(peakHour, 17, 'the busiest hour is named');
});

test('the peak hour is null when nothing has happened', options, async () => {
  const { peakHour, hourly } = await buildAnalytics(DEVICE, UTC);

  assert.equal(peakHour, null);
  assert.equal(hourly.every((entry) => entry.sessionCount === 0), true);
});

test('waits are grouped by how long they ran', options, async () => {
  await seedWait({ durationSeconds: 30 });
  await seedWait({ durationSeconds: 45, daysAgo: 1 });
  await seedWait({ durationSeconds: 200, daysAgo: 1 });
  await seedWait({ durationSeconds: 600, daysAgo: 2 });
  await seedWait({ durationSeconds: 4000, daysAgo: 2 });

  const byId = Object.fromEntries(
    (await buildAnalytics(DEVICE, UTC)).distribution.map((bucket) => [bucket.id, bucket.count])
  );

  assert.deepEqual(byId, { micro: 2, short: 1, medium: 1, long: 1 });
});

test('the best day in the window is reported', options, async () => {
  await seedWait({ daysAgo: 1 });
  await seedWait({ daysAgo: 3, hour: 9 });
  await seedWait({ daysAgo: 3, hour: 11 });
  await seedWait({ daysAgo: 3, hour: 15 });

  const { bestDay } = await buildAnalytics(DEVICE, UTC);

  assert.equal(bestDay.count, 3);
  assert.ok(bestDay.weekday, 'and named, so the card can say which day');
});

test('the per-day breakdown is bounded however wide the window', options, async () => {
  await seedWait({ daysAgo: 2 });

  const week = await buildAnalytics(DEVICE, { ...UTC, days: 7 });
  const everything = await buildAnalytics(DEVICE, { ...UTC, days: 3650 });

  assert.equal(week.daily.length, 7);
  // Totals cover the whole window; the array is only what a calendar can draw.
  assert.equal(everything.daily.length, 371, 'a decade of mostly-empty days is not shipped');
  assert.equal(everything.sessionCount, week.sessionCount);
});

test('a wait carries what was cleared during it', options, async () => {
  await seedWait({ tasks: 3 });
  await seedWait({ daysAgo: 1, tasks: 0 });

  const sessions = await listSessions(DEVICE, { limit: 10 });

  assert.equal(sessions[0].tasksCleared, 3, 'newest first');
  assert.equal(sessions[1].tasksCleared, 0);
});

test('records look back further than the current streak', options, async () => {
  // A four-day run that has since been broken, then one day recently.
  for (const daysAgo of [20, 19, 18, 17]) await seedWait({ daysAgo, tasks: 1 });
  await seedWait({ daysAgo: 1, tasks: 6 });

  const progress = await buildProgress(DEVICE, { ...UTC, days: 90 });

  assert.equal(progress.longestStreakDays, 4, 'a broken streak still happened');
  assert.ok(progress.streakDays <= 1, 'and is not the current one');
  assert.equal(progress.bestTasksInOneWait, 6);
});

/* --- Waits nobody ended -------------------------------------------------- */

/**
 * A laptop closed mid-wait logs a session of several hours. It is not a wait,
 * and counting it made the average, the spread and the longest-wait record all
 * describe forgetfulness rather than waiting. They are set aside and counted
 * separately, so the screen can say what it is leaving out.
 */

test('a wait left running all night is not counted as a wait', options, async () => {
  await seedWait({ daysAgo: 1, durationSeconds: 120 });
  await seedWait({ daysAgo: 1, durationSeconds: 300 });
  await seedWait({ daysAgo: 1, durationSeconds: 6 * 3600 });

  const { sessionCount, abandonedCount, averageSessionSeconds } = await buildAnalytics(DEVICE, UTC);

  assert.equal(sessionCount, 2, 'the two real waits');
  assert.equal(abandonedCount, 1, 'and one reported, not hidden');
  assert.equal(averageSessionSeconds, 210, 'six hours would have made this over two hours');
});

test('the longest-wait record is a wait, not a forgotten timer', options, async () => {
  await seedWait({ daysAgo: 1, durationSeconds: 1800 });
  await seedWait({ daysAgo: 1, durationSeconds: 5 * 3600 });

  const { longestSessionSeconds } = await buildAnalytics(DEVICE, UTC);
  assert.equal(longestSessionSeconds, 1800, 'half an hour is the real best');
});

test('a long but plausible wait still counts', options, async () => {
  await seedWait({ daysAgo: 1, durationSeconds: 80 * 60 });

  const { sessionCount, abandonedCount } = await buildAnalytics(DEVICE, UTC);
  assert.equal(sessionCount, 1, 'an hour and twenty is a long agent run, not a mistake');
  assert.equal(abandonedCount, 0);
});

test('abandoned waits are kept out of the shape of the waits too', options, async () => {
  await seedWait({ daysAgo: 1, durationSeconds: 30 });
  await seedWait({ daysAgo: 1, durationSeconds: 6 * 3600 });

  const { distribution } = await buildAnalytics(DEVICE, UTC);
  const counted = distribution.reduce((sum, bucket) => sum + bucket.count, 0);

  assert.equal(counted, 1, 'the six-hour row is not in the "15 minutes+" column');
});
