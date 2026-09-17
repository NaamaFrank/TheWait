import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import {
  beginWait,
  beginWaitForAccount,
  continueWait,
  finishWait,
  finishWaitForAccount,
  getWait,
  holdWait,
  resolveStaleWait
} from '../domain/wait.js';
import { stopWaiting } from '../domain/presence.js';

/**
 * The wait in progress. It belongs to the account, so every linked device sees
 * and controls the same one.
 */
export function registerWaitRoutes(router) {
  router.get('/api/wait', ({ deviceId }) => getWait(deviceId));

  /*
   * The two an agent token may call. An editor hook opens a wait when a prompt
   * is sent and closes it when the turn finishes, so the clock is never left
   * running and never has to be remembered.
   */
  router.post('/api/wait/start', ({ agent, deviceId }) =>
    agent ? beginWaitForAccount(agent.accountId) : beginWait(deviceId));
  router.post('/api/wait/pause', ({ deviceId }) => holdWait(deviceId));
  router.post('/api/wait/resume', ({ deviceId }) => continueWait(deviceId));

  router.post('/api/wait/end', async ({ agent, deviceId }) => {
    if (agent) {
      // No device, so nothing of this account's is on the globe to take down.
      return finishWaitForAccount(agent.accountId, { label: agent.label });
    }

    const result = await finishWait(deviceId);

    // A finished wait is not a wait, whatever the client told us separately.
    stopWaiting(deviceId);
    return result;
  });

  /*
   * The answer to "this ran for hours with nobody here - was it real?".
   * `keep` continues it; anything else ends it back at the moment someone was
   * last demonstrably there. The end time is decided here, not sent by the
   * client, so a device cannot claim a wait ended whenever it likes.
   */
  router.post('/api/wait/resolve-stale', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const keep = body?.keep === true;

    const result = await resolveStaleWait(deviceId, { keep });

    if (!keep) stopWaiting(deviceId);
    return result;
  });
}
