import { accountIdFor } from '../domain/devices.js';
import { subscribe } from '../domain/events.js';

/**
 * One long-lived stream per open screen, carrying changes as they happen.
 *
 * Server-sent events, read with `fetch` rather than `EventSource`. The browser
 * API cannot send headers, and the only way to say who you are is the
 * `X-Device-Id` header - the alternative would be putting the account's one
 * credential in a URL, where it lands in logs and history.
 *
 * An agent token cannot open one: this route is not on the router's allowlist,
 * and a stream of someone's activity is exactly the kind of read it must not
 * have.
 */

/** Often enough that nothing between here and a phone decides it is idle. */
const HEARTBEAT_MS = 25_000;

export function registerEventRoutes(router) {
  router.get('/api/events', async ({ req, res, deviceId }) => {
    const accountId = await accountIdFor(deviceId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Some proxies buffer a response until it ends, which for this is never.
      'X-Accel-Buffering': 'no'
    });

    const write = (text) => {
      if (!res.writableEnded) res.write(text);
    };

    // Says the stream is open, so a screen can stop showing itself as stale.
    write(`event: ready\ndata: {}\n\n`);

    const { entry, unsubscribe } = subscribe(accountId, (event) => {
      write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => write(': still here\n\n'), HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };

    entry.close = close;
    req.on('close', close);

    // Responded to directly; the router must not try to send anything else.
    return undefined;
  });
}
