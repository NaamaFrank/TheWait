import { buildLeaderboard } from '../domain/leaderboard.js';

export function registerLeaderboardRoutes(router) {
  router.get('/api/leaderboard', ({ deviceId, query }) =>
    buildLeaderboard(deviceId, {
      days: query.get('days') ?? undefined,
      tzOffsetMinutes: query.get('tzOffset') ?? 0,
      limit: query.get('limit') ?? undefined
    })
  );
}
