import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { createAgentToken, getAgentTokens, removeAgentToken } from '../domain/agents.js';

/**
 * Connections that start and end waits for you.
 *
 * Managed from the browser with the device id, like everything else. The token
 * these hand out is a separate, weaker credential - what it may actually do is
 * enforced by the allowlist in the router, not here.
 */
export function registerAgentRoutes(router) {
  router.get('/api/agents', ({ deviceId }) => getAgentTokens(deviceId));

  router.post('/api/agents', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    // The one and only time the token is returned.
    return createAgentToken(deviceId, { label: body?.label });
  });

  router.delete('/api/agents/:id', ({ deviceId, params }) => removeAgentToken(deviceId, params.id));
}
