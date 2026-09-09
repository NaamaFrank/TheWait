import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/db/json-store.js';

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thewait-'));
  return { store: new JsonStore(path.join(dir, 'records.json')), dir };
}

test('records round-trip through the file', async () => {
  const { store, dir } = await tempStore();

  await store.insert({ id: 'a', deviceId: 'd1' });
  await store.insert({ id: 'b', deviceId: 'd1' });

  const reopened = new JsonStore(path.join(dir, 'records.json'));
  const all = await reopened.all();

  assert.deepEqual(all.map((r) => r.id), ['b', 'a'], 'newest first');
});

test('concurrent writes are all persisted', async () => {
  const { store, dir } = await tempStore();

  await Promise.all(
    Array.from({ length: 40 }, (_, i) => store.insert({ id: `r${i}`, deviceId: 'd1' }))
  );

  const reopened = new JsonStore(path.join(dir, 'records.json'));
  assert.equal((await reopened.all()).length, 40);
});

test('the per-scope limit trims only that scope', async () => {
  const { store } = await tempStore();

  for (let i = 0; i < 6; i += 1) {
    await store.insert({ id: `a${i}`, deviceId: 'd1' }, { limit: 3, scope: (r) => r.deviceId === 'd1' });
  }
  await store.insert({ id: 'other', deviceId: 'd2' }, { limit: 3, scope: (r) => r.deviceId === 'd2' });

  assert.equal((await store.all((r) => r.deviceId === 'd1')).length, 3);
  assert.equal((await store.all((r) => r.deviceId === 'd2')).length, 1);
});

test('upsert merges rather than duplicating', async () => {
  const { store } = await tempStore();

  await store.upsert({ deviceId: 'd1', regionId: 'us-west' }, (r) => r.deviceId === 'd1');
  await store.upsert({ deviceId: 'd1', regionId: 'jp-east' }, (r) => r.deviceId === 'd1');

  const all = await store.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].regionId, 'jp-east');
});

test('remove reports how many went', async () => {
  const { store } = await tempStore();

  await store.insert({ id: 'a', deviceId: 'd1' });
  await store.insert({ id: 'b', deviceId: 'd1' });

  assert.equal(await store.remove((r) => r.id === 'a'), 1);
  assert.equal(await store.remove((r) => r.id === 'a'), 0);
});

test('a corrupt file degrades to an empty collection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thewait-'));
  const file = path.join(dir, 'records.json');
  await fs.writeFile(file, '{ not json', 'utf8');

  const store = new JsonStore(file);
  assert.deepEqual(await store.all(), []);

  await store.insert({ id: 'fresh' });
  assert.equal((await store.all()).length, 1);
});
