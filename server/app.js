import { config } from './config.js';
import { Router } from './http/router.js';
import { createStaticHandler } from './http/static.js';
import { registerAnalyticsRoutes } from './routes/analytics.routes.js';
import { registerPairingRoutes } from './routes/pairing.routes.js';
import { registerPlaceRoutes } from './routes/places.routes.js';
import { registerDeviceRoutes } from './routes/devices.routes.js';
import { registerLeaderboardRoutes } from './routes/leaderboard.routes.js';
import { registerPresenceRoutes } from './routes/presence.routes.js';
import { registerProgressRoutes } from './routes/progress.routes.js';
import { registerSessionRoutes } from './routes/sessions.routes.js';
import { registerSuggestionRoutes } from './routes/suggestions.routes.js';
import { registerAgentRoutes } from './routes/agents.routes.js';
import { registerWaitRoutes } from './routes/wait.routes.js';

/** Builds the request listener. Kept free of `listen` so tests can drive it directly. */
export function createApp() {
  const router = new Router();

  router.get('/api/health', () => ({ ok: true, time: new Date().toISOString() }));

  registerDeviceRoutes(router);
  registerPlaceRoutes(router);
  registerPairingRoutes(router);
  registerSessionRoutes(router);
  registerWaitRoutes(router);
  registerAgentRoutes(router);
  registerAnalyticsRoutes(router);
  registerPresenceRoutes(router);
  registerSuggestionRoutes(router);
  registerProgressRoutes(router);
  registerLeaderboardRoutes(router);

  router.fallback(createStaticHandler(config.publicDir));

  return router.toListener();
}
