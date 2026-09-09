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

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(path, location.origin);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Device-Id': getDeviceId(),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? `Request failed (${response.status})`);
  }

  return payload;
}

export const api = {
  getMe: () => request('/api/me'),
  updateMe: (patch) => request('/api/me', { method: 'POST', body: patch }),
  locate: (lat, lng) => request('/api/me/locate', { method: 'POST', body: { lat, lng } }),
  getRegions: () => request('/api/regions'),

  listSessions: (limit = 50) => request('/api/sessions', { params: { limit } }),
  createSession: (session) => request('/api/sessions', { method: 'POST', body: session }),
  deleteSession: (id) => request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getAnalytics: (days = 7) =>
    request('/api/analytics', { params: { days, tzOffset: new Date().getTimezoneOffset() } }),

  getPresence: () => request('/api/presence'),
  heartbeat: (regionId) => request('/api/presence/heartbeat', { method: 'POST', body: { regionId } }),
  stopPresence: () => request('/api/presence/stop', { method: 'POST' }),

  getSuggestions: ({ seconds, category, count, seed, exclude }) =>
    request('/api/suggestions', {
      params: { seconds, category, count, seed, exclude: exclude?.join(',') }
    })
};

export { ApiError };
