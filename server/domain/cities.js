import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { clampInt } from './validate.js';

/**
 * The world's cities: every place GeoNames lists with 15,000 people or more.
 *
 * Held in memory and never shipped to the browser whole - 34,000 rows is a
 * comfortable server-side lookup and an unreasonable download, so the client
 * asks for what it needs through `/api/cities`.
 *
 * The file stores parallel arrays with interned country and region names; they
 * are expanded into records once, here, at boot.
 */

const raw = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'cities.json'), 'utf8'));

/** San Francisco, matching the region the app used to default to. */
export const DEFAULT_CITY_ID = 5391959;

/** Cells of the lookup grid, in degrees. */
const CELL = 4;

const EARTH_RADIUS_KM = 6371;

/** Records, already ordered biggest-first by the build script. */
const cities = raw.ids.map((id, index) => ({
  id,
  name: raw.names[index],
  country: raw.countries[raw.countryOf[index]],
  region: raw.regionOf[index] === -1 ? null : raw.regions[raw.regionOf[index]],
  lat: raw.lats[index],
  lng: raw.lngs[index],
  population: raw.populations[index]
}));

const byId = new Map(cities.map((city) => [city.id, city]));

/** Lowercased once, so a search does not re-case 34,000 names per keystroke. */
const searchNames = cities.map((city) => city.name.toLowerCase());

/**
 * Coarse spatial index. Cities are bucketed into `CELL`-degree cells so a
 * proximity query touches a handful of cells instead of the whole catalogue.
 */
const grid = new Map();
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

for (const [index, city] of cities.entries()) {
  const key = cellKey(city.lat, city.lng);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(index);
}

/* --- Lookup -------------------------------------------------------------- */

export function getCity(cityId) {
  return byId.get(Number(cityId)) ?? null;
}

/** Always returns a city; unknown ids fall back to the default. */
export function resolveCity(cityId) {
  return getCity(cityId) ?? byId.get(DEFAULT_CITY_ID);
}

export function cityCount() {
  return cities.length;
}

/** Every city, for modules that derive their own view of the catalogue. */
export function allCities() {
  return cities;
}

/** The largest cities of one country, biggest first. */
export function citiesInCountry(name, limit = 6) {
  if (!name) return [];

  const wanted = clampInt(limit, 6, { min: 1, max: 60 });
  const found = [];

  // The catalogue is population-ordered, so the first matches are the biggest.
  for (const city of cities) {
    if (city.country !== name) continue;
    found.push(city);
    if (found.length === wanted) break;
  }

  return found;
}

/**
 * A spread of large cities, used to seed ambient activity and sample players.
 *
 * Straight population order is honest but makes a dull globe: the top sixty
 * cities on Earth are almost all in China and India, so every pin lands in the
 * same corner. Capping how many come from one country keeps the ranking
 * population-weighted while covering the map.
 */
export function featuredCities(count = 60, { maxPerCountry = 2 } = {}) {
  const wanted = clampInt(count, 60, { min: 1, max: 500 });
  const perCountry = new Map();
  const picked = [];

  for (const city of cities) {
    const seen = perCountry.get(city.country) ?? 0;
    if (seen >= maxPerCountry) continue;

    perCountry.set(city.country, seen + 1);
    picked.push(city);
    if (picked.length === wanted) break;
  }

  return picked;
}

/* --- Search -------------------------------------------------------------- */

/**
 * Ranked city search.
 *
 * The catalogue is in population order, so scanning it in place and keeping the
 * first matches of each tier gives "London before Londonderry" without sorting
 * anything. Tiers, best first: exact name, name starts with the query, a later
 * word starts with it, name merely contains it.
 */
export function searchCities(query, limit = 12) {
  const wanted = clampInt(limit, 12, { min: 1, max: 50 });
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return featuredCities(wanted).map(toPublicCity);

  const exact = [];
  const prefix = [];
  const word = [];
  const contains = [];

  for (let index = 0; index < searchNames.length; index += 1) {
    const name = searchNames[index];
    const at = name.indexOf(needle);
    if (at === -1) continue;

    if (name.length === needle.length) exact.push(index);
    else if (at === 0) {
      if (prefix.length < wanted) prefix.push(index);
    } else if (name[at - 1] === ' ' || name[at - 1] === '-') {
      if (word.length < wanted) word.push(index);
    } else if (contains.length < wanted) contains.push(index);

    /*
     * Only a full set of exact matches justifies stopping. Anything else and a
     * better match may still be further down: the catalogue is in population
     * order, so searching "Alta" met Altamira long before Alta itself, and
     * bailing out there returned the wrong city entirely.
     */
    if (exact.length >= wanted) break;
  }

  return [...exact, ...prefix, ...word, ...contains]
    .slice(0, wanted)
    .map((index) => toPublicCity(cities[index]));
}

