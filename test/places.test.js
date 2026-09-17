import assert from 'node:assert/strict';
import test from 'node:test';
import { citiesInCountry } from '../server/domain/cities.js';
import { countryCount, getCountry, searchCountries } from '../server/domain/countries.js';
import { searchPlaces } from '../server/domain/places.js';

test('countries are derived from the cities, not stored separately', () => {
  assert.ok(countryCount() > 200, `expected the world, got ${countryCount()}`);

  const israel = getCountry('Israel');
  assert.ok(israel.cityCount > 50);
  assert.ok(israel.population > 5_000_000);
});

test('a country is framed around where its people actually are', () => {
  const framings = ['Singapore', 'Israel', 'France', 'United States', 'Russia']
    .map((name) => [name, getCountry(name).radiusKm]);

  for (const [name, km] of framings) {
    assert.ok(km >= 40 && km <= 4200, `${name} framed at ${km}km, outside the bounds`);
  }

  const [[, singapore], [, israel], [, france], [, usa]] = framings;

  assert.ok(singapore < israel, 'a city-state frames tighter than a small country');
  assert.ok(israel < france, 'a small country frames tighter than a large one');
  assert.ok(france < usa, 'and a large one tighter than a continental one');

  /*
   * Framed on population rather than territory. Fitting Honolulu and Anchorage
   * would put the whole Pacific on screen to include half a percent of the
   * country's people.
   */
  assert.ok(usa < 4000, `the United States framed at ${usa}km, which is the Pacific`);
});

test("a country's centre survives the date line", () => {
  // Averaged as vectors; averaging the numbers would put Fiji near Africa.
  const fiji = getCountry('Fiji');

  assert.ok(Math.abs(fiji.lng) > 170, `Fiji centred at ${fiji.lng}, which is the wrong ocean`);
  assert.ok(fiji.lat < -10 && fiji.lat > -25);
});

test('country search ranks the way city search does', () => {
  assert.equal(searchCountries('isr', 3)[0].name, 'Israel');
  assert.equal(searchCountries('japan', 3)[0].name, 'Japan');

  const united = searchCountries('united', 5).map((country) => country.name);
  assert.ok(united.includes('United States') && united.includes('United Kingdom'));
});

test('searching places offers countries above cities', () => {
  const results = searchPlaces('isr', { limit: 5 });

  assert.equal(results[0].kind, 'country');
  assert.equal(results[0].name, 'Israel');
  assert.ok(results.slice(1).every((place) => place.kind === 'city'), 'cities fill the rest');
});

test('a query matching no country is unaffected', () => {
  const results = searchPlaces('paris', { limit: 4 });

  assert.ok(results.every((place) => place.kind === 'city'));
  assert.equal(results[0].name, 'Paris');
});

test('the profile screen can ask for cities only', () => {
  // A country is not a home town.
  const results = searchPlaces('israel', { kinds: ['city'] });

  assert.ok(results.every((place) => place.kind === 'city'));
  assert.ok(!results.some((place) => place.name === 'Israel'));
});

test('a country can be broken into its biggest cities', () => {
  const italy = citiesInCountry('Italy', 5);

  assert.equal(italy.length, 5);
  assert.equal(italy[0].name, 'Rome');
  assert.ok(italy.every((city) => city.country === 'Italy'));

  for (let i = 1; i < italy.length; i += 1) {
    assert.ok(italy[i - 1].population >= italy[i].population, 'biggest first');
  }

  assert.deepEqual(citiesInCountry(null), []);
  assert.deepEqual(citiesInCountry('Atlantis'), []);
});
