import { accountForToken, tokenFromHeader } from '../domain/agents.js';
import { HttpError, notFound } from './errors.js';
import { sendError, sendJson, sendNoContent } from './respond.js';

/**
 * Everything an agent token may do.
 *
 * The whole point of a second credential is that it is weaker than the first,
 * and a scope written only in a comment is not a scope. This is the list, it
 * is matched exactly, and anything not on it is refused before the handler is
 * ever reached - so a route added later is locked out by default rather than
 * quietly inheriting access.
 */
const AGENT_ROUTES = new Set(['POST /api/wait/start', 'POST /api/wait/end']);

/**
 * An agent token is only accepted from this machine.
 *
 * It exists for a local editor hook, so there is no case where it should
 * arrive over a network. The server binds to loopback by default but can be
 * told otherwise - it is right now, so a phone on the LAN can reach it - and
 * that must not quietly widen what a token can do.
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Minimal method + path router. Paths may contain `:param` segments, which are
 * exposed to handlers as `ctx.params`.
 */
export class Router {
  #routes = [];
  #fallback = null;

  add(method, pattern, handler) {
    this.#routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  get(pattern, handler) { return this.add('GET', pattern, handler); }
  post(pattern, handler) { return this.add('POST', pattern, handler); }
  delete(pattern, handler) { return this.add('DELETE', pattern, handler); }

  /** Handler used when no route matches - typically the static file server. */
  fallback(handler) {
    this.#fallback = handler;
    return this;
  }

  #match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);

    for (const route of this.#routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;

      const params = {};
      const matched = route.segments.every((segment, index) => {
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(parts[index]);
          return true;
        }
        return segment === parts[index];
      });

      if (matched) return { route, params };
    }

    return null;
  }

  /** Returns a `(req, res)` listener suitable for `http.createServer`. */
  toListener() {
    return async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

      if (req.method === 'OPTIONS') {
        sendNoContent(res);
        return;
      }

      try {
        const hit = this.#match(req.method, url.pathname);

        if (!hit) {
          if (this.#fallback) {
            await this.#fallback(req, res, url);
            return;
          }
          throw notFound();
        }

        /*
         * An agent token, if one was sent. Checked here rather than in the
         * handlers so that every rule - local only, allowlisted route, live
         * token - applies to everything, including whatever is added next.
         */
        let agent = null;
        const token = tokenFromHeader(req.headers.authorization);

        if (token) {
          if (!isLoopback(req)) {
            throw new HttpError(403, 'An agent token only works from this machine.');
          }

          if (!AGENT_ROUTES.has(`${req.method} ${url.pathname}`)) {
            throw new HttpError(403, 'That is outside what an agent token may do.');
          }

          agent = await accountForToken(token);
          if (!agent) throw new HttpError(401, 'That token is not valid.');
        }

        const result = await hit.route.handler({
          req,
          res,
          url,
          params: hit.params,
          query: url.searchParams,
          agent,
          deviceId: req.headers['x-device-id'] ?? null
        });

        // Handlers either return a serialisable value or respond themselves.
        if (result !== undefined && !res.writableEnded) {
          sendJson(res, result?.status ?? 200, result?.body ?? result);
        }
      } catch (error) {
        if (!res.writableEnded) sendError(res, error);
      }
    };
  }
}
