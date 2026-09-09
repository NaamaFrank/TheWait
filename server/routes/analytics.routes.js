import { buildAnalytics } from '../domain/analytics.js';

export function registerAnalyticsRoutes(router) {
  router.get('/api/analytics', async ({ deviceId, query }) =>
    buildAnalytics(deviceId, {
      days: query.get('days'),
      tzOffsetMinutes: query.get('tzOffset')
    })
  );
}
