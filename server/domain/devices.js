import { deviceStore } from '../db/index.js';
import { DEFAULT_REGION_ID, resolveRegion } from './regions.js';
import { optionalText, requireDeviceId } from './validate.js';

/**
 * Anonymous identity. A device is created on first contact - there is no
 * sign-up, no credentials, and nothing personally identifying is stored.
 */

function toPublicDevice(record) {
  const region = resolveRegion(record.regionId);

  return {
    deviceId: record.deviceId,
    regionId: region.id,
    region,
    locationMode: record.locationMode,
    displayName: record.displayName,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt
  };
}

/** Fetches the device, creating it on first sight. Always safe to call. */
export async function ensureDevice(rawDeviceId) {
  const deviceId = requireDeviceId(rawDeviceId);
  const existing = await deviceStore.find((device) => device.deviceId === deviceId);
  const now = new Date().toISOString();

  if (existing) {
    // Touch lastSeenAt without blocking the caller on the write.
    deviceStore.upsert({ deviceId, lastSeenAt: now }, (d) => d.deviceId === deviceId).catch(() => {});
    return toPublicDevice({ ...existing, lastSeenAt: now });
  }

  const created = {
    deviceId,
    regionId: DEFAULT_REGION_ID,
    locationMode: 'manual',
    displayName: 'Anonymous Dev',
    createdAt: now,
    lastSeenAt: now
  };

  await deviceStore.upsert(created, (d) => d.deviceId === deviceId);
  return toPublicDevice(created);
}

export async function updateDevice(rawDeviceId, patch) {
  const deviceId = requireDeviceId(rawDeviceId);
  await ensureDevice(deviceId);

  const update = { deviceId, lastSeenAt: new Date().toISOString() };

  if (patch.regionId !== undefined) update.regionId = resolveRegion(patch.regionId).id;
  if (patch.locationMode !== undefined) {
    update.locationMode = patch.locationMode === 'device' ? 'device' : 'manual';
  }

  const displayName = optionalText(patch.displayName, 'displayName', 40);
  if (displayName) update.displayName = displayName;

  const saved = await deviceStore.upsert(update, (d) => d.deviceId === deviceId);
  return toPublicDevice(saved);
}
