import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, resetPresence, snapshot, stopWaiting } from '../server/domain/presence.js';

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';

beforeEach(resetPresence);

test('a heartbeat registers exactly one real waiter', () => {
  const result = heartbeat(DEVICE_A, 'uk-south');

  assert.equal(result.realWaiting, 1);
  assert.equal(result.regions.find((r) => r.id === 'uk-south').realWaiting, 1);
});

test('repeat heartbeats from one device do not double count', () => {
  heartbeat(DEVICE_A, 'uk-south');
  const result = heartbeat(DEVICE_A, 'uk-south');

  assert.equal(result.realWaiting, 1);
});

test('separate devices accumulate', () => {
  heartbeat(DEVICE_A, 'uk-south');
  const result = heartbeat(DEVICE_B, 'jp-east');

  assert.equal(result.realWaiting, 2);
});

test('stopping removes the waiter', () => {
  heartbeat(DEVICE_A, 'uk-south');
  assert.equal(stopWaiting(DEVICE_A).realWaiting, 0);
});

test('simulated activity is reported separately from real waiters', () => {
  const result = snapshot();

  assert.equal(result.realWaiting, 0);
  assert.ok(result.simulatedWaiting > 0, 'ambient activity should be present');
  assert.equal(result.totalWaiting, result.realWaiting + result.simulatedWaiting);
});

test('an unknown region falls back rather than throwing', () => {
  const result = heartbeat(DEVICE_A, 'not-a-region');
  assert.equal(result.realWaiting, 1);
});

test('a malformed device id is rejected', () => {
  assert.throws(() => heartbeat('nope', 'uk-south'), /device id/);
});
