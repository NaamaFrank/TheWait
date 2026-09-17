import { searchCities, toPublicCity } from './cities.js';
import { searchCountries } from './countries.js';
import { clampInt } from './validate.js';

/**
 * Somewhere you can look at: a city, or a whole country.
 *
 * The two catalogues are searched separately and then merged, with countries
 * first. There are only 244 of them against 31,000 cities, and someone typing
 * "Israel" wants the country rather than whichever town happens to contain
 * those letters - while "Paris" matches no country at all and is unaffected.
 */

/** At most this many countries before cities take over the list. */
const COUNTRY_SLOTS = 3;

export const PLACE_KINDS = ['city', 'country'];

export function searchPlaces(query, { limit = 8, kinds = PLACE_KINDS } = {}) {
  const wanted = clampInt(limit, 8, { min: 1, max: 30 });
  const allowed = new Set(kinds);

  const countries = allowed.has('country')
    ? searchCountries(query, Math.min(COUNTRY_SLOTS, wanted))
    : [];

  const cities = allowed.has('city')
    ? searchCities(query, wanted - countries.length).map((city) => ({ kind: 'city', ...city }))
    : [];

  return [...countries, ...cities].slice(0, wanted);
}

export { toPublicCity };
