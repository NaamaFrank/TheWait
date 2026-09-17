import { randomUUID } from 'node:crypto';
import {
  countDevices,
  createAccountForDevice,
  findAccountByDevice,
  isUntouchedAccount,
  touchAccount,
  updateAccount
} from '../db/accounts.repo.js';
import { badRequest } from '../http/errors.js';
import { AVATARS, TINTS, defaultAvatar } from './people.js';
import { DEFAULT_CITY_ID, resolveCity, toPublicCity } from './cities.js';
import { optionalText, requireDeviceId } from './validate.js';

export { TINTS };

/**
 * Anonymous identity.
 *
 * An account is created on first contact - there is no sign-up, no credentials,
 * and nothing personally identifying is stored beyond whatever display name the
 * user chooses to type.
 *
 * The account, not the device, is the person. A device is one way of reaching
 * it, and a second one can be attached with a pairing code, which is what stops
 * the same person on a phone and a laptop being two strangers.
 */


function toPublicDevice(record, { deviceCount = 1, isNew = false } = {}) {
  const city = resolveCity(cityIdOf(record));

  return {
    // The account id is what everything else is keyed by. It is not a
    // credential - the device id in the header is - so it is safe to return.
    accountId: record.accountId,
    cityId: city.id,
    city: toPublicCity(city),
    locationMode: record.locationMode,
    displayName: record.displayName,
    // What other people see under your name while you are waiting.
    status: record.status ?? null,
    tint: record.tint,
    // Opt-out switch for the globe. Nothing about an invisible account is
    // published in the presence snapshot or on the leaderboard.
    visible: record.visible !== false,
    // So the profile screen can say "linked to 2 devices".
    deviceCount,
    // Whether this account has never been used - the cue to offer linking.
    isNew,
    // Public: this is what every other viewer sees on the globe too.
    avatar: record.avatar ?? defaultAvatar(record.accountId),
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt
  };
}

/**
 * The city a stored record refers to.
 *
 * Records written before the app knew about cities hold one of 29 region ids;
 * those are translated on read, so nobody's home town moves on upgrade.
 */
function cityIdOf(record) {
  return record.cityId ?? DEFAULT_CITY_ID;
}

/** The account a device reaches, for callers that need only the id. */
export async function accountIdFor(rawDeviceId) {
  const account = await ensureDevice(rawDeviceId);
  return account.accountId;
}

/**
 * A name derived from the device id, so a fresh install is never nameless and
 * two of them are still told apart on the board.
 */
function defaultName(deviceId) {
  return `anon_${deviceId.slice(0, 6)}`;
}

/** Deterministic, so a device keeps the same pin colour until it picks one. */
function defaultTint(deviceId) {
  const sum = [...deviceId].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return TINTS[sum % TINTS.length];
}

/** Fetches the device, creating it on first sight. Always safe to call. */
export async function ensureDevice(rawDeviceId) {
  const deviceId = requireDeviceId(rawDeviceId);
  const existing = await findAccountByDevice(deviceId);

  if (existing) {
    // Touch lastSeenAt without blocking the caller on the write.
    touchAccount(existing.accountId).catch(() => {});

    const [deviceCount, isNew] = await Promise.all([
      countDevices(existing.accountId),
      isUntouchedAccount(existing.accountId)
    ]);

    return toPublicDevice(existing, { deviceCount, isNew });
  }

  const created = await createAccountForDevice({
    deviceId,
    account: {
      accountId: randomUUID(),
      cityId: DEFAULT_CITY_ID,
      locationMode: 'manual',
      displayName: defaultName(deviceId),
      tint: defaultTint(deviceId),
      avatar: defaultAvatar(deviceId),
      visible: true
    }
  });

  return toPublicDevice(created, { deviceCount: 1, isNew: true });
}

export async function updateDevice(rawDeviceId, patch) {
  const deviceId = requireDeviceId(rawDeviceId);
  const current = await ensureDevice(deviceId);

  const update = {};

  if (patch.cityId !== undefined) update.cityId = resolveCity(patch.cityId).id;
  if (patch.locationMode !== undefined) {
    update.locationMode = patch.locationMode === 'device' ? 'device' : 'manual';
  }

  const displayName = optionalText(patch.displayName, 'displayName', 40);
  if (displayName) update.displayName = displayName;

  // Deliberately clearable: sending an empty status goes back to the default.
  if (patch.status !== undefined) update.status = optionalText(patch.status, 'status', 70);

  if (patch.tint !== undefined) {
    if (!TINTS.includes(patch.tint)) throw badRequest('"tint" must be one of the offered pin colours');
    update.tint = patch.tint;
  }

  if (patch.avatar !== undefined) {
    if (!AVATARS.includes(patch.avatar)) throw badRequest('"avatar" must be one of the offered characters');
    update.avatar = patch.avatar;
  }

  if (patch.visible !== undefined) update.visible = Boolean(patch.visible);

  const saved = await updateAccount(current.accountId, update);
  return toPublicDevice(saved, { deviceCount: current.deviceCount });
}
