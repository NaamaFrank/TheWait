import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The server has to be able to start.
 *
 * A route module was deleted without its import being removed, which meant
 * `createApp` threw on load and every request failed - while the unit tests,
 * none of which import it, went on passing. This imports it.
 */

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

test('the app builds', async () => {
  const { createApp } = await import('../server/app.js');
  assert.equal(typeof createApp(), 'function', 'a request listener');
});

test('every module the server imports exists', () => {
  const missing = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.js')) continue;

      const source = fs.readFileSync(full, 'utf8');
      for (const [, specifier] of source.matchAll(/from\s+'(\.[^']+)'/g)) {
        const target = path.resolve(path.dirname(full), specifier);
        if (!fs.existsSync(target)) missing.push(`${path.relative(serverDir, full)} -> ${specifier}`);
      }
    }
  };

  walk(serverDir);
  assert.deepEqual(missing, [], `imports pointing at nothing: ${missing.join(', ')}`);
});
