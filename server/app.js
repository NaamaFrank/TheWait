import { config } from './config.js';
import { Router } from './http/router.js';
import { createStaticHandler } from './http/static.js';
import { registerAnalyticsRoutes } from './routes/analytics.routes.js';
import { registerDeviceRoutes } from './routes/devices.routes.js';
import { registerPresenceRoutes } from './routes/presence.routes.js';
import { registerSessionRoutes } from './routes/sessions.routes.js';
import { registerSuggestionRoutes } from './routes/suggestions.routes.js';

/** Builds the request listener. Kept free of `listen` so tests can drive it directly. */
export function createApp() {
  const router = new Router();

  router.get('/api/health', () => ({ ok: true, time: new Date().toISOString() }));

  registerDeviceRoutes(router);
  registerSessionRoutes(router);
  registerAnalyticsRoutes(router);
  registerPresenceRoutes(router);
  registerSuggestionRoutes(router);

  router.fallback(createStaticHandler(config.publicDir));

  return router.toListener();
}
