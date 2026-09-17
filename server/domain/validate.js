import { badRequest } from '../http/errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !UUID_PATTERN.test(deviceId)) {
    throw badRequest('A valid anonymous device id is required (X-Device-Id header)');
  }
  return deviceId.toLowerCase();
}

/** Whether something is shaped like a UUID, without objecting if it is not. */
export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** A UUID that may be absent, for links the client is not obliged to supply. */
export function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw badRequest(`"${field}" must be a UUID when present`);
  }
  return value.toLowerCase();
}

export function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) throw badRequest(`"${field}" must be a number`);
  if (parsed < min || parsed > max) throw badRequest(`"${field}" must be between ${min} and ${max}`);

  return parsed;
}

export function optionalText(value, field, maxLength = 120) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);

  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

export function requireIsoDate(value, field, fallback = () => new Date()) {
  if (value === undefined || value === null) return fallback().toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`"${field}" must be an ISO date string`);

  return date.toISOString();
}

export function clampInt(value, fallback, { min, max }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
