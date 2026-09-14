import { citiesNear } from '../domain/cities.js';
import { catalogueInfo } from '../domain/cities.js';
import { countryCount } from '../domain/countries.js';
import { PLACE_KINDS, searchPlaces } from '../domain/places.js';
import { requireNumber } from '../domain/validate.js';

/**
 * The catalogues stay on the server - 31,000 cities is a fine lookup and an
 * unreasonable download - so the client asks for the handful it needs.
 */
export function registerPlaceRoutes(router) {
  router.get('/api/places', ({ query }) => {
    // `kinds=city` is how the profile screen asks for somewhere to live, since
    // a country is not a home town.
    const kinds = (query.get('kinds') ?? PLACE_KINDS.join(',')).split(',').filter(Boolean);

    return {
      catalogue: { ...catalogueInfo, countries: countryCount() },
      places: searchPlaces(query.get('q'), { limit: query.get('limit') ?? undefined, kinds })
    };
  });

  router.get('/api/cities/near', ({ query }) => ({
    cities: citiesNear(
      requireNumber(query.get('lat'), 'lat', { min: -90, max: 90 }),
      requireNumber(query.get('lng'), 'lng', { min: -180, max: 180 }),
      { radiusKm: query.get('radiusKm') ?? undefined, limit: query.get('limit') ?? undefined }
    )
  }));
}
