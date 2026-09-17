import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { nearestCity } from './cities.js';

/**
 * Translation for records written before the app knew about cities.
 *
 * Devices and sessions used to store one of 29 hand-picked region ids
 * (`us-west`, `jp-east`). Each is resolved once, at boot, to the nearest city
 * in the catalogue, so upgrading does not silently move anyone's home town.
 *
 * Nothing writes region ids any more. This exists to read old rows, and can be
 * deleted once no install has any.
 */

const regions = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'regions.json'), 'utf8'));

const cityIdByRegion = new Map(
  regions.map((region) => [region.id, nearestCity(region.lat, region.lng).city.id])
);

/** The city a legacy region id meant, or null if it is not one of ours. */
export function cityIdForRegion(regionId) {
  if (typeof regionId !== 'string') return null;
  return cityIdByRegion.get(regionId) ?? null;
}
