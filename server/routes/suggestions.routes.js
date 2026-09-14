import { config } from '../config.js';
import { readJsonBody } from '../http/body.js';
import { getMeta } from '../domain/suggestions.js';
import {
  blockSuggestionFor,
  buildQueue,
  createUserTask,
  getUserTasks,
  removeUserTask,
  skipSuggestion
} from '../domain/queue.js';

/**
 * What to do while you wait.
 *
 * The queue is built per account rather than drawn straight from the
 * catalogue: it knows what you have turned down, what you keep doing, and what
 * you wrote yourself.
 */
export function registerSuggestionRoutes(router) {
  router.get('/api/suggestions/meta', () => getMeta());

  router.get('/api/suggestions', ({ deviceId, query }) =>
    buildQueue(deviceId, {
      seconds: query.get('seconds'),
      category: query.get('category'),
      count: query.get('count'),
      exclude: (query.get('exclude') ?? '').split(',').filter(Boolean)
    })
  );

  /*
   * "Next" used to record nothing, which made the most-pressed button in the
   * app the one it learned least from.
   */
  router.post('/api/suggestions/skip', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return skipSuggestion(deviceId, body?.suggestionId);
  });

  /** A decision rather than a mood: this one, never again. */
  router.post('/api/suggestions/block', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return blockSuggestionFor(deviceId, body?.suggestionId, body?.blocked);
  });

  /* --- Tasks you wrote yourself ----------------------------------------- */

  router.get('/api/tasks', ({ deviceId }) => getUserTasks(deviceId));

  router.post('/api/tasks', async ({ req, deviceId }) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return createUserTask(deviceId, { title: body?.title, bucket: body?.bucket });
  });

  router.delete('/api/tasks/:id', ({ deviceId, params }) => removeUserTask(deviceId, params.id));
}
