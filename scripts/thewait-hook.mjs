#!/usr/bin/env node

/**
 * Starts and ends a wait from a Claude Code hook.
 *
 *   thewait-hook start     when a prompt is sent
 *   thewait-hook end       when the turn finishes
 *   thewait-hook login <token>
 *   thewait-hook status
 *
 * Wire it up in `.claude/settings.json`:
 *
 *   "hooks": {
 *     "UserPromptSubmit": [{ "hooks": [{ "type": "command",
 *       "command": "node /path/to/scripts/thewait-hook.mjs start" }] }],
 *     "Stop": [{ "hooks": [{ "type": "command",
 *       "command": "node /path/to/scripts/thewait-hook.mjs end" }] }]
 *   }
 *
 * The token lives in a file, never in the settings: a hook command is checked
 * in, copied between machines and read out over screenshares, and a credential
 * pasted into one is a credential published.
 *
 * Nothing here can fail a turn. Every path exits 0 and says nothing on stdout
 * unless asked - a hook that breaks the editor when the server is down is
 * worse than no hook at all.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = path.join(os.homedir(), '.thewait');
const TOKEN_FILE = path.join(HOME, 'token');
const BASE = process.env.THEWAIT_URL || 'http://127.0.0.1:3000';

/** Only ever this machine: the server refuses these tokens from anywhere else. */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function saveToken(token) {
  if (!token?.startsWith('twk_')) {
    console.error('That does not look like a token. They start with twk_.');
    process.exit(1);
  }

  // 0700 and 0600: this is a credential, not a config file.
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });

  try {
    fs.chmodSync(HOME, 0o700);
    fs.chmodSync(TOKEN_FILE, 0o600);
  } catch {
    // Windows has no mode bits to speak of; the file is in the user profile.
  }

  console.log(`Saved to ${TOKEN_FILE}`);
}

async function call(pathname) {
  const token = readToken();
  if (!token) return;

  if (!LOCAL.test(BASE)) {
    // The server would refuse it anyway. Better not to send it at all.
    console.error('THEWAIT_URL must be a local address; the token is local-only.');
    return;
  }

  const stop = AbortSignal.timeout(2000);

  try {
    await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: stop
    });
  } catch {
    // The app is not running, or is slow. Not this hook's problem.
  }
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case 'start':
    await call('/api/wait/start');
    break;

  case 'end':
    await call('/api/wait/end');
    break;

  case 'login':
    saveToken(argument);
    break;

  case 'status': {
    const token = readToken();
    console.log(token ? `Connected. Token in ${TOKEN_FILE}` : 'No token yet. Run: thewait-hook login twk_...');
    console.log(`Talking to ${BASE}`);
    break;
  }

  default:
    console.log('Usage: thewait-hook start|end|login <token>|status');
}

process.exit(0);
