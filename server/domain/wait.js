import { randomUUID } from 'node:crypto';
import { lastCompletionAt } from '../db/completions.repo.js';
import {
  endWait as clearWait,
  findActiveWait,
  pauseWait,
  resumeWait,
  markSeen,
  startWait
} from '../db/waits.repo.js';
import { accountIdFor } from './devices.js';
import { createSessionForAccount } from './sessions.js';
import { publish } from './events.js';

/**
 * Tells every open screen on the account what the wait just became.
 *
 * Only the phase travels, not the numbers: a screen that hears this asks for
 * the wait itself, so there is one way a screen learns the clock and it cannot
 * drift from the one the server keeps.
 */
function announce(accountId, wait, { logged = false } = {}) {
  publish(accountId, { type: 'wait', phase: wait.phase, logged });
  return wait;
}

/**
 * The wait in progress.
 *
 * It belongs to the account, not the browser it was started in: a wait begun on
 * a phone is the same wait the laptop shows. Whichever device is looking, the
 * clock reads the same, because the numbers come from here.
 *
 * The phase is derived from one fact - whether the clock is currently running -
 * so no two devices can disagree about it.
 */

/**
 * How long the clock may run unwatched before the wait is offered back.
 *
 * The clock does not care whether anyone is there, so a laptop closed mid-wait
 * kept counting: real sessions of five and six hours, which are not waits at
 * all. Fifteen minutes is comfortably longer than a screen lock or a coffee
 * and far shorter than the gaps that produced those.
 *
 * Nothing is ended automatically. The person is asked, and can say it is still
 * running - a wait that is genuinely long is a real thing.
 */
const UNWATCHED_LIMIT_SECONDS = 15 * 60;

function toPublicWait(wait, stale = null) {
  if (!wait) return { phase: 'idle', waitId: null, startedAt: null, elapsedSeconds: 0, stale: null };

  const live = wait.resumedAt ? Date.now() - Date.parse(wait.resumedAt) : 0;

  return {
    phase: wait.resumedAt ? 'running' : 'paused',
    waitId: wait.waitId,
    startedAt: wait.startedAt,
    // What the clock reads right now, so a device can display it immediately.
    elapsedSeconds: Math.max(0, Math.floor((wait.accumulatedMs + live) / 1000)),
    // The same, unrounded. A screen that counts on from the whole seconds
    // starts up to a second behind, which on a wait an editor hook has just
    // opened reads as the clock not having started. Still a duration measured
    // here, so a device with its clock set wrong cannot skew it.
    elapsedMs: Math.max(0, Math.round(wait.accumulatedMs + live)),
    // The pieces a client needs to keep counting without asking again.
    accumulatedMs: wait.accumulatedMs,
    resumedAt: wait.resumedAt,
    stale
  };
}

/**
 * Whether this wait ran on with nobody watching, and when it plausibly ended.
 *
 * The best evidence is the last task cleared inside it - someone was demonstrably
 * there. Failing that, the last time a device read the wait. Either way the
 * answer is a moment that has already happened, so accepting it can only ever
 * shorten the wait.
 */
async function assessStaleness(accountId, wait) {
  // A paused clock is not accruing anything, so there is nothing to rescue.
  if (!wait?.resumedAt || !wait.lastSeenAt) return null;

  const unwatchedSeconds = Math.floor((Date.now() - Date.parse(wait.lastSeenAt)) / 1000);
  if (unwatchedSeconds < UNWATCHED_LIMIT_SECONDS) return null;

  const clearedAt = await lastCompletionAt(accountId, wait.waitId);

  // Only a completion after the clock last started tells us anything new.
  const usableCompletion =
    clearedAt && Date.parse(clearedAt) > Date.parse(wait.resumedAt) ? clearedAt : null;

  const endAt = usableCompletion ?? wait.lastSeenAt;
  const live = Math.max(0, Date.parse(endAt) - Date.parse(wait.resumedAt));

  return {
    unwatchedSeconds,
    suggestedEndAt: endAt,
    suggestedElapsedSeconds: Math.max(1, Math.round((wait.accumulatedMs + live) / 1000)),
    // So the client can say *why* it is asking.
    basis: usableCompletion ? 'last-task' : 'last-seen'
  };
}

export async function getWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  const wait = await findActiveWait(accountId);
  const stale = await assessStaleness(accountId, wait);

  /*
   * Only record the visit when there is nothing to ask about.
   *
   * Marking it here unconditionally would close the gap that proves nobody
   * was watching - so merely opening the screen to be shown the question
   * would destroy the answer to it, and the wait would bank in full.
   */
  if (wait && !stale) await markSeen(accountId);

  return toPublicWait(wait, stale);
}

export async function beginWait(rawDeviceId) {
  return beginWaitForAccount(await accountIdFor(rawDeviceId));
}

/**
 * The same, for a caller that has an account but no device.
 *
 * An agent token belongs to the account, not to a browser - an editor hook is
 * not a device that anyone paired.
 */
export async function beginWaitForAccount(accountId) {
  return announce(accountId, toPublicWait(await startWait(accountId, randomUUID())));
}

/**
 * Pause and resume are idempotent: pausing an already-paused wait is not an
 * error, it is two devices agreeing. Whatever the state ends up as is returned.
 */
export async function holdWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  await pauseWait(accountId);
  return announce(accountId, toPublicWait(await findActiveWait(accountId)));
}

export async function continueWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  await resumeWait(accountId);
  return announce(accountId, toPublicWait(await findActiveWait(accountId)));
}

/**
 * Ends the wait and logs it.
 *
 * The clear and the log are one step so that two devices pressing "end" cannot
 * both bank the same wait - the second finds nothing to end.
 */
export async function finishWait(rawDeviceId, { endAt = null } = {}) {
  return finishWaitForAccount(await accountIdFor(rawDeviceId), { endAt, deviceId: rawDeviceId });
}

/**
 * Ends the wait for an account, with or without a device behind it.
 *
 * `sessions.device_id` is nullable - a device can be unlinked without erasing
 * what it recorded - so a wait an editor hook closed logs perfectly well with
 * no device attached to it.
 */
export async function finishWaitForAccount(accountId, { endAt = null, deviceId = null, label = 'Prompt run' } = {}) {
  const finished = await clearWait(accountId, { endAt });

  if (!finished) return { session: null, wait: toPublicWait(null) };

  const session = await createSessionForAccount(accountId, {
    waitId: finished.waitId,
    startedAt: finished.startedAt,
    durationSeconds: finished.durationSeconds,
    deviceId,
    label
  });

  // `logged` so a screen knows its numbers moved, not just its clock.
  return { session, wait: announce(accountId, toPublicWait(null), { logged: true }) };
}

/**
 * Answers the question a stale wait asks.
 *
 * `keep` is not a no-op: reading the wait has already recorded that someone is
 * looking, so saying "still waiting" is what stops it being asked again.
 */
export async function resolveStaleWait(rawDeviceId, { keep = false } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  const wait = await findActiveWait(accountId);

  if (!wait) return { session: null, wait: toPublicWait(null) };

  // Someone is demonstrably here now, so the gap ends and the asking stops.
  if (keep) {
    await markSeen(accountId);
    // Every other screen showing the question can take it down.
    return { session: null, wait: announce(accountId, toPublicWait(wait, null)) };
  }

  const stale = await assessStaleness(accountId, wait);

  // Not stale any more - someone got there first. End it now rather than
  // rewinding to a moment that is no longer the right answer.
  return finishWait(rawDeviceId, { endAt: stale?.suggestedEndAt ?? null });
}
