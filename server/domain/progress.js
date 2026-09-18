import { randomUUID } from 'node:crypto';
import { looksAbandoned } from './abandoned.js';
import { config } from '../config.js';
import { allCompletionsFor, insertCompletion } from '../db/completions.repo.js';
import { badRequest } from '../http/errors.js';
import { accountIdFor } from './devices.js';
import { readSessionRecords } from './sessions.js';
import { getCategoryLabel, getSuggestion, listBuckets } from './suggestions.js';
import { listUserTasks } from '../db/tasks.repo.js';
import { publish } from './events.js';
import { localDayKey, localDayStart, MS_PER_DAY, toLocal, weekdayInitial } from './time.js';
import { isUuid, clampInt, optionalUuid, requireDeviceId } from './validate.js';

/**
 * XP, streaks and badges.
 *
 * The unit of progress is a *cleared task*, never elapsed time: waiting longer
 * earns nothing. A completion is scored from its suggestion's bucket, so the
 * client cannot decide how much a task is worth.
 */

const BADGES = [
  {
    id: 'first-blood',
    name: 'First Blood',
    note: 'Clear your first task during a wait.',
    earned: (facts) => facts.tasksCleared >= 1
  },
  {
    id: 'ten-minute-mile',
    name: 'Ten-Minute Mile',
    note: 'Clear six tasks inside a single wait.',
    earned: (facts) => facts.bestTasksInOneWait >= 6
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    note: 'Put a wait to work between 1am and 5am.',
    earned: (facts) => facts.clearedAfterMidnight
  },
  {
    id: 'hydro-homie',
    name: 'Hydro Homie',
    note: 'Clear a body task in seven different waits.',
    earned: (facts) => facts.waitsWithBodyTask >= 7
  },
  {
    id: 'inbox-zero',
    name: 'Inbox Zero-ish',
    note: 'Clear twenty tasks that involve other people.',
    earned: (facts) => facts.connectCleared >= 20
  },
  {
    id: 'long-con',
    name: 'The Long Con',
    note: 'Keep a thirty-day streak alive.',
    earned: (facts) => facts.streakDays >= 30
  }
];

/** Rows the mix adds on top of the real categories. */
const IDLE_SLICE = { id: 'idle', label: 'Stared at the cursor' };
const OTHER_SLICE = { id: 'other', label: 'Everything else' };

/** How many categories the mix names before collapsing the rest into one row. */
const MIX_ROWS = 4;

/** Records a cleared task and returns the refreshed progress. */
export async function recordCompletion(rawDeviceId, payload, options = {}) {
  const deviceId = requireDeviceId(rawDeviceId);
  const accountId = await accountIdFor(deviceId);
  /*
   * From the catalogue, or from the tasks this person wrote themselves. Their
   * own were rejected outright before, because the catalogue was the only
   * place a task could come from.
   */
  const suggestion =
    getSuggestion(payload?.suggestionId) ?? (await ownTaskAsSuggestion(accountId, payload?.suggestionId));

  if (!suggestion) throw badRequest('"suggestionId" must name a task you were offered');

  const record = {
    id: randomUUID(),
    accountId,
    deviceId,
    suggestionId: suggestion.id,
    category: suggestion.category,
    bucket: suggestion.bucket,
    // Which wait this was cleared during, if any. Null means it was cleared
    // with no wait running, which still scores but belongs to no wait.
    waitId: optionalUuid(payload.waitId, 'waitId'),
    // Scored from the catalogue, not from anything the client sent.
    xp: suggestion.xp
  };

  await insertCompletion(record, { keep: config.maxCompletionsPerDevice });

  // The XP, the tiles and the board all moved, on every screen this account
  // has open - not only the one that pressed the button.
  publish(accountId, { type: 'numbers' });

  return buildProgress(deviceId, options);
}

/**
 * One of your own tasks, in the shape the catalogue would have returned.
 *
 * Scored by its size, exactly as a catalogue task of that bucket is, so
 * writing your own is not a way to mint XP and not a way to lose it either.
 */
async function ownTaskAsSuggestion(accountId, id) {
  if (!isUuid(id)) return null;

  const mine = (await listUserTasks(accountId)).find((task) => task.id === id);
  if (!mine) return null;

  const bucket = listBuckets().find((candidate) => candidate.id === mine.bucket);

  return {
    id: mine.id,
    category: 'yours',
    bucket: mine.bucket,
    xp: bucket?.xp ?? 0
  };
}

