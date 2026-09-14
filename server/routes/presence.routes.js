import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { ensureDevice } from '../domain/devices.js';
import { heartbeat, snapshot, stopWaiting } from '../domain/presence.js';
import { getWait } from '../domain/wait.js';

export function registerPresenceRoutes(router) {
  // The caller's own city gets generated activity too, so "my city" is not an
  // empty map. Anonymous callers simply get the global picture.
  router.get('/api/presence', async ({ deviceId, query }) => {
    const device = deviceId ? await ensureDevice(deviceId).catch(() => null) : null;

    return snapshot({
      viewerDeviceId: device ? deviceId : null,
      viewerCityId: device?.cityId ?? null,
      focusCityId: query.get('focusCityId') ?? null,
      focusCountry: query.get('focusCountry') ?? null
    });
  });

  // The profile is resolved here and handed to the presence registry, which
  // deliberately knows nothing about the database.
  router.post('/api/presence/heartbeat', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const [device, wait] = await Promise.all([ensureDevice(deviceId), getWait(deviceId)]);

    return heartbeat(deviceId, {
      // The globe shows the same number the timer does, from the same source.
      elapsedSeconds: wait.elapsedSeconds,
      running: wait.phase === 'running',
      cityId: body.cityId ?? device.cityId,
      displayName: device.displayName,
      avatar: device.avatar,
      tint: device.tint,
      visible: device.visible,
      // A status the user set wins; otherwise it follows whatever they are doing.
      doing: device.status ?? body.doing
    });
  });

  router.post('/api/presence/stop', ({ deviceId }) => stopWaiting(deviceId));
}
