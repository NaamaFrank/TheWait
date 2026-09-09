import { readSessionRecords } from './sessions.js';
import { clampInt, requireDeviceId } from './validate.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOURS_IN_DAY = 24;

/**
 * All bucketing is done in the *viewer's* local time. The client sends its
 * `Date#getTimezoneOffset()` so that "today" and "3pm" mean what the user sees
 * on their own clock rather than UTC.
 */
function toLocal(isoDate, tzOffsetMinutes) {
  return new Date(new Date(isoDate).getTime() - tzOffsetMinutes * 60 * 1000);
}

function localDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function summarise(durations) {
  const total = durations.reduce((sum, value) => sum + value, 0);

  return {
    totalSeconds: total,
    sessionCount: durations.length,
    averageSeconds: durations.length ? Math.round(total / durations.length) : 0,
    longestSeconds: durations.length ? Math.max(...durations) : 0
  };
}

/** Percentage change from `previous` to `current`; null when there is no baseline. */
function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function buildAnalytics(rawDeviceId, { days = 7, tzOffsetMinutes = 0 } = {}) {
  const deviceId = requireDeviceId(rawDeviceId);
  const windowDays = clampInt(days, 7, { min: 1, max: 90 });
  const offset = clampInt(tzOffsetMinutes, 0, { min: -840, max: 840 });

  const records = await readSessionRecords(deviceId);
  const nowLocal = toLocal(new Date().toISOString(), offset);
  const todayStart = Date.parse(`${localDayKey(nowLocal)}T00:00:00Z`);
  const windowStart = todayStart - (windowDays - 1) * MS_PER_DAY;
  const previousStart = windowStart - windowDays * MS_PER_DAY;

  const dailyTotals = new Map();
  const hourlyDurations = Array.from({ length: HOURS_IN_DAY }, () => []);
  const currentDurations = [];
  const previousDurations = [];

  for (const record of records) {
    const local = toLocal(record.startedAt, offset);
    const dayStart = Date.parse(`${localDayKey(local)}T00:00:00Z`);

    if (dayStart >= windowStart) {
      currentDurations.push(record.durationSeconds);
      dailyTotals.set(dayStart, (dailyTotals.get(dayStart) ?? 0) + record.durationSeconds);
      hourlyDurations[local.getUTCHours()].push(record.durationSeconds);
    } else if (dayStart >= previousStart) {
      previousDurations.push(record.durationSeconds);
    }
  }

  const current = summarise(currentDurations);
  const previous = summarise(previousDurations);

  const daily = Array.from({ length: windowDays }, (_, index) => {
    const dayStart = windowStart + index * MS_PER_DAY;
    const date = new Date(dayStart);

    return {
      date: localDayKey(date),
      weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      totalSeconds: dailyTotals.get(dayStart) ?? 0,
      isToday: dayStart === todayStart
    };
  });

  const hourly = hourlyDurations.map((durations, hour) => ({
    hour,
    averageSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    sessionCount: durations.length
  }));

  const peak = hourly.reduce(
    (best, entry) => (entry.averageSeconds > best.averageSeconds ? entry : best),
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
    peakHour: peak.sessionCount ? peak.hour : null,
    daily,
    hourly,
    lifetimeSessionCount: records.length,
    generatedAt: new Date().toISOString()
  };
}
