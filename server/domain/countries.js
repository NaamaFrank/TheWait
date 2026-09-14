import { allCities } from './cities.js';

/**
 * Countries, derived from the city catalogue rather than stored separately.
 *
 * Everything needed to find and frame a country is already implied by its
 * cities: where its people are, and how far they spread. Deriving it keeps one
 * source of truth - refresh the cities and the countries follow.
 */

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/**
 * How much of a country's population the framing has to contain.
 *
 * Not all of it, deliberately. The United States would otherwise be framed to
 * fit Honolulu and Anchorage, putting the whole Pacific on screen to include
 * half a percent of its people; this frames where the country actually is.
 */
const POPULATION_COVERAGE = 0.98;

/** No country frames tighter or wider than this, in kilometres. */
const RADIUS_BOUNDS = [40, 4200];

function haversineKm(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * DEG;
  const dLng = (bLng - aLng) * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * The population-weighted middle of a set of cities.
 *
 * Averaged as vectors on the sphere rather than as latitude and longitude
 * numbers, which is what makes a country spanning the date line - Fiji, Russia -
 * average to a sensible place instead of the far side of the world.
 */
function centreOf(cities) {
  let x = 0;
  let y = 0;
  let z = 0;

  for (const city of cities) {
    const weight = Math.max(1, city.population);
    const lat = city.lat * DEG;
    const lng = city.lng * DEG;
    const cosLat = Math.cos(lat);

    x += cosLat * Math.cos(lng) * weight;
    y += cosLat * Math.sin(lng) * weight;
    z += Math.sin(lat) * weight;
  }

  const length = Math.hypot(x, y, z) || 1;

  return {
    lat: Math.asin(z / length) / DEG,
    lng: Math.atan2(y, x) / DEG
  };
}

/** The smallest radius around `centre` holding `POPULATION_COVERAGE` of the people. */
function reachOf(cities, centre) {
  const ranked = cities
    .map((city) => ({
      distance: haversineKm(centre.lat, centre.lng, city.lat, city.lng),
      population: Math.max(1, city.population)
    }))
    .sort((a, b) => a.distance - b.distance);

  const total = ranked.reduce((sum, entry) => sum + entry.population, 0);
  const needed = total * POPULATION_COVERAGE;

  let running = 0;
  for (const entry of ranked) {
    running += entry.population;
    if (running >= needed) return entry.distance;
  }

  return ranked.at(-1)?.distance ?? 0;
}

const countries = (() => {
  const grouped = new Map();

  for (const city of allCities()) {
    if (!grouped.has(city.country)) grouped.set(city.country, []);
    grouped.get(city.country).push(city);
  }

  return [...grouped.entries()]
    .map(([name, cities]) => {
      const centre = centreOf(cities);
      const reach = reachOf(cities, centre);

      return {
        // Namespaced so a country id can never be mistaken for a city id.
        id: `country:${name}`,
        name,
        lat: Number(centre.lat.toFixed(3)),
        lng: Number(centre.lng.toFixed(3)),
        population: cities.reduce((sum, city) => sum + city.population, 0),
        cityCount: cities.length,
        // A little wider than the people, so the country has some edge around it.
        radiusKm: Math.round(
          Math.max(RADIUS_BOUNDS[0], Math.min(RADIUS_BOUNDS[1], reach * 1.15 || RADIUS_BOUNDS[0]))
        )
      };
    })
    .sort((a, b) => b.population - a.population);
})();

const searchNames = countries.map((country) => country.name.toLowerCase());

export function countryCount() {
  return countries.length;
}

export function getCountry(name) {
  return countries.find((country) => country.name === name) ?? null;
}

/**
 * Ranked country search, in the same tiers the city search uses: an exact name,
 * then names starting with the query, then names merely containing it.
 */
export function searchCountries(query, limit = 4) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];

  const exact = [];
  const prefix = [];
  const contains = [];

  for (let index = 0; index < searchNames.length; index += 1) {
    const name = searchNames[index];
    const at = name.indexOf(needle);
    if (at === -1) continue;

    if (name.length === needle.length) exact.push(index);
    else if (at === 0) prefix.push(index);
    else contains.push(index);
  }

  return [...exact, ...prefix, ...contains]
    .slice(0, limit)
    .map((index) => toPublicCountry(countries[index]));
}

export function toPublicCountry(country) {
  if (!country) return null;

  return {
    kind: 'country',
    id: country.id,
    name: country.name,
    country: country.name,
    label: country.name,
    lat: country.lat,
    lng: country.lng,
    population: country.population,
    cityCount: country.cityCount,
    radiusKm: country.radiusKm
  };
}
