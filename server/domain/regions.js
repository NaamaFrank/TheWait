import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** Static reference data - read once at boot. */
const regions = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'regions.json'), 'utf8'));
const byId = new Map(regions.map((region) => [region.id, region]));

export const DEFAULT_REGION_ID = 'us-west';

export function listRegions() {
  return regions;
}

export function getRegion(regionId) {
  return byId.get(regionId) ?? null;
}

export function resolveRegion(regionId) {
  return byId.get(regionId) ?? byId.get(DEFAULT_REGION_ID);
}

/** Nearest catalogued region to a coordinate, using great-circle distance. */
export function nearestRegion(lat, lng) {
  let best = null;
  let bestDistance = Infinity;

  for (const region of regions) {
    const distance = haversineKm(lat, lng, region.lat, region.lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }

  return { region: best, distanceKm: Math.round(bestDistance) };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}
