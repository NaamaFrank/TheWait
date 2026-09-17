// First, so the database configuration is in place before anything reads it.
import './helpers/env.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import { endDatabase, query, resetDatabase, skipWithoutDatabase } from './helpers/database.mjs';
import { createApp } from '../server/app.js';
import { ensureDevice } from '../server/domain/devices.js';
import { createAgentToken } from '../server/domain/agents.js';

/**
 * Agent tokens.
 *
 * A second credential only earns its place by being weaker than the first. The
 * device id is a permanent bearer token for the whole account; these do two
 * things - open a wait, close a wait - from this machine only, and can be
 * revoked. Most of what follows is about the "and nothing else" part.
 */

const options = { skip: skipWithoutDatabase };
const DEVICE = '11111111-1111-4111-8111-111111111111';

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
  await ensureDevice(DEVICE);
});

after(async () => {
  if (skipWithoutDatabase) return;
  server?.close();
  await endDatabase();
});

const asAgent = (token, path, method = 'POST') =>
  fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });

const asDevice = (path, method = 'GET') =>
  fetch(`${base}${path}`, { method, headers: { 'X-Device-Id': DEVICE } });

/* --- What it can do ------------------------------------------------------- */

test('an agent token opens and closes a wait', options, async () => {
  const { token } = await createAgentToken(DEVICE, { label: 'Claude Code' });

  const started = await asAgent(token, '/api/wait/start').then((r) => r.json());
  assert.equal(started.phase, 'running');

  const ended = await asAgent(token, '/api/wait/end').then((r) => r.json());
  assert.ok(ended.session, 'and the wait is logged like any other');
  assert.equal(ended.wait.phase, 'idle');
});

test('a wait an agent logged has no device attached to it', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});
  await asAgent(token, '/api/wait/start');
  await asAgent(token, '/api/wait/end');

  const [row] = await query('SELECT device_id, account_id FROM sessions');
  assert.equal(row.device_id, null, 'an editor hook is not a device anybody paired');
  assert.ok(row.account_id, 'but it belongs to the account');
});

/* --- And nothing else ----------------------------------------------------- */

test('an agent token cannot read anything', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  for (const [method, path] of [
    ['GET', '/api/me'],
    ['GET', '/api/sessions'],
    ['GET', '/api/progress'],
    ['GET', '/api/analytics'],
    ['GET', '/api/agents']
  ]) {
    const response = await asAgent(token, path, method);
    assert.equal(response.status, 403, `${method} ${path} should be refused`);
  }
});

test('an agent token cannot change the account or mint more credentials', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  for (const path of ['/api/me', '/api/pair', '/api/agents', '/api/wait/pause']) {
    const response = await asAgent(token, path);
    assert.equal(response.status, 403, `POST ${path} should be refused`);
  }
});

test('a route added later is locked out until it is listed', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  // The allowlist is exact, so anything not on it is refused by default
  // rather than quietly inheriting access.
  const response = await asAgent(token, '/api/wait/resolve-stale');
  assert.equal(response.status, 403);
});

/* --- Revocation ----------------------------------------------------------- */

test('a revoked token stops working immediately', options, async () => {
  const { agent, token } = await createAgentToken(DEVICE, {});

  assert.equal((await asAgent(token, '/api/wait/start')).status, 200);

  await asDevice(`/api/agents/${agent.id}`, 'DELETE');

  const after = await asAgent(token, '/api/wait/start');
  assert.equal(after.status, 401, 'revoked is revoked');
});

test('a made-up token is refused', options, async () => {
  const response = await asAgent('twk_not-a-real-token', '/api/wait/start');
  assert.equal(response.status, 401);
});

test('a token is never stored in the clear', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  const [row] = await query('SELECT token_hash FROM agent_tokens');
  assert.notEqual(row.token_hash, token, 'the table holds a hash, not the token');
  assert.match(row.token_hash, /^[0-9a-f]{64}$/, 'sha256, hex');

  const anywhere = await query('SELECT * FROM agent_tokens');
  assert.equal(JSON.stringify(anywhere).includes(token), false, 'and it is nowhere else either');
});

