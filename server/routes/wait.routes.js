import { beginWait, continueWait, finishWait, getWait, holdWait } from '../domain/wait.js';
import { stopWaiting } from '../domain/presence.js';

/**
 * The wait in progress. It belongs to the account, so every linked device sees
 * and controls the same one.
 */
export function registerWaitRoutes(router) {
  router.get('/api/wait', ({ deviceId }) => getWait(deviceId));

  router.post('/api/wait/start', ({ deviceId }) => beginWait(deviceId));
  router.post('/api/wait/pause', ({ deviceId }) => holdWait(deviceId));
  router.post('/api/wait/resume', ({ deviceId }) => continueWait(deviceId));

  router.post('/api/wait/end', async ({ deviceId }) => {
    const result = await finishWait(deviceId);

    // A finished wait is not a wait, whatever the client told us separately.
    stopWaiting(deviceId);
    return result;
  });
}
