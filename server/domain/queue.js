import { randomUUID } from 'node:crypto';
import { allCompletionsFor } from '../db/completions.repo.js';
import {
  addUserTask,
  archiveUserTask,
  blockSuggestion,
  countUserTasks,
  listUserTasks,
  readRecentlyShown,
  readSkips,
  recordShown,
  recordSkip
} from '../db/tasks.repo.js';
import { accountIdFor } from './devices.js';
import { readSessionRecords } from './sessions.js';
import { bucketForSeconds, listBuckets, listChains, pickSuggestions } from './suggestions.js';
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
 * How many recently-shown suggestions are held back from the next build.
 *
 * Skipping something is a signal; simply having been shown it is not - you may
 * have cleared it, or the answer arrived. But seeing the same task three waits
 * running is the repetition this was meant to stop, so the last few are set
 * aside and come round again after that.
 *
 * `pickSuggestions` falls back to the whole bucket if the filters leave it
 * nothing, so this can never empty the queue.
 */
const RECENTLY_SHOWN = 12;

/**
 * How often a long wait is offered a chain rather than a single task.
 *
 * Not always: a routine is a bigger ask than one thing, and someone who wants
 * one thing should not have to skip past a routine to get it.
 */
const CHAIN_SHARE = 0.4;

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

  const [skips, recent, own, sessions, completions] = await Promise.all([
    readSkips(accountId),
    readRecentlyShown(accountId, RECENTLY_SHOWN),
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
    // Recently shown is the softest of the three: held back, not retired.
    exclude: [...excluded, ...blocked, ...tired, ...recent],
    weights: tasteFrom(completions),
    weight: TASTE_WEIGHT
  });

  /*
   * A chain, sometimes, on the waits long enough to be worth one. Offered
   * after anything you wrote yourself and before the single tasks, so it is
   * one Next away rather than something to be got past.
   */
  const routines = listChains(bucket.id, category)
    .filter((chain) => !excluded.has(chain.id) && !blocked.has(chain.id) && !tired.has(chain.id));

  const chain = routines.length && Math.random() < CHAIN_SHARE
    ? [routines[Math.floor(Math.random() * routines.length)]]
    : [];

  // Yours first, then a routine if there is one, then the rest.
  const items = [...mine, ...chain, ...picked.items].slice(0, wanted);

  return { bucket, category, items, yours: mine.length };
}

/* --- What you tell it ----------------------------------------------------- */

/** Reported by the screen when a task is actually put in front of someone. */
export async function markShown(rawDeviceId, suggestionId) {
  const id = optionalText(suggestionId, 'suggestionId', 64);
  if (!id) return { ok: false };

  await recordShown(await accountIdFor(rawDeviceId), id);
  return { ok: true };
}

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
