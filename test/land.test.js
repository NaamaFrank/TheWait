import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isLand } from '../public/js/components/land.js';

const regions = JSON.parse(fs.readFileSync(new URL('../data/regions.json', import.meta.url), 'utf8'));

test('every catalogued region sits on land', () => {
  const offshore = regions.filter((region) => !isLand(region.lng, region.lat));
  assert.deepEqual(offshore.map((region) => region.label), []);
});

test('open ocean is not land', () => {
  const ocean = [
    ['Pacific', -150, 0], ['Atlantic', -30, 20], ['Indian', 75, -30],
    ['North Sea', 3, 57], ['Mediterranean', 18, 34], ['Gulf of Guinea', 3, 2],
    ['Caribbean', -75, 15], ['Bay of Bengal', 88, 15], ['Tasman Sea', 160, -40]
  ];

  for (const [name, lng, lat] of ocean) {
    assert.equal(isLand(lng, lat), false, `${name} should be water`);
  }
});
