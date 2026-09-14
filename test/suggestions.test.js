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

/**
 * Version skew between the running server and the client.
 *
 * The catalogue is read once at boot, so a server left running across a change
 * to `data/suggestions.json` keeps serving the previous shape. That is what put
 * "Did it +undefined" on screen, so the client now refuses those items.
 */
test('a task card rejects payloads from an older server build', async () => {
  const { isRenderable } = await import('../public/js/screens/wait.js');
  const { pickSuggestions } = await import('../server/domain/suggestions.js');

  // The exact shape the pre-XP server returned.
  const oldShape = {
    id: 's083',
    bucket: 'short',
    category: 'craft',
    text: 'Pin the dependency version you have been getting away with.',
    categoryLabel: 'Craft',
    accent: 'violet',
    iconName: 'code',
    bucketLabel: '1-5 minutes'
  };

  assert.equal(isRenderable(oldShape), false, 'no title, tag or xp');
  assert.equal(isRenderable(null), false);
  assert.equal(isRenderable({ ...oldShape, title: 'x', tag: 'Craft' }), false, 'xp is still missing');
  assert.equal(isRenderable({ id: 'a', title: 'x', tag: 'Craft', xp: 0 }), true, 'a free task is still valid');

  // And everything the current server actually serves is renderable.
  const { items } = pickSuggestions({ seconds: 120, count: 12, seed: 'shape' });
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(isRenderable(item), true, `${item.id} should render`);
  }
});
