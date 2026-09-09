import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../public/js/core/store.js';

test('subscribers only fire for the keys they asked for', () => {
  const store = createStore({ a: 1, b: 2 });
  let aCalls = 0;
  let bCalls = 0;

  store.subscribe(() => { aCalls += 1; }, ['a']);
  store.subscribe(() => { bCalls += 1; }, ['b']);

  store.set({ a: 9 });
  assert.equal(aCalls, 1);
  assert.equal(bCalls, 0);
});

test('setting an identical value notifies nobody', () => {
  const store = createStore({ a: 1 });
  let calls = 0;

  store.subscribe(() => { calls += 1; });
  store.set({ a: 1 });

  assert.equal(calls, 0);
});

test('unsubscribe stops delivery', () => {
  const store = createStore({ a: 1 });
  let calls = 0;

  const off = store.subscribe(() => { calls += 1; });
  store.set({ a: 2 });
  off();
  store.set({ a: 3 });

  assert.equal(calls, 1);
});
