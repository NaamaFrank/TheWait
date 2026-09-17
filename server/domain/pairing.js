import { claimCode, findLiveCode, insertCode, revokeCodes } from '../db/pairing.repo.js';
import { badRequest } from '../http/errors.js';
import { accountIdFor, ensureDevice } from './devices.js';
import { requireDeviceId } from './validate.js';

/**
 * Linking a second device.
 *
 * One device shows a code, the other enters it, and they become the same
 * person. No email, no password, nothing about anyone stored - which is the
 * point, because the alternative to this is a sign-up form.
 *
 * A code is a bearer token for an account: whoever holds it can join. So it is
 * short-lived, single use, and drawn from enough entropy that guessing one
 * inside its lifetime is not worth attempting.
 */

/**
 * No I, O, 0 or 1: these get read aloud and typed by hand across the room.
 * 30 symbols over 8 characters is about 6.5e11 codes.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/** Long enough to walk to the other device, short enough to matter if seen. */
const TTL_MS = 5 * 60 * 1000;

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = '';

  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];

  // Grouped for reading aloud; the group is cosmetic and stripped on the way in.
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Accepts what someone typed, however they spaced or cased it. */
export function normaliseCode(input) {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // The characters left out of the alphabet are the ones people substitute.
    .replace(/O/g, '0')
    .replace(/I/g, '1');

  if (cleaned.length !== CODE_LENGTH) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/**
 * A code for this account, reusing a live one rather than minting a second.
 * Two valid codes for one account is two chances to intercept it.
 */
export async function createPairingCode(rawDeviceId) {
  const deviceId = requireDeviceId(rawDeviceId);
  const accountId = await accountIdFor(deviceId);

  const existing = await findLiveCode(accountId);
  if (existing) return { ...existing, reused: true };

  const created = await insertCode({
    code: generateCode(),
    accountId,
    expiresAt: new Date(Date.now() + TTL_MS).toISOString()
  });

  return { ...created, reused: false };
}

/** Throws away any live code, for a "not me" button. */
export async function cancelPairingCodes(rawDeviceId) {
  await revokeCodes(await accountIdFor(rawDeviceId));
  return { cancelled: true };
}

/**
 * Joins the account a code belongs to, bringing this device's own history with
 * it rather than stranding it on an account that nothing can reach again.
 */
export async function redeemPairingCode(rawDeviceId, rawCode) {
  const deviceId = requireDeviceId(rawDeviceId);
  const code = normaliseCode(rawCode);

  if (!code) throw badRequest('That code does not look right - it is eight characters.');

  // Make sure this device has an account before moving it off one.
  const current = await ensureDevice(deviceId);
  const result = await claimCode({ code, deviceId, currentAccountId: current.accountId });

  if (!result.ok) {
    if (result.reason === 'same-account') {
      throw badRequest('That code is from this account - use it on the other device.');
    }

    throw badRequest('That code has expired or has already been used.');
  }

  // A code is spent once used, and so is any other the account had out.
  await revokeCodes(result.accountId);

  return {
    device: await ensureDevice(deviceId),
    moved: {
      sessions: Number(result.movedSessions ?? 0),
      completions: Number(result.movedCompletions ?? 0)
    }
  };
}