/** Total XP earned in the last `days` local days. Used by the leaderboard. */
export async function weeklyScore(rawDeviceId, { days = 7, tzOffsetMinutes = 0 } = {}) {
  const completions = await allCompletionsFor(await accountIdFor(rawDeviceId));
  const now = toLocal(new Date().toISOString(), tzOffsetMinutes);
  const windowStart = localDayStart(now) - (days - 1) * MS_PER_DAY;

  return completions
    .filter((entry) => localDayStart(toLocal(entry.at, tzOffsetMinutes)) >= windowStart)
    .reduce((sum, entry) => sum + entry.xp, 0);
}

export async function buildProgress(rawDeviceId, { days = 7, tzOffsetMinutes = 0 } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  const windowDays = clampInt(days, 7, { min: 1, max: 90 });
  const offset = clampInt(tzOffsetMinutes, 0, { min: -840, max: 840 });

  const [completions, sessions] = await Promise.all([
    allCompletionsFor(accountId),
    readSessionRecords(accountId)
  ]);

  const now = toLocal(new Date().toISOString(), offset);
  const todayStart = localDayStart(now);
  const windowStart = todayStart - (windowDays - 1) * MS_PER_DAY;

  const score = completions.reduce((sum, entry) => sum + entry.xp, 0);

  /* --- Which day did each completion land on? --------------------------- */

  const daysWithWork = new Set();
  let todayCleared = 0;
  let clearedAfterMidnight = false;
  let connectCleared = 0;

  for (const entry of completions) {
    const local = toLocal(entry.at, offset);
    const dayStart = localDayStart(local);

    daysWithWork.add(dayStart);
    if (dayStart === todayStart) todayCleared += 1;

    const hour = local.getUTCHours();
    if (hour >= 1 && hour < 5) clearedAfterMidnight = true;
    if (entry.category === 'connect') connectCleared += 1;
  }

  /* --- Attribute completions to the wait they happened during ----------- */

  const byWait = attributeToWaits(sessions, completions);

  let bestTasksInOneWait = 0;
  let waitsWithBodyTask = 0;
  const categorySeconds = new Map();
  let idleSeconds = 0;
  let waitsPutToWork = 0;
  let windowWaits = 0;
  let waitsToday = 0;
  let reclaimedTodaySeconds = 0;

  let abandonedCount = 0;

  for (const wait of byWait) {
    /*
     * A wait nobody ended has its whole length split across whatever was
     * cleared during it - so one stretch inside a six-hour forgotten timer
     * reported six hours of stretching, and "put to work" counted a wait
     * nobody worked through. The tasks themselves still count; only the
     * length is untrusted, and length is all this loop uses.
     */
    if (looksAbandoned(wait.session.durationSeconds)) {
      abandonedCount += 1;
      continue;
    }

    bestTasksInOneWait = Math.max(bestTasksInOneWait, wait.entries.length);
    if (wait.entries.some((entry) => entry.category === 'body')) waitsWithBodyTask += 1;

    const dayStart = localDayStart(toLocal(wait.session.startedAt, offset));
    if (dayStart === todayStart) {
      waitsToday += 1;
      if (wait.entries.length) reclaimedTodaySeconds += wait.session.durationSeconds;
    }

    if (dayStart < windowStart) continue;
    windowWaits += 1;

    if (!wait.entries.length) {
      idleSeconds += wait.session.durationSeconds;
      continue;
    }

    waitsPutToWork += 1;

    // Split the wait evenly across whatever was cleared during it.
    const share = wait.session.durationSeconds / wait.entries.length;
    for (const entry of wait.entries) {
      categorySeconds.set(entry.category, (categorySeconds.get(entry.category) ?? 0) + share);
    }
  }

  /* --- Streak ------------------------------------------------------------ */

  const streakDays = countStreak(daysWithWork, todayStart);
  const longestStreakDays = longestRun(daysWithWork);

  const week = Array.from({ length: 7 }, (_, index) => {
    const dayStart = todayStart - (6 - index) * MS_PER_DAY;

    return {
      date: localDayKey(new Date(dayStart)),
      label: weekdayInitial(dayStart),
      done: daysWithWork.has(dayStart),
      isToday: dayStart === todayStart
    };
  });

  const facts = {
    tasksCleared: completions.length,
    bestTasksInOneWait,
    clearedAfterMidnight,
    waitsWithBodyTask,
    connectCleared,
    streakDays
  };

  return {
    windowDays,
    score,
    windowScore: completions
      .filter((entry) => localDayStart(toLocal(entry.at, offset)) >= windowStart)
      .reduce((sum, entry) => sum + entry.xp, 0),
    tasksCleared: completions.length,
    todayCleared,
    waitsToday,
    reclaimedTodaySeconds,
    streakDays,
    longestStreakDays,
    // The most cleared inside a single wait, for the records card.
    bestTasksInOneWait,
    // The next rung up, so the streak card always has something to aim at.
    nextMilestone: nextMilestone(streakDays),
    week,
    putToWorkPercent: windowWaits ? Math.round((waitsPutToWork / windowWaits) * 100) : 0,
    /*
     * The same fact as a count. The share card printed it, and rebuilding it
     * from the rounded percentage came out a wait short or a wait long - a
     * derived number on a card whose whole point is being accurate.
     */
    waitsUsed: waitsPutToWork,
    waitsCounted: windowWaits,
    mix: buildMix(categorySeconds, idleSeconds),
    // Left out of the mix and out of "put to work", and said so on screen.
    abandonedCount,
    badges: BADGES.map(({ id, name, note, earned }) => ({ id, name, note, earned: earned(facts) })),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Pairs each wait with the tasks cleared during it.
 *
 * The join is on the wait's own id, which the client mints when the clock
 * starts and sends with both the completions and the finished session.
 *
 * This used to match on timestamp containment, which quietly lost work: a
 * session's `endedAt` is `startedAt + elapsed`, so pausing pulls it in ahead of
 * the real end and everything cleared after the pause fell outside the window -
 * as did anything cleared within a few milliseconds of the boundary.
 */
function attributeToWaits(sessions, completions) {
  const waits = sessions
    .map((session) => ({ session, entries: [] }))
    .sort((a, b) => Date.parse(a.session.startedAt) - Date.parse(b.session.startedAt));

  const byWaitId = new Map();
  for (const wait of waits) {
    if (wait.session.waitId) byWaitId.set(wait.session.waitId, wait);
  }

  for (const entry of completions) {
    if (!entry.waitId) continue;
    byWaitId.get(entry.waitId)?.entries.push(entry);
  }

  return waits;
}

/**
 * Consecutive days ending today. Missing today does not break a streak until
 * the day is actually over, so yesterday is an acceptable starting point.
 */
function countStreak(daysWithWork, todayStart) {
  let cursor = daysWithWork.has(todayStart) ? todayStart : todayStart - MS_PER_DAY;
  if (!daysWithWork.has(cursor)) return 0;

  let streak = 0;
  while (daysWithWork.has(cursor)) {
    streak += 1;
    cursor -= MS_PER_DAY;
  }

  return streak;
}

/**
 * The longest run of consecutive days ever, which is not the same as the
 * current streak - a broken streak still happened.
 */
function longestRun(daysWithWork) {
  const days = [...daysWithWork].sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let previous = null;

  for (const day of days) {
    run = previous !== null && day - previous === MS_PER_DAY ? run + 1 : 1;
    previous = day;
    if (run > longest) longest = run;
  }

  return longest;
}

function nextMilestone(streakDays) {
  for (const milestone of [3, 7, 14, 30, 60, 100]) {
    if (streakDays < milestone) return milestone;
  }
  return null;
}

/**
 * Category shares of the time in the window, plus whatever went unused.
 *
 * Only the top few categories get their own row; the rest are collapsed into
 * one so the percentages still describe the whole window rather than an
 * arbitrary subset of it.
 */
function buildMix(categorySeconds, idleSeconds) {
  const total = [...categorySeconds.values()].reduce((sum, value) => sum + value, 0) + idleSeconds;
  if (!total) return [];

  const ranked = [...categorySeconds.entries()]
    .map(([id, seconds]) => ({ id, label: getCategoryLabel(id), seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  const slices = ranked.slice(0, MIX_ROWS);
  const remainder = ranked.slice(MIX_ROWS).reduce((sum, slice) => sum + slice.seconds, 0);

  if (remainder > 0) slices.push({ ...OTHER_SLICE, seconds: remainder });
  if (idleSeconds > 0) slices.push({ ...IDLE_SLICE, seconds: idleSeconds });

  return slices.map((slice) => ({
    id: slice.id,
    label: slice.label,
    percent: Math.round((slice.seconds / total) * 100),
    // The recap reports reclaimed time as a duration, and percentages of a
    // total do not round back to one.
    seconds: Math.round(slice.seconds)
  }));
}
