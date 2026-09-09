import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { ensureDevice } from '../domain/devices.js';
import { heartbeat, snapshot, stopWaiting } from '../domain/presence.js';

export function registerPresenceRoutes(router) {
  router.get('/api/presence', () => snapshot());

  router.post('/api/presence/heartbeat', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const device = await ensureDevice(deviceId);

    return heartbeat(deviceId, body.regionId ?? device.regionId);
  });

  router.post('/api/presence/stop', ({ deviceId }) => stopWaiting(deviceId));
}
