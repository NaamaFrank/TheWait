import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The connection indicator in the status strip.
 *
 * It once read "live" all session long, whatever the timer was doing, because
 * the word was hardcoded in the markup and the code meant to replace it both
 * referenced undefined variables and only ran when the flag changed - which in
 * a healthy session it never did. Each of those is checked here separately.
 */

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** api.js builds absolute URLs and stamps a device id on every request. */
function installBrowserGlobals() {
  Object.defineProperty(globalThis, 'location', {
    value: { origin: 'http://127.0.0.1:3000' },
    configurable: true
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => 'aaaaaaaa-1111-4111-8111-111111111111', setItem() {}, removeItem() {} },
    configurable: true
  });
}

test('the markup never claims a state before anything has checked one', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const placeholders = [...html.matchAll(/<span class="js-word">([^<]*)<\/span>/g)].map((m) => m[1]);

  assert.ok(placeholders.length, 'the status strip should still be there');

  for (const word of placeholders) {
    assert.notEqual(word, 'live', 'a hardcoded "live" reads as the timer running');
    assert.notEqual(word, 'online', 'nothing has reached the server yet when this renders');
  }
});

test('the status bar is painted at startup, not only when the flag moves', () => {
  const main = fs.readFileSync(path.join(publicDir, 'js', 'main.js'), 'utf8');
  const fn = main.slice(main.indexOf('function startStatusBar'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  // The elements it writes to have to be looked up; they were free variables.
  assert.match(body, /qsa\('\.js-dot'\)/, 'the dots must be collected from the document');
  assert.match(body, /qsa\('\.js-word'\)/, 'the words must be collected from the document');

  // `subscribe` fires on change only, so there must be a direct call as well.
  assert.match(body, /paint\(store\.state\)/, 'the current state must be painted once at startup');
});

test('a failed request reports unreachable, and a reply reports reachable', async () => {
  installBrowserGlobals();
  const { api, onReachability } = await import('../public/js/core/api.js');

  const seen = [];
  onReachability((reachable) => seen.push(reachable));

  globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  await api.getAnalytics().catch(() => {});
  assert.deepEqual(seen, [false], 'a dead network is unreachable');

  globalThis.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
  await api.getAnalytics().catch(() => {});
  assert.deepEqual(seen, [false, true], 'and it recovers without a reload');
});

test('a server that answers with an error is not reported as offline', async () => {
  installBrowserGlobals();
  const { api, onReachability } = await import('../public/js/core/api.js');

  const seen = [];
  onReachability((reachable) => seen.push(reachable));

  globalThis.fetch = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  await api.getAnalytics().catch(() => {});

  // Telling someone they are offline sends them to their wifi settings over
  // what is actually a bug on the server.
  assert.deepEqual(seen, [true], 'a 500 is a server that is very much there');
});

/**
 * The wait indicator that rides alongside it.
 *
 * The timer is owned by the Wait screen, so the other five screens had no way
 * of showing that a wait was still running - and the only thing in the strip
 * was the connection, which people read as the timer. These check the three
 * links in that chain: the screen publishes, the strip subscribes, the markup
 * exists in both shells.
 */
test('the Wait screen publishes its phase for the other screens to read', () => {
  const wait = fs.readFileSync(path.join(publicDir, 'js', 'screens', 'wait.js'), 'utf8');
  const paint = wait.slice(wait.indexOf('function paint()'));

  assert.match(
    paint.slice(0, paint.indexOf('\n  }\n')),
    /store\.set\(\{ wait: \{ phase, elapsedSeconds: elapsed \} \}\)/,
    'painting the Wait screen must publish the wait'
  );
});

test('the indicator is in both shells and starts hidden', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const flags = [...html.matchAll(/<button class="wait-flag js-waitflag"([^>]*)>/g)];

  assert.equal(flags.length, 2, 'the phone strip and the desktop rail each need one');
  for (const [, attrs] of flags) {
    assert.match(attrs, /\bhidden\b/, 'there is nothing to report before a wait starts');
  }
});

test('the indicator is painted at startup and tracks the wait', () => {
  const main = fs.readFileSync(path.join(publicDir, 'js', 'main.js'), 'utf8');
  const fn = main.slice(main.indexOf('function startWaitFlag'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  assert.match(body, /store\.subscribe\(paint, \['wait', 'screen'\]\)/, 'it must follow the wait and the screen');
  assert.match(body, /paint\(store\.state\)/, 'and paint the state it starts in');
  assert.match(body, /qsa\('\.js-waitflag'\)/, 'both shells are collected by class');
});

test('the indicator stays out of the way on the Wait screen itself', () => {
  const main = fs.readFileSync(path.join(publicDir, 'js', 'main.js'), 'utf8');
  const fn = main.slice(main.indexOf('function startWaitFlag'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  // The real clock is already there, several times the size of the chip.
  assert.match(body, /state\.screen === 'wait'/, 'it must know which screen is showing');
  assert.match(body, /flag\.hidden = phase === 'idle' \|\| onWaitScreen/, 'and hide there');

  // Which only works if something keeps that key up to date.
  assert.match(main, /store\.set\(\{ screen: SLUGS\[index\] \}\)/, 'the carousel must publish the screen');
});
