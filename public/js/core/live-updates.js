import { getDeviceId } from './identity.js';

/**
 * A stream of changes from the server, so the screen does not have to ask.
 *
 * The app used to learn about a wait only by polling, and a wait started by an
 * editor hook is often over before the next poll - so the screen showed
 * nothing until it was refreshed. This keeps one connection open and hears
 * about a change the moment it happens.
 *
 * Read with `fetch`, not `EventSource`: the browser's own API cannot send
 * headers, and the device id is a credential that must stay out of URLs.
 *
 * It reconnects on its own, backing off, and reports each time it comes back -
 * anything that changed while it was away was not heard, so the caller
 * re-reads rather than trusting the gap was quiet.
 */

const MAX_BACKOFF_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits a server-sent-events stream into `{ event, data }` messages. */
function parse(block) {
  let event = 'message';
  const data = [];

  for (const line of block.split('\n')) {
    // A line starting with a colon is a comment - the server's heartbeat.
    if (!line || line.startsWith(':')) continue;

    const at = line.indexOf(':');
    const field = at === -1 ? line : line.slice(0, at);
    const value = at === -1 ? '' : line.slice(at + 1).replace(/^ /, '');

    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }

  if (!data.length) return null;

  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * @param onEvent  Called with each `{ type, ... }` the server sends.
 * @param onOpen   Called every time the stream (re)opens - re-read state here.
 */
export function connectLiveUpdates({ onEvent, onOpen } = {}) {
  let stopped = false;
  let controller = null;
  let failures = 0;

  async function read(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;

      // Normalised, so a server that ends lines with CRLF parses the same.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const message = parse(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);

        if (!message) continue;
        if (message.event === 'ready') {
          failures = 0;
          onOpen?.();
        } else {
          onEvent?.(message.data);
        }
      }
    }
  }

  async function run() {
    while (!stopped) {
      controller = new AbortController();

      try {
        const response = await fetch(new URL('/api/events', location.origin), {
          headers: { 'X-Device-Id': getDeviceId(), Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: controller.signal
        });

        if (response.ok && response.body) await read(response.body);
      } catch {
        // Dropped, refused or offline - all handled the same way, below.
      }

      if (stopped) return;

      // 1s, 2s, 4s ... capped, so a server that is down is not hammered.
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures);
      failures += 1;
      await sleep(delay);
    }
  }

  run();

  return {
    stop() {
      stopped = true;
      controller?.abort();
    }
  };
}
