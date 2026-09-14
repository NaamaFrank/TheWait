import { randomUUID } from 'node:crypto';
import {
  endWait as clearWait,
  findActiveWait,
  pauseWait,
  resumeWait,
  startWait
} from '../db/waits.repo.js';
import { accountIdFor } from './devices.js';
import { createSession } from './sessions.js';

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

function toPublicWait(wait) {
  if (!wait) return { phase: 'idle', waitId: null, startedAt: null, elapsedSeconds: 0 };

  const live = wait.resumedAt ? Date.now() - Date.parse(wait.resumedAt) : 0;

  return {
    phase: wait.resumedAt ? 'running' : 'paused',
    waitId: wait.waitId,
    startedAt: wait.startedAt,
    // What the clock reads right now, so a device can display it immediately.
    elapsedSeconds: Math.max(0, Math.floor((wait.accumulatedMs + live) / 1000)),
    // The pieces a client needs to keep counting without asking again.
    accumulatedMs: wait.accumulatedMs,
    resumedAt: wait.resumedAt
  };
}

export async function getWait(rawDeviceId) {
  return toPublicWait(await findActiveWait(await accountIdFor(rawDeviceId)));
}

export async function beginWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  return toPublicWait(await startWait(accountId, randomUUID()));
}

/**
 * Pause and resume are idempotent: pausing an already-paused wait is not an
 * error, it is two devices agreeing. Whatever the state ends up as is returned.
 */
export async function holdWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  await pauseWait(accountId);
  return toPublicWait(await findActiveWait(accountId));
}

export async function continueWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  await resumeWait(accountId);
  return toPublicWait(await findActiveWait(accountId));
}

/**
 * Ends the wait and logs it.
 *
 * The clear and the log are one step so that two devices pressing "end" cannot
 * both bank the same wait - the second finds nothing to end.
 */
export async function finishWait(rawDeviceId) {
  const accountId = await accountIdFor(rawDeviceId);
  const finished = await clearWait(accountId);

  if (!finished) return { session: null, wait: toPublicWait(null) };

  const session = await createSession(rawDeviceId, {
    waitId: finished.waitId,
    startedAt: finished.startedAt,
    durationSeconds: finished.durationSeconds,
    label: 'Prompt run'
  });

  return { session, wait: toPublicWait(null) };
}
