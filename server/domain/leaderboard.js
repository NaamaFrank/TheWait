import { config } from '../config.js';
import { scoresSince } from '../db/completions.repo.js';
import { findAccounts } from '../db/accounts.repo.js';
import { AVATARS, SAMPLE_NAMES, TINTS, defaultAvatar } from './people.js';
import { featuredCities, resolveCity } from './cities.js';
import { localDayStart, MS_PER_DAY, toLocal } from './time.js';
import { accountIdFor } from './devices.js';
import { clampInt } from './validate.js';

/**
 * Weekly XP board.
 *
 * Real devices are ranked by the XP they actually earned. A fresh install would
 * otherwise be a leaderboard of one, so the table is padded with sample players
 * - every one of which is flagged `simulated: true` and is never allowed to
 * outrank a real person's row silently. The client says so on the screen.
 *
 * Devices that turned off "show me on the globe" are left out entirely, except
 * for the caller's own row, which is always returned so they can see where they
 * stand without being published to anyone else.
 */

/** Stable within a week, different the next - the board should move on Mondays. */
function weekSeed(nowMs) {
  return Math.floor(nowMs / (7 * MS_PER_DAY));
}

function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** The band sample scores fall into before anyone real has played. */
const EMPTY_APP_BAND = [180, 1400];

/**
 * Scores for the sample players, scaled to whoever is actually playing.
 *
 * A fixed band does not work: a real week of play is a few hundred XP, so
 * padding invented at "9,204" would wall every genuine user off at the bottom
 * of their own leaderboard forever. Instead the band is derived from the real
 * field and stays strictly below the top real score, so the leader is always a
 * real person and the padding reads as a plausible neighbourhood rather than an
 * unreachable one.
 */
function sampleBand(topRealScore) {
  if (!topRealScore) return EMPTY_APP_BAND;
  return [Math.max(1, Math.round(topRealScore * 0.2)), Math.max(2, Math.round(topRealScore * 0.95))];
}

function sampleRows(seed, topRealScore, count) {
  const places = featuredCities(80);
  const [floor, ceiling] = sampleBand(topRealScore);
  const spread = Math.max(1, ceiling - floor);

  return SAMPLE_NAMES.slice(0, count).map((name, index) => {
    const noise = hash(`${name}:${seed}`);
    const city = places[noise % places.length];
    const score = floor + (noise % spread);

    return {
      displayName: name,
      avatar: AVATARS[index % AVATARS.length],
      cityId: city.id,
      place: city.name,
      tint: TINTS[index % TINTS.length],
      score,
      // Roughly in proportion to the score, at the catalogue's going rate.
      tasksCleared: Math.max(1, Math.round(score / 26)),
      simulated: true,
      isMe: false
    };
  });
}

export async function buildLeaderboard(rawDeviceId, { days = 7, tzOffsetMinutes = 0, limit } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  const windowDays = clampInt(days, 7, { min: 1, max: 90 });
  const offset = clampInt(tzOffsetMinutes, 0, { min: -840, max: 840 });
  const size = clampInt(limit, config.leaderboardSize, { min: 3, max: 50 });

  const now = Date.now();
  const windowStart = localDayStart(toLocal(new Date(now).toISOString(), offset)) - (windowDays - 1) * MS_PER_DAY;

  /*
   * Scored in the database. This is the one query that spans every device
   * rather than just the caller's, so summing it here instead of reading the
   * whole completions table into memory is what keeps it viable once deployed.
   */
  const scores = await scoresSince(new Date(windowStart + offset * 60 * 1000).toISOString());
  const accounts = await findAccounts(scores.map((row) => row.accountId));

  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const realRows = [];

  // Driven by who scored, not by who has a device row: a caller can have XP
  // before their profile is written, and they should still see themselves.
  for (const tally of scores) {
    const scoredId = tally.accountId;
    const account = byId.get(scoredId) ?? {};
    const isMe = scoredId === accountId;

    // Hidden accounts stay off the public board, but you always see yourself.
    if (account.visible === false && !isMe) continue;

    const city = resolveCity(account.cityId);

    realRows.push({
      displayName: account.displayName ?? `anon_${scoredId.slice(0, 6)}`,
      cityId: city.id,
      place: city.name,
      tint: account.tint ?? TINTS[0],
      avatar: account.avatar ?? defaultAvatar(scoredId),
      score: tally.score,
      tasksCleared: tally.tasksCleared,
      simulated: false,
      isMe
    });
  }

  // Padding only exists to stop a new install seeing a table of one. Once
  // there are enough real players it disappears entirely.
  const paddingWanted = Math.max(0, size - realRows.length);
  const topRealScore = realRows.reduce((best, row) => Math.max(best, row.score), 0);

  const ranked = [...realRows, ...sampleRows(weekSeed(now), topRealScore, paddingWanted)]
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const mine = ranked.find((row) => row.isMe) ?? null;
  const rows = ranked.slice(0, size);

  // Always surface the caller's row, even when they are far down the table.
  if (mine && !rows.some((row) => row.isMe)) rows.push(mine);

  return {
    windowDays,
    rows,
    me: mine,
    realPlayers: realRows.length,
    simulatedPlayers: ranked.filter((row) => row.simulated).length,
    generatedAt: new Date(now).toISOString()
  };
}
