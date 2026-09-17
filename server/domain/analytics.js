import { accountIdFor } from './devices.js';
import { readSessionRecords } from './sessions.js';
import { localDayKey, localDayStart, MS_PER_DAY, toLocal, weekdayInitial, weekdayShort } from './time.js';
import { looksAbandoned } from './abandoned.js';
import { clampInt } from './validate.js';

const HOURS_IN_DAY = 24;

/**
 * How many days the per-day breakdown returns, however wide the window is.
 *
 * Totals are aggregated over the whole window, but the array is what a
 * calendar can draw - fifty-three weeks - and an "all time" request would
 * otherwise ship ten years of mostly-empty days.
 */
const MAX_DAILY_DAYS = 371;

/**
 * How wait lengths are grouped for the distribution.
 *
 * The same boundaries the suggestion catalogue uses, so "the shape of your
 * waits" and "what you were offered to do" describe the same thing.
 */
const LENGTH_BUCKETS = [
  { id: 'micro', label: 'Under a minute', max: 60 },
  { id: 'short', label: '1-5 minutes', max: 300 },
  { id: 'medium', label: '5-15 minutes', max: 900 },
  { id: 'long', label: '15 minutes+', max: Infinity }
];

function summarise(durations) {
  const total = durations.reduce((sum, value) => sum + value, 0);

  return {
    totalSeconds: total,
    sessionCount: durations.length,
    averageSeconds: durations.length ? Math.round(total / durations.length) : 0,
    longestSeconds: durations.length ? Math.max(...durations) : 0
  };
}

/** The day with the most waits in it, and what it held. */
function bestDayOf(counts, totals) {
  let bestStart = null;

  for (const [dayStart, count] of counts) {
    if (bestStart === null || count > counts.get(bestStart)) bestStart = dayStart;
  }

  if (bestStart === null) return null;

  return {
    date: localDayKey(new Date(bestStart)),
    weekday: weekdayShort(bestStart),
    count: counts.get(bestStart),
    totalSeconds: totals.get(bestStart) ?? 0
  };
}

/** Percentage change from `previous` to `current`; null when there is no baseline. */
function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function buildAnalytics(rawDeviceId, { days = 7, tzOffsetMinutes = 0 } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  // Up to a decade, so an "all time" view is a window like any other.
  const windowDays = clampInt(days, 7, { min: 1, max: 3650 });
  const offset = clampInt(tzOffsetMinutes, 0, { min: -840, max: 840 });

  const records = await readSessionRecords(accountId);
  const nowLocal = toLocal(new Date().toISOString(), offset);
  const todayStart = localDayStart(nowLocal);
  const windowStart = todayStart - (windowDays - 1) * MS_PER_DAY;
  const previousStart = windowStart - windowDays * MS_PER_DAY;

  const dailyTotals = new Map();
  const dailyCounts = new Map();
  const distribution = new Map(LENGTH_BUCKETS.map((bucket) => [bucket.id, 0]));
  const hourlyDurations = Array.from({ length: HOURS_IN_DAY }, () => []);
  const currentDurations = [];
  const previousDurations = [];

  let abandonedCount = 0;

  for (const record of records) {
    const local = toLocal(record.startedAt, offset);
    const dayStart = localDayStart(local);

    /*
     * Set aside before anything is derived from it. It is still counted as a
     * wait that happened - it did - but none of its length is trusted.
     */
    if (looksAbandoned(record.durationSeconds)) {
      if (dayStart >= windowStart) abandonedCount += 1;
      continue;
    }

    if (dayStart >= windowStart) {
      currentDurations.push(record.durationSeconds);
      dailyTotals.set(dayStart, (dailyTotals.get(dayStart) ?? 0) + record.durationSeconds);
      dailyCounts.set(dayStart, (dailyCounts.get(dayStart) ?? 0) + 1);

      const bucket = LENGTH_BUCKETS.find((candidate) => record.durationSeconds < candidate.max);
      distribution.set(bucket.id, distribution.get(bucket.id) + 1);
      hourlyDurations[local.getUTCHours()].push(record.durationSeconds);
    } else if (dayStart >= previousStart) {
      previousDurations.push(record.durationSeconds);
    }
  }

  const current = summarise(currentDurations);
  const previous = summarise(previousDurations);

  const dailyDays = Math.min(windowDays, MAX_DAILY_DAYS);
  const dailyStart = todayStart - (dailyDays - 1) * MS_PER_DAY;

  const daily = Array.from({ length: dailyDays }, (_, index) => {
    const dayStart = dailyStart + index * MS_PER_DAY;
    const date = new Date(dayStart);

    return {
      date: localDayKey(date),
      weekday: weekdayShort(dayStart),
      initial: weekdayInitial(dayStart),
      totalSeconds: dailyTotals.get(dayStart) ?? 0,
      sessionCount: dailyCounts.get(dayStart) ?? 0,
      isToday: dayStart === todayStart
    };
  });

  const hourly = hourlyDurations.map((durations, hour) => ({
    hour,
    averageSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    sessionCount: durations.length
  }));

  /*
   * The hour you wait most often, not the hour your waits are longest. The
   * ring sizes its wedges by how many waits an hour holds, so the wedge it
   * highlights has to be chosen the same way.
   */
  const peak = hourly.reduce(
    (best, entry) => (entry.sessionCount > best.sessionCount ? entry : best),
    hourly[0]
  );

  return {
    windowDays,
    totalSeconds: current.totalSeconds,
    sessionCount: current.sessionCount,
    averageSessionSeconds: current.averageSeconds,
    longestSessionSeconds: current.longestSeconds,
    dailyAverageSeconds: Math.round(current.totalSeconds / windowDays),
    totalChangePercent: percentChange(current.totalSeconds, previous.totalSeconds),
    countChangePercent: percentChange(current.sessionCount, previous.sessionCount),
    peakHour: peak.sessionCount ? peak.hour : null,
    // Left out of every figure above, and said out loud rather than hidden.
    abandonedCount,
    daily,
    hourly,
    lifetimeSessionCount: records.length,

    // The shape of the waits themselves, rather than how many there were.
    distribution: LENGTH_BUCKETS.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      count: distribution.get(bucket.id)
    })),

    // The best single day in the window, for the records card.
    bestDay: bestDayOf(dailyCounts, dailyTotals),

    generatedAt: new Date().toISOString()
  };
}
