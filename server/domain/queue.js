import { randomUUID } from 'node:crypto';
import { allCompletionsFor } from '../db/completions.repo.js';
import {
  addUserTask,
  archiveUserTask,
  blockSuggestion,
  countUserTasks,
  listUserTasks,
  readSkips,
  recordSkip
} from '../db/tasks.repo.js';
import { accountIdFor } from './devices.js';
import { readSessionRecords } from './sessions.js';
import { bucketForSeconds, listBuckets, pickSuggestions } from './suggestions.js';
import { looksAbandoned } from './abandoned.js';
import { optionalText } from './validate.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';

/**
 * What to offer next.
 *
 * `suggestions.js` stays a pure reader of the catalogue; everything that knows
 * about a particular person lives here - what they have turned down, what they
 * keep doing, what they wrote themselves, and how long their waits actually
 * run.
 */

/** Longest a title may be. Long enough for a real errand, short enough to read. */
const MAX_TITLE = 80;

/** Past this many skips a suggestion stops being offered on its own. */
const SKIPS_BEFORE_RETIRED = 3;

/**
 * How much a category you actually do is favoured over one you ignore.
 *
 * Deliberately mild. Clearing three "craft" tasks should tilt the queue, not
 * collapse it to one category and never show you anything else.
 */
const TASTE_WEIGHT = 2;

/* --- How long your waits really run --------------------------------------- */

/**
 * The size of wait to offer for, given how long this one has already run.
 *
 * The app cannot know how long *this* wait will be. Offering a twenty minute
 * task eight minutes in is a bet on the future, and a lost one if the answer
 * lands a minute later - you are left holding something you cannot finish.
 *
 * What it does know is how long your waits usually run, which is an observed
 * fact rather than a guess. So the elapsed time picks a size and your own
 * median caps it: if your waits are typically three minutes, nothing longer
 * than a three minute task is ever offered, however long this one drags on.
 */
export function sizeFor(elapsedSeconds, sessions) {
  const reached = bucketForSeconds(Math.max(0, Number(elapsedSeconds) || 0));
  const typical = medianWait(sessions);

  // Nothing to go on yet - a new account gets the catalogue's own judgement.
  if (typical === null) return reached;

  const ceiling = bucketForSeconds(typical);
  const order = listBuckets().map((bucket) => bucket.id);

  return order.indexOf(reached.id) <= order.indexOf(ceiling.id) ? reached : ceiling;
}

/** The middle wait, which a couple of marathon sessions cannot drag upwards. */
function medianWait(sessions) {
  const lengths = sessions
    .filter((session) => !looksAbandoned(session.durationSeconds))
    .map((session) => session.durationSeconds)
    .sort((a, b) => a - b);

  if (lengths.length < 3) return null;
  return lengths[Math.floor(lengths.length / 2)];
}

/* --- Taste ---------------------------------------------------------------- */

/** Categories weighted by how often they were actually cleared. */
function tasteFrom(completions) {
  const counts = new Map();
  for (const entry of completions) {
    if (entry.category) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }

  return counts;
}

/* --- The queue ------------------------------------------------------------ */

/**
 * Builds the list a wait is offered.
 *
 * Your own tasks come first when there are any that suit the size: they are
 * the ones you already decided were worth doing.
 */
export async function buildQueue(rawDeviceId, { seconds = 0, category = null, count = 3, exclude = [] } = {}) {
  const accountId = await accountIdFor(rawDeviceId);

  const [skips, own, sessions, completions] = await Promise.all([
    readSkips(accountId),
    listUserTasks(accountId),
    readSessionRecords(accountId),
    allCompletionsFor(accountId)
  ]);

  const bucket = sizeFor(seconds, sessions);
  const excluded = new Set(exclude);

  const blocked = new Set(skips.filter((skip) => skip.blocked).map((skip) => skip.suggestionId));
  const tired = new Set(
    skips.filter((skip) => !skip.blocked && skip.skips >= SKIPS_BEFORE_RETIRED).map((skip) => skip.suggestionId)
  );

  const mine = own
    .filter((task) => task.bucket === bucket.id && !excluded.has(task.id))
    .map((task) => ({
      id: task.id,
      bucket: task.bucket,
      category: 'yours',
      title: task.title,
      sub: 'Something you added',
      tag: 'Yours',
      // Worth what any task of that size is worth. You did a real thing.
      xp: bucket.xp ?? 0,
      bucketLabel: bucket.label,
      mine: true
    }));

  const wanted = Math.max(1, Math.min(12, Number(count) || 3));

  const picked = pickSuggestions({
    seconds,
    bucket: bucket.id,
    category,
    count: Math.max(wanted * 3, 9),
    exclude: [...excluded, ...blocked, ...tired],
    weights: tasteFrom(completions),
    weight: TASTE_WEIGHT
  });

  // Yours first, then the catalogue's, trimmed to what was asked for.
  const items = [...mine, ...picked.items].slice(0, wanted);

  return { bucket, category, items, yours: mine.length };
}

/* --- What you tell it ----------------------------------------------------- */

export async function skipSuggestion(rawDeviceId, suggestionId) {
  const id = optionalText(suggestionId, 'suggestionId', 64);
  if (!id) return { ok: false };

  await recordSkip(await accountIdFor(rawDeviceId), id);
  return { ok: true };
}

export async function blockSuggestionFor(rawDeviceId, suggestionId, blocked = true) {
  const id = optionalText(suggestionId, 'suggestionId', 64);
  if (!id) return { ok: false };

  await blockSuggestion(await accountIdFor(rawDeviceId), id, blocked !== false);
  return { ok: true, blocked: blocked !== false };
}

/* --- Your own tasks ------------------------------------------------------- */

/** More than this and the list is a to-do app, which this is not. */
const MAX_OWN_TASKS = 30;

export async function getUserTasks(rawDeviceId) {
  return { tasks: await listUserTasks(await accountIdFor(rawDeviceId)) };
}

export async function createUserTask(rawDeviceId, { title, bucket } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  const clean = optionalText(title, 'title', MAX_TITLE);

  // The router only surfaces HttpError; a plain Error with a status on it
  // comes back to the client as an internal error.
  if (!clean) throw badRequest('A task needs a title.');

  const known = listBuckets().some((candidate) => candidate.id === bucket);
  if (!known) throw badRequest('That is not a size of wait.');

  if ((await countUserTasks(accountId)) >= MAX_OWN_TASKS) {
    throw new HttpError(409, `That is ${MAX_OWN_TASKS} already. Clear a few first.`);
  }

  return { task: await addUserTask(accountId, { id: randomUUID(), title: clean, bucket }) };
}

export async function removeUserTask(rawDeviceId, id) {
  const task = await archiveUserTask(await accountIdFor(rawDeviceId), id);

  if (!task) throw notFound('No such task.');

  return { task };
}
