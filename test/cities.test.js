import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogueInfo,
  citiesNear,
  cityCount,
  featuredCities,
  getCity,
  nearestCity,
  resolveCity,
  searchCities
} from '../server/domain/cities.js';
import { cityIdForRegion } from '../server/domain/legacy-regions.js';

const LONDON = 2643743;

test('the catalogue covers the world', () => {
  assert.ok(cityCount() > 30_000, `expected a full catalogue, got ${cityCount()}`);
  assert.ok(catalogueInfo.countries > 200);
  assert.equal(catalogueInfo.minPopulation, 15_000);
  assert.match(catalogueInfo.source, /GeoNames/);
});

test('search puts the best-known city first', () => {
  const byName = (query) => searchCities(query, 5).map((city) => city.name);

  assert.equal(byName('london')[0], 'London');
  assert.equal(byName('paris')[0], 'Paris');
  assert.equal(byName('tokyo')[0], 'Tokyo');

  // Ties break on population, so the biggest Springfield leads.
  const springfields = searchCities('springfield', 3);
  assert.equal(springfields[0].name, 'Springfield');
  assert.ok(springfields[0].population > springfields[1].population);
});

test('search matches partial and mid-name queries', () => {
  assert.ok(searchCities('tel av', 3).some((city) => city.name === 'Tel Aviv'));
  assert.ok(searchCities('san fran', 3).some((city) => city.name === 'San Francisco'));
  // A later word still counts, so "york" finds New York.
  assert.ok(searchCities('york', 8).some((city) => city.name.includes('York')));
});

test('an empty search offers a spread of big cities rather than nothing', () => {
  const results = searchCities('', 10);

  assert.equal(results.length, 10);
  assert.ok(new Set(results.map((city) => city.country)).size > 4, 'not all from one country');
});

test('a search that matches nothing returns nothing', () => {
  assert.deepEqual(searchCities('zzzzzznotacity', 5), []);
});

test('labels disambiguate cities that share a name', () => {
  const parises = searchCities('paris', 5).filter((city) => city.name === 'Paris');

  assert.ok(parises.length > 1, 'there is more than one Paris');
  assert.equal(new Set(parises.map((city) => city.label)).size, parises.length, 'labels are distinct');
  assert.match(parises[0].label, /France/);
});

test('a coordinate resolves to the city people would name', () => {
  // Each of these is nearest to one of its own districts in the raw data.
  const probes = [
    ['Shanghai', 31.23, 121.47],
    ['Lagos', 6.52, 3.37],
    ['Tokyo', 35.68, 139.69],
    ['New York City', 40.71, -74.0],
    ['Berlin', 52.52, 13.4]
  ];

  for (const [expected, lat, lng] of probes) {
    assert.equal(nearestCity(lat, lng).city.name, expected);
  }
});

test('a real town near a big city keeps its own name', () => {
  // Hemel Hempstead is 40km from London and not swallowed by it.
  assert.equal(nearestCity(51.75, -0.47).city.name, 'Hemel Hempstead');
});

test('a point in open ocean still resolves to somewhere', () => {
  const { city, distanceKm } = nearestCity(0, -160);

  assert.ok(city, 'always returns a city');
  assert.ok(distanceKm > 500, 'and is honest about how far away it is');
});

test('proximity search crosses the antimeridian', () => {
  /*
   * Asked from just *west* of the date line, where the only cities within
   * range sit just *east* of it. Without the longitude wrap in the lookup grid
   * this finds nothing at all.
   */
  const near = citiesNear(-16.5, -179.6, { radiusKm: 300, limit: 10 });

  assert.ok(near.length > 0, 'the grid must wrap around 180°');
  assert.ok(near.every((city) => city.lng > 178), 'and the matches are the ones east of the line');
});

test('proximity search returns the biggest cities first', () => {
  const near = citiesNear(51.5, -0.12, { radiusKm: 300, limit: 6 });

  assert.equal(near[0].name, 'London');
  for (let i = 1; i < near.length; i += 1) {
    assert.ok(near[i - 1].population >= near[i].population, 'ordered by population');
  }
});

test('featured cities are spread across countries', () => {
  const featured = featuredCities(60);
  const countries = new Set(featured.map((city) => city.country));

  assert.equal(featured.length, 60);
  assert.ok(countries.size >= 30, `expected a global spread, got ${countries.size} countries`);

  // Straight population order would be almost entirely China and India.
  const counts = new Map();
  for (const city of featured) counts.set(city.country, (counts.get(city.country) ?? 0) + 1);
  assert.ok(Math.max(...counts.values()) <= 2, 'no country dominates');
});

test('an unknown city id falls back instead of throwing', () => {
  assert.equal(getCity(999_999_999), null);
  assert.ok(resolveCity(999_999_999), 'resolve always yields a city');
  assert.ok(resolveCity(undefined));
  assert.equal(resolveCity(LONDON).name, 'London');
});

test('every legacy region id still resolves to its city', () => {
  // Devices written before cities existed hold these; upgrading must not move
  // anyone's home town.
  const cases = [
    ['us-west', 'San Francisco'],
    ['uk-south', 'London'],
    ['jp-east', 'Tokyo'],
    ['il-central', 'Tel Aviv'],
    ['au-southeast', 'Sydney']
  ];

  for (const [regionId, expected] of cases) {
    assert.equal(getCity(cityIdForRegion(regionId))?.name, expected, regionId);
  }

  assert.equal(cityIdForRegion('not-a-region'), null);
  assert.equal(cityIdForRegion(undefined), null);
});

test('an exact name is never buried under a bigger city that merely starts with it', () => {
  /*
   * The catalogue is in population order, so a scan meets Altamira (138,749)
   * long before Alta (15,094) and Saltash before Salta. Stopping early once the
   * list looked full returned the wrong city outright.
   */
  const cases = [
    ['Alta', 'Alta'],
    ['Salta', 'Salta'],
    ['York', 'York'],
    ['Nice', 'Nice'],
    ['Lima', 'Lima']
  ];

  for (const [query, expected] of cases) {
    assert.equal(searchCities(query, 3)[0].name, expected, `searching "${query}"`);
  }
});

test('national capitals are catalogued whatever their size', () => {
  // Nuuk has 14,798 people, just under the cut-off, and is still a capital.
  const nuuk = searchCities('Nuuk', 1)[0];

  assert.equal(nuuk?.name, 'Nuuk');
  assert.ok(nuuk.population < 15_000, 'and it is genuinely below the threshold');
});

test('a city with no recorded population is still framed sanely', () => {
  // Ngerulmud, capital of Palau, is listed with a population of zero.
  const tiny = searchCities('Ngerulmud', 1)[0];

  assert.ok(tiny, 'it is in the catalogue');
  assert.equal(tiny.population, 0);
});
