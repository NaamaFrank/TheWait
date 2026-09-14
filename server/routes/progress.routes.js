import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { buildProgress, recordCompletion } from '../domain/progress.js';

/** Reads the timezone the client is bucketing by, the same way analytics does. */
function windowFrom(query) {
  return {
    days: query.get('days') ?? undefined,
    tzOffsetMinutes: query.get('tzOffset') ?? 0
  };
}

export function registerProgressRoutes(router) {
  router.get('/api/progress', ({ deviceId, query }) => buildProgress(deviceId, windowFrom(query)));

  router.post('/api/progress/complete', async ({ req, deviceId, query }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return recordCompletion(deviceId, body, windowFrom(query));
  });
}
