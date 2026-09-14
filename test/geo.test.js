import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildGraticule, createProjector, decodeCountries } from '../public/js/components/geo.js';
import { featuredCities } from '../server/domain/cities.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The city checks use the detailed atlas: at 110m a small coastal city can
// legitimately fall outside a coarse coastline.
const atlas = JSON.parse(fs.readFileSync(path.join(rootDir, 'public/data/countries-50m.json'), 'utf8'));

const DEG = 180 / Math.PI;
const { land, borders } = decodeCountries(atlas);

/** The renderer stores unit-sphere xyz; tests want degrees back. */
function toLonLat(xyz, index) {
  const x = xyz[index * 3];
  const y = xyz[index * 3 + 1];
  const z = xyz[index * 3 + 2];

  return [Math.atan2(y, x) * DEG, Math.asin(z) * DEG];
}

function ringToLonLat(xyz) {
  return Array.from({ length: xyz.length / 3 }, (_, index) => toLonLat(xyz, index));
}

/**
 * Odd-even ray casting. Exterior rings and hole rings are both in `land`, so a
 * point inside a country but inside one of its lakes is contained by two rings
 * and correctly comes out as water.
 */
function ringsContaining(lng, lat) {
  let count = 0;

  for (const ring of land) {
    const points = ringToLonLat(ring);
    let inside = false;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];

      // Skip segments that wrap the antimeridian; they are not near our probes.
      if (Math.abs(xi - xj) > 180) continue;

      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }

    if (inside) count += 1;
  }

  return count;
}

const isLand = (lng, lat) => ringsContaining(lng, lat) % 2 === 1;

test('the atlas decodes into closed rings on the unit sphere', () => {
  assert.ok(land.length > 100, `expected many land rings, got ${land.length}`);
  assert.ok(borders.length > 0, 'expected shared arcs between neighbouring countries');

  for (const ring of land) {
    assert.equal(ring.length % 3, 0, 'rings are flat xyz triples');
    assert.ok(ring.length >= 12, 'a ring needs at least four points');

    for (let i = 0; i < ring.length; i += 3) {
      const norm = Math.hypot(ring[i], ring[i + 1], ring[i + 2]);
      assert.ok(Math.abs(norm - 1) < 1e-9, `point ${i / 3} is not on the unit sphere (${norm})`);
    }
  }
});

/**
 * Land, allowing for a generalised coastline.
 *
 * A port city's coordinates can fall a few kilometres offshore of a simplified
 * outline - Lagos, New York and Busan all do - so a point counts as land if
 * land is within about ten kilometres of it. Anything further out is a real
 * failure of the projection or the decoder, which is what this is guarding.
 */
function isLandOrCoast(lng, lat) {
  if (isLand(lng, lat)) return true;

  const step = 0.1; // ~11km
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    if (isLand(lng + dx * step, lat + dy * step)) return true;
  }

  return false;
}

test('every featured city sits on land, allowing for the coastline', () => {
  const wet = featuredCities(60)
    .filter((city) => !isLandOrCoast(city.lng, city.lat))
    .map((city) => `${city.name} (${city.country})`);

  assert.deepEqual(wet, [], `these cities landed in open water: ${wet.join(', ')}`);
});

test('inland cities are unambiguously on land', () => {
  const inland = [
    ['Delhi', 77.23, 28.65],
    ['Moscow', 37.62, 55.75],
    ['Madrid', -3.7, 40.42],
    ['Johannesburg', 28.04, -26.2]
  ];

  for (const [name, lng, lat] of inland) {
    assert.equal(isLand(lng, lat), true, `${name} should be on land with no allowance`);
  }
});

test('open ocean is not land', () => {
  const probes = [
    ['mid-Atlantic', -30, 25],
    ['mid-Pacific', -140, 10],
    ['Indian Ocean', 75, -30],
    ['Southern Ocean', 20, -60],
    ['North Atlantic', -40, 50]
  ];

  for (const [name, lng, lat] of probes) {
    assert.equal(isLand(lng, lat), false, `${name} should be water`);
  }
});