/* --- Geography ----------------------------------------------------------- */

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** How many longitude cells go round the globe, and the half-width for wrapping. */
const LNG_CELLS = 360 / CELL;
const LNG_HALF = LNG_CELLS / 2;

/** Indices of every city in the cells covering `radiusCells` around a point. */
function nearbyIndices(lat, lng, radiusCells) {
  const centreLat = Math.floor(lat / CELL);
  const centreLng = Math.floor(lng / CELL);
  const found = [];

  for (let dLat = -radiusCells; dLat <= radiusCells; dLat += 1) {
    for (let dLng = -radiusCells; dLng <= radiusCells; dLng += 1) {
      // Longitude wraps round the antimeridian; latitude simply runs out.
      const wrapped = (((centreLng + dLng + LNG_HALF) % LNG_CELLS) + LNG_CELLS) % LNG_CELLS - LNG_HALF;
      const bucket = grid.get(`${centreLat + dLat}:${wrapped}`);
      if (bucket) found.push(...bucket);
    }
  }

  return found;
}

/** How far away a much larger neighbour can still claim a point, in km. */
const METRO_RADIUS_KM = 30;

/** How much bigger that neighbour has to be before it wins. */
const METRO_DOMINANCE = 3;

/**
 * The city a coordinate belongs to.
 *
 * Not simply the closest one: large cities are catalogued alongside their own
 * districts and satellites, so the nearest entry to central Shanghai is
 * Huangpu and the nearest to Lagos is Shomolu. When a substantially larger
 * city is also within reach, that is the answer people expect. A genuine small
 * town keeps its own name, because the neighbour has to be several times its
 * size to take it.
 */
export function nearestCity(lat, lng) {
  let nearest = null;
  let nearestDistance = Infinity;
  let biggest = null;

  // Widen the net until something turns up; the last pass covers open ocean.
  for (const radius of [1, 3, 12]) {
    for (const index of nearbyIndices(lat, lng, radius)) {
      const city = cities[index];
      const distance = haversineKm(lat, lng, city.lat, city.lng);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = city;
      }

      if (distance <= METRO_RADIUS_KM && (!biggest || city.population > biggest.population)) {
        biggest = city;
      }
    }

    if (nearest) break;
  }

  if (!nearest) return { city: byId.get(DEFAULT_CITY_ID), distanceKm: 0 };

  const city = biggest && biggest.population >= nearest.population * METRO_DOMINANCE ? biggest : nearest;

  return { city, distanceKm: Math.round(haversineKm(lat, lng, city.lat, city.lng)) };
}

/**
 * The biggest cities within `radiusKm` of a point, for the globe's city layer.
 * Ordered by population so a zoomed-out view still names the places that matter.
 */
export function citiesNear(lat, lng, { radiusKm = 1200, limit = 120 } = {}) {
  const wanted = clampInt(limit, 120, { min: 1, max: 400 });
  const cells = Math.max(1, Math.ceil(radiusKm / 111 / CELL));

  const found = [];
  for (const index of nearbyIndices(lat, lng, cells)) {
    const city = cities[index];
    if (haversineKm(lat, lng, city.lat, city.lng) <= radiusKm) found.push(index);
  }

  // The catalogue is population-ordered, so a low index is a big city. Cells
  // are visited in spatial order, so this has to be re-sorted to get that back.
  found.sort((a, b) => a - b);

  return found.slice(0, wanted).map((index) => toPublicCity(cities[index]));
}

/* --- Shaping ------------------------------------------------------------- */

/** A city as the client sees it, with a label already assembled. */
export function toPublicCity(city) {
  if (!city) return null;

  return {
    id: city.id,
    name: city.name,
    region: city.region,
    country: city.country,
    label: city.region && city.region !== city.name
      ? `${city.name}, ${city.region} · ${city.country}`
      : `${city.name} · ${city.country}`,
    lat: city.lat,
    lng: city.lng,
    population: city.population
  };
}

export const catalogueInfo = {
  source: raw.source,
  built: raw.built,
  minPopulation: raw.minPopulation,
  count: cities.length,
  countries: raw.countries.length
};
