import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { ensureDevice, updateDevice } from '../domain/devices.js';
import { stopWaiting } from '../domain/presence.js';
import { nearestCity, toPublicCity } from '../domain/cities.js';
import { requireNumber } from '../domain/validate.js';

export function registerDeviceRoutes(router) {
  router.get('/api/me', async ({ deviceId }) => ({ device: await ensureDevice(deviceId) }));

  router.post('/api/me', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const device = await updateDevice(deviceId, body);

    /*
     * Turning yourself off has to be immediate. The presence entry carries the
     * visibility it was created with, so without this a hidden device stays on
     * the globe until its next heartbeat - up to half a minute of being seen
     * after asking not to be.
     */
    if (!device.visible) stopWaiting(deviceId);

    return { device };
  });

  // Resolves browser geolocation to a city. The coordinates are used for the
  // lookup and deliberately not persisted - only the city id is.
  router.post('/api/me/locate', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const lat = requireNumber(body.lat, 'lat', { min: -90, max: 90 });
    const lng = requireNumber(body.lng, 'lng', { min: -180, max: 180 });

    const { city, distanceKm } = nearestCity(lat, lng);
    const device = await updateDevice(deviceId, { cityId: city.id, locationMode: 'device' });

    return { device, city: toPublicCity(city), distanceKm };
  });
}
