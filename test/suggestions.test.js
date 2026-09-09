import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketForSeconds, getMeta, pickSuggestions } from '../server/domain/suggestions.js';

test('duration maps to the right bucket', () => {
  assert.equal(bucketForSeconds(10).id, 'micro');
  assert.equal(bucketForSeconds(60).id, 'short');
  assert.equal(bucketForSeconds(299).id, 'short');
  assert.equal(bucketForSeconds(300).id, 'medium');
  assert.equal(bucketForSeconds(5000).id, 'long');
});

test('the catalogue is substantial and well formed', () => {
  const meta = getMeta();
  assert.ok(meta.total >= 150, `expected a large catalogue, got ${meta.total}`);
  assert.equal(meta.buckets.length, 4);
});

test('a seed makes the pick deterministic', () => {
  const first = pickSuggestions({ seconds: 30, seed: 'abc', count: 3 });
  const second = pickSuggestions({ seconds: 30, seed: 'abc', count: 3 });
  assert.deepEqual(first.items.map((i) => i.id), second.items.map((i) => i.id));
});

test('exclusions are respected', () => {
  const first = pickSuggestions({ seconds: 30, seed: 'abc', count: 3 });
  const excluded = first.items.map((item) => item.id);
  const second = pickSuggestions({ seconds: 30, seed: 'xyz', count: 3, exclude: excluded });

  for (const item of second.items) assert.ok(!excluded.includes(item.id));
});

test('a narrow filter still returns something', () => {
  const result = pickSuggestions({ seconds: 30, category: 'does-not-exist', count: 3 });
  assert.ok(result.items.length > 0);
});
