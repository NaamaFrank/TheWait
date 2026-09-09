import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { createSession, deleteSession, listSessions } from '../domain/sessions.js';
import { stopWaiting } from '../domain/presence.js';

export function registerSessionRoutes(router) {
  router.get('/api/sessions', async ({ deviceId, query }) => ({
    sessions: await listSessions(deviceId, { limit: query.get('limit') })
  }));

  router.post('/api/sessions', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const session = await createSession(deviceId, body);

    // Finishing a wait always ends presence, even if the client never told us.
    stopWaiting(deviceId);

    return { status: 201, body: { session } };
  });

  router.delete('/api/sessions/:id', async ({ deviceId, params }) =>
    deleteSession(deviceId, params.id)
  );
}
