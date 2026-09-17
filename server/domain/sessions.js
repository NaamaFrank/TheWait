import { randomUUID } from 'node:crypto';
import { findAccounts } from '../db/accounts.repo.js';
import { config } from '../config.js';
import { allSessionsFor, deleteSession as removeSession, insertSession, listSessionsFor } from '../db/sessions.repo.js';
import { accountIdFor, ensureDevice } from './devices.js';
import { resolveCity } from './cities.js';
import { clampInt, optionalText, optionalUuid, requireDeviceId, requireIsoDate, requireNumber } from './validate.js';

const DEFAULT_LABEL = 'Prompt run';

/** Shapes a stored record for the client - the device id never leaves the server. */
function toPublicSession(record) {
  return {
    id: record.id,
    waitId: record.waitId ?? null,
    label: record.label,
    durationSeconds: record.durationSeconds,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    cityId: record.cityId ?? null,
    tasksCleared: record.tasksCleared ?? 0
  };
}

export async function listSessions(rawDeviceId, { limit = 50 } = {}) {
  const accountId = await accountIdFor(rawDeviceId);
  const records = await listSessionsFor(accountId, clampInt(limit, 50, { min: 1, max: 500 }));

  return records.map(toPublicSession);
}

/** Raw records for the analytics layer - stays inside the server. */
export function readSessionRecords(accountId) {
  return allSessionsFor(accountId);
}

export async function createSession(rawDeviceId, payload) {
  const deviceId = requireDeviceId(rawDeviceId);
  const device = await ensureDevice(deviceId);

  return createSessionForAccount(device.accountId, { ...payload, deviceId, cityId: payload.cityId ?? device.cityId });
}

/**
 * Logs a wait against an account, with or without a device behind it.
 *
 * An agent token has no device - an editor hook is not a browser anybody
 * paired - and `sessions.device_id` is nullable precisely so history can
 * outlive the device that recorded it.
 */
export async function createSessionForAccount(accountId, payload) {
  const deviceId = payload.deviceId ?? null;
  // Without a device there is nobody to ask where this happened, so the
  // account's own city stands in - the same one the globe already pins you to.
  const [account] = deviceId ? [] : await findAccounts([accountId]);
  const fallbackCity = account?.cityId ?? null;

  const durationSeconds = Math.round(
    requireNumber(payload.durationSeconds, 'durationSeconds', { min: 0, max: config.maxSessionSeconds })
  );

  const startedAt = requireIsoDate(payload.startedAt, 'startedAt', () => new Date(Date.now() - durationSeconds * 1000));
  const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();

  const record = {
    id: randomUUID(),
    accountId,
    // The client's id for this wait, which the tasks cleared during it also
    // carry. That link is what ties a wait to what was done in it.
    waitId: optionalUuid(payload.waitId, 'waitId'),
    deviceId,
    label: optionalText(payload.label, 'label', 80) ?? DEFAULT_LABEL,
    durationSeconds,
    startedAt,
    endedAt,
    cityId: resolveCity(payload.cityId ?? fallbackCity).id
  };

  await insertSession(record, { keep: config.maxSessionsPerDevice });
  return toPublicSession(record);
}

export async function deleteSession(rawDeviceId, sessionId) {
  const accountId = await accountIdFor(rawDeviceId);
  return { removed: await removeSession(accountId, sessionId) };
}
