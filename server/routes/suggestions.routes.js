import { getMeta, pickSuggestions } from '../domain/suggestions.js';

export function registerSuggestionRoutes(router) {
  router.get('/api/suggestions/meta', () => getMeta());

  router.get('/api/suggestions', ({ query }) =>
    pickSuggestions({
      seconds: query.get('seconds'),
      category: query.get('category'),
      count: query.get('count'),
      seed: query.get('seed'),
      exclude: (query.get('exclude') ?? '').split(',').filter(Boolean)
    })
  );
}
