/**
 * Builds `data/cities.json` from GeoNames.
 *
 * Source: https://download.geonames.org/export/dump/ (CC BY 4.0).
 * Run with `npm run cities`. The output is committed, so this only needs
 * running to refresh the data - the app never downloads anything at runtime.
 *
 * The catalogue is written as parallel arrays with interned country and region
 * names. Storing 34,000 rows as objects would triple the file for no benefit;
 * `server/domain/cities.js` rebuilds records from these on load.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BASE = 'https://download.geonames.org/export/dump';
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** Smallest place to include. 15,000 is GeoNames' own "real town" cut-off. */
const MIN_POPULATION = 15_000;

/**
 * Feature codes to leave out.
 *
 * `PPLX` is a *section* of a place - Yoyogi, Mitte, Financial District - and
 * including them means "nearest city to Tokyo" answers with a neighbourhood and
 * a search for Paris offers its arrondissements. The rest are places nobody
 * lives in any more.
 */
const SKIP_CODES = new Set([
  'PPLX', // section of a populated place
  'PPLH', // historical
  'PPLQ', // abandoned
  'PPLW', // destroyed
  'PPLR' // religious settlement
]);

/** Coordinates to three decimals - about 100m, far finer than a city needs. */
const PRECISION = 3;

async function download(name) {
  process.stdout.write(`  fetching ${name}… `);
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  return buffer;
}

/**
 * Extracts the single member of a zip archive.
 *
 * A GeoNames city dump is one deflated file with no compression tricks, so the
 * local header is enough to find the payload and `inflateRaw` handles the rest.
 * That avoids a zip dependency for a one-entry archive.
 */
function unzipSingle(buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip archive');

  const method = buffer.readUInt16LE(8);
  const nameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;

  // Payload runs to the central directory, which the end record points at.
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const centralDirectory = buffer.readUInt32LE(endOffset + 16);
  const payload = buffer.subarray(start, centralDirectory);

  return method === 0 ? payload : zlib.inflateRawSync(payload);
}

function parseCountries(text) {
  const names = new Map();

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const columns = line.split('\t');
    if (columns.length > 4) names.set(columns[0], columns[4]);
  }

  return names;
}

/** `US.CA` -> `California`. */
function parseAdmin1(text) {
  const names = new Map();

  for (const line of text.split('\n')) {
    if (!line) continue;
    const columns = line.split('\t');
    if (columns.length > 1) names.set(columns[0], columns[1]);
  }

  return names;
}

function build() {
  return (async () => {
    console.log('Building the city catalogue from GeoNames.\n');

    const [archive, countryText, adminText] = await Promise.all([
      download('cities15000.zip'),
      download('countryInfo.txt').then((b) => b.toString('utf8')),
      download('admin1CodesASCII.txt').then((b) => b.toString('utf8'))
    ]);

    const countryNames = parseCountries(countryText);
    const adminNames = parseAdmin1(adminText);
    const rows = unzipSingle(archive).toString('utf8').split('\n');

    // Interned lookup tables; cities reference them by index.
    const countries = [];
    const countryIndex = new Map();
    const regions = [];
    const regionIndex = new Map();

    const intern = (list, index, value) => {
      if (value === null) return -1;
      if (!index.has(value)) {
        index.set(value, list.length);
        list.push(value);
      }
      return index.get(value);
    };

    const cities = [];

    for (const line of rows) {
      if (!line) continue;
      const c = line.split('\t');

      const population = Number(c[14]);
      if (!Number.isFinite(population)) continue;
      if (SKIP_CODES.has(c[7])) continue;

      // A national capital is somewhere people look for by name, so it stays in
      // whatever its size - Nuuk has 14,798 people and was falling just short.
      if (population < MIN_POPULATION && c[7] !== 'PPLC') continue;

      const countryCode = c[8];
      const countryName = countryNames.get(countryCode);
      if (!countryName) continue;

      const adminKey = `${countryCode}.${c[10]}`;
      const regionName = adminNames.get(adminKey) ?? null;

      cities.push({
        id: Number(c[0]),
        name: c[1],
        country: intern(countries, countryIndex, countryName),
        region: intern(regions, regionIndex, regionName),
        lat: Number(Number(c[4]).toFixed(PRECISION)),
        lng: Number(Number(c[5]).toFixed(PRECISION)),
        population
      });
    }

    // Biggest first: search ranking and the featured set both want this order,
    // so paying for the sort once here keeps it out of the request path.
    cities.sort((a, b) => b.population - a.population);

    const catalogue = {
      source: 'GeoNames (https://www.geonames.org), CC BY 4.0',
      built: new Date().toISOString().slice(0, 10),
      minPopulation: MIN_POPULATION,
      countries,
      regions,
      // Parallel arrays, one entry per city, in population order.
      ids: cities.map((city) => city.id),
      names: cities.map((city) => city.name),
      countryOf: cities.map((city) => city.country),
      regionOf: cities.map((city) => city.region),
      lats: cities.map((city) => city.lat),
      lngs: cities.map((city) => city.lng),
      populations: cities.map((city) => city.population)
    };

    const target = path.join(dataDir, 'cities.json');
    fs.writeFileSync(target, JSON.stringify(catalogue));

    const size = fs.statSync(target).size;
    console.log(`\n${cities.length.toLocaleString()} cities across ${countries.length} countries`);
    console.log(`${path.relative(process.cwd(), target)} -> ${(size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`largest: ${cities[0].name} (${cities[0].population.toLocaleString()})`);
    console.log(`smallest: ${cities.at(-1).name} (${cities.at(-1).population.toLocaleString()})`);
  })();
}

build().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
