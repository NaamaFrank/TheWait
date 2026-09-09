import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourLabel } from '../public/js/core/format.js';
import { clockFace, headlineDuration, humanDuration } from '../public/js/core/format.js';

test('clock face drops the hour segment under an hour', () => {
  assert.equal(clockFace(0), '00:00');
  assert.equal(clockFace(74), '01:14');
  assert.equal(clockFace(3671), '1:01:11');
});

test('human duration scales its unit', () => {
  assert.equal(humanDuration(42), '42s');
  assert.equal(humanDuration(134), '2m 14s');
  assert.equal(humanDuration(6120), '1h 42m');
});

test('headline duration rounds to whole minutes', () => {
  assert.equal(headlineDuration(6120), '1h 42m');
  assert.equal(headlineDuration(840), '14m');
});

test('hour labels are 12-hour with meridiem', () => {
  assert.equal(hourLabel(0), '12 AM');
  assert.equal(hourLabel(14), '2 PM');
});
