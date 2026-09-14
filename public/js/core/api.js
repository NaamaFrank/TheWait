import { getDeviceId } from './identity.js';

/**
 * Single place where the app talks to the server. Every request carries the
 * anonymous device id, and failures surface as a consistent Error shape.
 */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Told after every request whether the server answered.
 *
 * This is the only code that finds out, and it finds out constantly - so the
 * status indicator listens here rather than guessing from the one fetch that
 * happens at boot.
 */
let reportReachable = () => {};

export function onReachability(listener) {
  reportReachable = listener;
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(path, location.origin);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    // Only a failed fetch means unreachable. A 500 is a server that is very
    // much there, and saying "offline" about it would send people to their
    // wifi settings over a bug.
    reportReachable(false);
    throw error;
  }

  reportReachable(true);

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? `Request failed (${response.status})`);
  }

  return payload;
}

/**
 * Sent with anything the server buckets by day or hour, so "today" and "2 PM"
 * mean what this device's clock says rather than UTC.
 */
const tzOffset = () => new Date().getTimezoneOffset();

export const api = {
  getMe: () => request('/api/me'),
  updateMe: (patch) => request('/api/me', { method: 'POST', body: patch }),
  locate: (lat, lng) => request('/api/me/locate', { method: 'POST', body: { lat, lng } }),
  searchPlaces: (q, { limit, kinds } = {}) =>
    request('/api/places', { params: { q, limit, kinds: kinds?.join(',') } }),
  citiesNear: (lat, lng, { radiusKm, limit } = {}) =>
    request('/api/cities/near', { params: { lat, lng, radiusKm, limit } }),

  listSessions: (limit = 50) => request('/api/sessions', { params: { limit } }),
  createSession: (session) => request('/api/sessions', { method: 'POST', body: session }),
  deleteSession: (id) => request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getAnalytics: (days = 7) => request('/api/analytics', { params: { days, tzOffset: tzOffset() } }),

  getPresence: ({ focusCityId, focusCountry } = {}) =>
    request('/api/presence', { params: { focusCityId, focusCountry } }),
  heartbeat: (cityId, doing) =>
    request('/api/presence/heartbeat', { method: 'POST', body: { cityId, doing } }),
  stopPresence: () => request('/api/presence/stop', { method: 'POST' }),

  getWait: () => request('/api/wait'),
  startWait: () => request('/api/wait/start', { method: 'POST' }),
  pauseWait: () => request('/api/wait/pause', { method: 'POST' }),
  resumeWait: () => request('/api/wait/resume', { method: 'POST' }),
  endWait: () => request('/api/wait/end', { method: 'POST' }),

  createPairingCode: () => request('/api/pair', { method: 'POST' }),
  cancelPairingCode: () => request('/api/pair/cancel', { method: 'POST' }),
  claimPairingCode: (code) => request('/api/pair/claim', { method: 'POST', body: { code } }),

  getProgress: (days = 7) => request('/api/progress', { params: { days, tzOffset: tzOffset() } }),
  completeSuggestion: (suggestionId, waitId) =>
    request('/api/progress/complete', {
      method: 'POST',
      params: { tzOffset: tzOffset() },
      body: { suggestionId, waitId }
    }),

  getLeaderboard: (days = 7) => request('/api/leaderboard', { params: { days, tzOffset: tzOffset() } }),

  getSuggestions: ({ seconds, category, count, seed, exclude }) =>
    request('/api/suggestions', {
      params: { seconds, category, count, seed, exclude: exclude?.join(',') }
    }),

  getSuggestionMeta: () => request('/api/suggestions/meta')
};

export { ApiError };
