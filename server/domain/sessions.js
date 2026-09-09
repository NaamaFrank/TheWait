import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { sessionStore } from '../db/index.js';
import { ensureDevice } from './devices.js';
import { resolveRegion } from './regions.js';
import { clampInt, optionalText, requireDeviceId, requireIsoDate, requireNumber } from './validate.js';

const DEFAULT_LABEL = 'Prompt run';

/** Shapes a stored record for the client - the device id never leaves the server. */
function toPublicSession(record) {
  return {
    id: record.id,
    label: record.label,
    durationSeconds: record.durationSeconds,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    regionId: record.regionId
  };
}

export async function listSessions(rawDeviceId, { limit = 50 } = {}) {
  const deviceId = requireDeviceId(rawDeviceId);
  const records = await sessionStore.all((session) => session.deviceId === deviceId);

  return records
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, clampInt(limit, 50, { min: 1, max: 500 }))
    .map(toPublicSession);
}

/** Raw records for the analytics layer - stays inside the server. */
export function readSessionRecords(deviceId) {
  return sessionStore.all((session) => session.deviceId === deviceId);
}

export async function createSession(rawDeviceId, payload) {
  const deviceId = requireDeviceId(rawDeviceId);
  const device = await ensureDevice(deviceId);

  const durationSeconds = Math.round(
    requireNumber(payload.durationSeconds, 'durationSeconds', { min: 0, max: config.maxSessionSeconds })
  );

  const startedAt = requireIsoDate(payload.startedAt, 'startedAt', () => new Date(Date.now() - durationSeconds * 1000));
  const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();

  const record = {
    id: randomUUID(),
    deviceId,
    label: optionalText(payload.label, 'label', 80) ?? DEFAULT_LABEL,
    durationSeconds,
    startedAt,
    endedAt,
    regionId: resolveRegion(payload.regionId ?? device.regionId).id,
    createdAt: new Date().toISOString()
  };

  await sessionStore.insert(record, {
    limit: config.maxSessionsPerDevice,
    scope: (session) => session.deviceId === deviceId
  });

  return toPublicSession(record);
}

export async function deleteSession(rawDeviceId, sessionId) {
  const deviceId = requireDeviceId(rawDeviceId);
  const removed = await sessionStore.remove(
    (session) => session.deviceId === deviceId && session.id === sessionId
  );

  return { removed };
}
