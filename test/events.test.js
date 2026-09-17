// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { createApp } from '../server/app.js';
import { accountIdFor, ensureDevice } from '../server/domain/devices.js';
import { createAgentToken } from '../server/domain/agents.js';
import { listenerCount } from '../server/domain/events.js';
import { getWait } from '../server/domain/wait.js';

/**
 * Changes pushed to open screens.
 *
 * The app used to learn about a wait only by polling, every fifteen or thirty
 * seconds, and a wait an editor hook opens and closes is often shorter than
 * that - so the screen showed nothing until it was refreshed.
 */

const options = { skip: skipWithoutDatabase };
const PHONE = 'aaaaaaaa-1111-4111-8111-111111111111';
const STRANGER = 'bbbbbbbb-2222-4222-8222-222222222222';

let server;
let base;

before(async () => {
  if (skipWithoutDatabase) return;
  await resetDatabase();

  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  if (skipWithoutDatabase) return;
  await query('TRUNCATE accounts, devices, sessions, completions, pairing_codes, active_waits, agent_tokens CASCADE');
  await ensureDevice(PHONE);
  await ensureDevice(STRANGER);
});

after(async () => {
  if (skipWithoutDatabase) return;
  server?.closeAllConnections?.();
  server?.close();
  await endDatabase();
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens a stream and collects what arrives until closed. */
async function listen(deviceId) {
  const controller = new AbortController();
  const events = [];

  const response = await fetch(`${base}/api/events`, {
    headers: { 'X-Device-Id': deviceId },
    signal: controller.signal
  });

  const done = (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) return;
        buffer += decoder.decode(value, { stream: true });

        let cut;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = block.split('\n').find((line) => line.startsWith('data: '));
          if (data && !block.startsWith('event: ready')) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch {
      // Aborted - the screen closed.
    }
  })();

  await pause(80);

  return {
    response,
    events,
    async close() {
      controller.abort();
      await done;
      await pause(50);
    }
  };
}

const post = (path, headers) => fetch(`${base}${path}`, { method: 'POST', headers });

test('a screen hears a wait start and end as they happen', options, async () => {
  const screen = await listen(PHONE);
  assert.equal(screen.response.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  await post('/api/wait/start', { 'X-Device-Id': PHONE });
  await pause(80);
  await post('/api/wait/end', { 'X-Device-Id': PHONE });
  await pause(80);

  assert.deepEqual(screen.events, [
    { type: 'wait', phase: 'running', logged: false },
    { type: 'wait', phase: 'idle', logged: true }
  ]);

  await screen.close();
});

test('including a wait an editor hook drove', options, async () => {
  const { token } = await createAgentToken(PHONE, {});
  const screen = await listen(PHONE);

  await post('/api/wait/start', { Authorization: `Bearer ${token}` });
  await pause(80);
  await post('/api/wait/end', { Authorization: `Bearer ${token}` });
  await pause(80);

  assert.deepEqual(screen.events.map((event) => event.phase), ['running', 'idle']);
  await screen.close();
});

test('pausing and resuming are heard too', options, async () => {
  await post('/api/wait/start', { 'X-Device-Id': PHONE });
  const screen = await listen(PHONE);

  await post('/api/wait/pause', { 'X-Device-Id': PHONE });
  await pause(60);
  await post('/api/wait/resume', { 'X-Device-Id': PHONE });
  await pause(60);

  assert.deepEqual(screen.events.map((event) => event.phase), ['paused', 'running']);
  await screen.close();
});

test('one account never hears another\'s', options, async () => {
  const mine = await listen(PHONE);

  await post('/api/wait/start', { 'X-Device-Id': STRANGER });
  await pause(100);

  assert.deepEqual(mine.events, [], 'a stranger starting a wait is none of this screen\'s business');
  await mine.close();
});

test('an agent token cannot listen in', options, async () => {
  const { token } = await createAgentToken(PHONE, {});

  const response = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 403, 'a stream of someone\'s activity is a read');
});

test('without a device there is no stream', options, async () => {
  const response = await fetch(`${base}/api/events`);
  assert.equal(response.status, 400);
});

test('a closed screen stops being listened for', options, async () => {
  const accountId = await accountIdFor(PHONE);
  const screen = await listen(PHONE);
  assert.equal(listenerCount(accountId), 1);

  await screen.close();
  assert.equal(listenerCount(accountId), 0, 'nothing is left holding the connection');
});

/**
 * The clock the screen counts on from.
 *
 * Whole seconds threw away up to 999ms, so a wait that had just been opened sat
 * on 0:00 for most of two seconds and read as though it had not started.
 */
test('the elapsed time is sent unrounded as well', options, async () => {
  await post('/api/wait/start', { 'X-Device-Id': PHONE });
  await query("UPDATE active_waits SET resumed_at = now() - interval '1500 milliseconds'");

  const wait = await getWait(PHONE);

  assert.equal(wait.elapsedSeconds, 1, 'whole seconds, as before');
  assert.ok(wait.elapsedMs >= 1500 && wait.elapsedMs < 2500, `exact: ${wait.elapsedMs}ms`);
});
