const STORAGE_KEY = 'thewait.deviceId';

/**
 * The whole auth model: one anonymous UUID per browser, generated on first
 * launch. No account, no email, nothing to fill in.
 *
 * Falls back to an in-memory id when storage is unavailable (private mode),
 * so the app still works for the length of the visit.
 */
let memoryFallback = null;

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  // RFC 4122 v4 shape from getRandomValues, for older WebViews.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const created = newId();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    memoryFallback ??= newId();
    return memoryFallback;
  }
}

/** Short, human-readable form for display. */
export function shortDeviceId(deviceId = getDeviceId()) {
  return deviceId.slice(0, 8);
}