test('the projector puts the rotation centre in the middle, east right and north up', () => {
  const projector = createProjector();
  projector.set(0, 0, 100, 100, 50);

  const centre = projector.project(0, 0);
  assert.ok(Math.abs(centre.x - 100) < 1e-9 && Math.abs(centre.y - 100) < 1e-9);
  assert.ok(Math.abs(centre.depth - 1) < 1e-9, 'the centre faces the camera head on');

  const east = projector.project(90, 0);
  assert.ok(Math.abs(east.x - 150) < 1e-9, 'east of centre draws to the right');

  const north = projector.project(0, 90);
  assert.ok(Math.abs(north.y - 50) < 1e-9, 'north of centre draws upward');
});

test('the far side of the globe does not project', () => {
  const projector = createProjector();
  projector.set(0, 0, 100, 100, 50);

  assert.equal(projector.project(180, 0), null, 'the antipode is behind the sphere');
  assert.equal(projector.project(91, 0), null, 'just past the limb is hidden');
  assert.ok(projector.project(89, 0), 'just inside the limb is visible');
});

test('rotating brings the requested point to the centre', () => {
  const projector = createProjector();

  for (const [lon, lat] of [[139.69, 35.68], [-122.42, 37.77], [-46.63, -23.55]]) {
    projector.set(lon, lat, 160, 160, 80);
    const point = projector.project(lon, lat);

    assert.ok(Math.abs(point.x - 160) < 1e-6 && Math.abs(point.y - 160) < 1e-6);
  }
});

test('a traced polygon never leaves the drawing circle', () => {
  const projector = createProjector();
  const radius = 90;
  projector.set(20, 10, 100, 100, radius);

  const points = [];
  const context = {
    moveTo: (x, y) => points.push([x, y]),
    lineTo: (x, y) => points.push([x, y]),
    closePath: () => {}
  };

  for (const ring of land) projector.tracePolygon(context, ring);

  assert.ok(points.length > 0, 'something should have been traced');

  for (const [x, y] of points) {
    const distance = Math.hypot(x - 100, y - 100);
    assert.ok(distance <= radius + 1e-6, `point ${x},${y} escaped the globe (r=${distance})`);
  }
});

test('the graticule spans both hemispheres', () => {
  const lines = buildGraticule();
  assert.ok(lines.length >= 30, 'expected meridians and parallels');

  const lats = lines.flatMap((line) => ringToLonLat(line).map(([, lat]) => lat));
  assert.ok(Math.max(...lats) > 70, 'reaches the far north');
  assert.ok(Math.min(...lats) < -70, 'reaches the far south');
});

/**
 * Dragging the globe.
 *
 * The land must travel with the finger. These assert the direction end to end -
 * drag, then re-project a real landmark and check which way it actually moved -
 * because the camera's own coordinates run opposite to the surface, which is
 * exactly the sign that was wrong.
 */
const { dragCamera } = await import('../public/js/components/globe.js');

/** Screen position of a fixed landmark after dragging by `(dx, dy)`. */
function landmarkAfterDrag(start, dx, dy, landmark) {
  const projector = createProjector();
  const camera = dragCamera(start, dx, dy);

  projector.set(camera.lon, camera.lat, 100, 100, 80);
  return projector.project(landmark[0], landmark[1]);
}

test('the land follows the finger', () => {
  const start = { lon: -30, lat: 20 };
  const landmark = [0, 20];
  const before = landmarkAfterDrag(start, 0, 0, landmark);

  const right = landmarkAfterDrag(start, 60, 0, landmark);
  assert.ok(right.x > before.x, `dragging right must move the land right (${before.x} -> ${right.x})`);

  const left = landmarkAfterDrag(start, -60, 0, landmark);
  assert.ok(left.x < before.x, `dragging left must move the land left (${before.x} -> ${left.x})`);

  const below = [-30, 40];
  const restBelow = landmarkAfterDrag(start, 0, 0, below);
  const down = landmarkAfterDrag(start, 0, 60, below);
  assert.ok(down.y > restBelow.y, `dragging down must move the land down (${restBelow.y} -> ${down.y})`);

  const up = landmarkAfterDrag(start, 0, -60, below);
  assert.ok(up.y < restBelow.y, `dragging up must move the land up (${restBelow.y} -> ${up.y})`);
});