test('the token is only ever returned once', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  const listed = await asDevice('/api/agents').then((r) => r.json());
  assert.equal(listed.agents.length, 1);
  assert.equal(JSON.stringify(listed).includes(token), false, 'listing never hands it back');
  assert.equal('token' in listed.agents[0], false);
});

test('using one records that it was used', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  const before = await asDevice('/api/agents').then((r) => r.json());
  assert.equal(before.agents[0].lastUsedAt, null);

  await asAgent(token, '/api/wait/start');

  const listed = await asDevice('/api/agents').then((r) => r.json());
  assert.ok(listed.agents[0].lastUsedAt, 'so an unexpected one is visible');
});

test('one account cannot revoke another account\'s token', options, async () => {
  const OTHER = '22222222-2222-4222-8222-222222222222';
  await ensureDevice(OTHER);

  const { agent, token } = await createAgentToken(DEVICE, {});

  const response = await fetch(`${base}/api/agents/${agent.id}`, {
    method: 'DELETE',
    headers: { 'X-Device-Id': OTHER }
  });

  assert.equal(response.status, 404, 'it is not theirs to revoke');
  assert.equal((await asAgent(token, '/api/wait/start')).status, 200, 'and it still works');
});

test('there is a ceiling on how many can be outstanding', options, async () => {
  for (let i = 0; i < 8; i += 1) await createAgentToken(DEVICE, { label: `one ${i}` });

  await assert.rejects(() => createAgentToken(DEVICE, {}), /Revoke one first/);
});

/* --- Local only ----------------------------------------------------------- */

/**
 * The token exists for a hook running on this machine, so there is no case
 * where it should arrive over a network. The server binds to loopback by
 * default but can be told otherwise - it often is, so a phone on the LAN can
 * reach the app - and that must not quietly widen what a token can do.
 *
 * Driven through the listener with a chosen socket address, because a test
 * client connecting to 127.0.0.1 can only ever prove the easy half.
 */
function callFrom(remoteAddress, token, { method = 'POST', path = '/api/wait/start' } = {}) {
  const app = createApp();

  const req = {
    method,
    url: path,
    headers: { host: 'thewait.local', authorization: `Bearer ${token}` },
    socket: { remoteAddress }
  };

  return new Promise((resolve) => {
    const res = {
      writableEnded: false,
      statusCode: 0,
      body: '',
      writeHead(status) { this.statusCode = status; return this; },
      end(body = '') {
        this.body = body;
        this.writableEnded = true;
        resolve({ status: this.statusCode, body });
      }
    };

    app(req, res);
  });
}

test('a token is refused from anywhere but this machine', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  for (const address of ['10.0.0.13', '203.0.113.5', '::ffff:10.0.0.13', '192.168.1.40']) {
    const response = await callFrom(address, token);
    assert.equal(response.status, 403, `${address} should be refused`);
    assert.match(response.body, /only works from this machine/);
  }
});

test('and accepted from every shape of loopback', options, async () => {
  const { token } = await createAgentToken(DEVICE, {});

  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const response = await callFrom(address, token);
    assert.equal(response.status, 200, `${address} should be allowed`);
    // Each start replaces the last, so the account is left with one wait.
  }
});

test('a remote caller is refused before the token is even looked up', options, async () => {
  const { agent, token } = await createAgentToken(DEVICE, {});

  await callFrom('203.0.113.5', token);

  const [row] = await query('SELECT last_used_at FROM agent_tokens WHERE id = $1', [agent.id]);
  assert.equal(row.last_used_at, null, 'a refused call is not a use');
});

test('the browser cannot be talked into using one', options, async () => {
  // `Authorization` is deliberately absent from the CORS allowlist, so a page
  // on another origin cannot send one even if it somehow had a token.
  const response = await fetch(`${base}/api/wait/start`, { method: 'OPTIONS' });
  const allowed = response.headers.get('access-control-allow-headers') ?? '';

  assert.equal(allowed.toLowerCase().includes('authorization'), false);
});
