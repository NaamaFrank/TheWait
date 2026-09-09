import { notFound } from './errors.js';
import { sendError, sendJson, sendNoContent } from './respond.js';

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

        const result = await hit.route.handler({
          req,
          res,
          url,
          params: hit.params,
          query: url.searchParams,
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