test('dragging is slower when zoomed in, and the tilt is bounded', () => {
  const start = { lon: 0, lat: 0 };

  const near = dragCamera(start, 100, 0, 1);
  const far = dragCamera(start, 100, 0, 3);
  assert.ok(Math.abs(far.lon) < Math.abs(near.lon), 'a zoomed-in drag covers less ground');

  assert.equal(dragCamera(start, 0, 100_000).lat, 78, 'cannot tumble past the pole');
  assert.equal(dragCamera(start, 0, -100_000).lat, -78);
});

/**
 * Zoom reach.
 *
 * The globe used to stop at 3.4x, which is a visible radius of about 1,900km -
 * continental. Drilling down to a country with its cities in it needs far more,
 * so these pin the range to what it has to be able to show.
 */
const { ZOOM_LIMITS, viewRadiusKmFor, visibleRadiusKm } = await import('../public/js/components/globe.js');

test('the zoom range spans whole-globe to town scale', () => {
  const [floor, ceiling] = ZOOM_LIMITS;

  assert.ok(floor <= 1, 'the whole globe fits at the bottom');
  assert.ok(visibleRadiusKm(ceiling) < 10, `a town needs a close view, got ${visibleRadiusKm(ceiling)}km`);
  // Nothing in the data is finer than a city, so there is no point going deeper.
  assert.ok(visibleRadiusKm(ceiling) > 1, 'but not deeper than the data can support');
});

test('every scale between continent and city is reachable', () => {
  const [floor, ceiling] = ZOOM_LIMITS;
  const scales = [
    ['continent', 3000],
    ['country', 800],
    ['metro area', 200]
  ];

  for (const [name, km] of scales) {
    const reachable = visibleRadiusKm(floor) >= km && visibleRadiusKm(ceiling) <= km;
    assert.ok(reachable, `${name} scale (~${km}km) should be within the zoom range`);
  }
});


/**
 * Framing a city.
 *
 * A single zoom cannot serve a catalogue running from towns of 15,000 to
 * Shanghai's 25 million - at Shanghai's zoom, "my city" for Tel Aviv showed the
 * whole of Israel. The view is sized from the city instead.
 */
test('the view is sized to the city, not fixed', () => {
  const framings = [
    ['a small town', 15_000],
    ['Hemel Hempstead', 94_000],
    ['Tel Aviv', 443_939],
    ['Munich', 1_260_391],
    ['London', 8_961_989],
    ['Shanghai', 24_874_500]
  ].map(([name, population]) => [name, population, viewRadiusKmFor(population)]);

  // Bigger city, wider view - always.
  for (let i = 1; i < framings.length; i += 1) {
    assert.ok(
      framings[i][2] > framings[i - 1][2],
      `${framings[i][0]} should be framed wider than ${framings[i - 1][0]}`
    );
  }

  const [, , townKm] = framings[0];
  const [, , telAvivKm] = framings[2];
  const [, , shanghaiKm] = framings.at(-1);

  assert.ok(townKm <= 10, `a small town needs a close view, got ${townKm}km`);
  // Israel is about 135km across, so Tel Aviv must sit well inside it.
  assert.ok(telAvivKm * 2 < 100, `Tel Aviv framed ${telAvivKm * 2}km, which is most of Israel`);
  assert.ok(shanghaiKm < 90, 'even the largest city stays a city, not a region');
});

test('the zoom range reaches every city size', () => {
  const [floor, ceiling] = ZOOM_LIMITS;

  // The tightest framing the model ever asks for must be inside the range.
  const tightest = viewRadiusKmFor(15_000);
  assert.ok(visibleRadiusKm(ceiling) <= tightest, `cannot reach a ${tightest}km view`);
  assert.ok(visibleRadiusKm(floor) > 5000, 'and the whole globe is still reachable');
});
