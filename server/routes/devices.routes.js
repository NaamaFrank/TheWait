import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { ensureDevice, updateDevice } from '../domain/devices.js';
import { listRegions, nearestRegion } from '../domain/regions.js';
import { requireNumber } from '../domain/validate.js';

export function registerDeviceRoutes(router) {
  router.get('/api/regions', () => ({ regions: listRegions() }));

  router.get('/api/me', async ({ deviceId }) => ({ device: await ensureDevice(deviceId) }));

  router.post('/api/me', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return { device: await updateDevice(deviceId, body) };
  });

  // Resolves browser geolocation to the nearest catalogued region. Coordinates
  // are used for the lookup and deliberately not persisted.
  router.post('/api/me/locate', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const lat = requireNumber(body.lat, 'lat', { min: -90, max: 90 });
    const lng = requireNumber(body.lng, 'lng', { min: -180, max: 180 });

    const { region, distanceKm } = nearestRegion(lat, lng);
    const device = await updateDevice(deviceId, { regionId: region.id, locationMode: 'device' });

    return { device, distanceKm };
  });
}
