import fs from 'node:fs/promises';
import path from 'node:path';
import { notFound } from './errors.js';
import { sendError } from './respond.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

// HTML is revalidated every load so deploys are picked up; hashed-free assets
// get a short cache to stay snappy without going stale for long.
const CACHE_CONTROL = {
  '.html': 'no-cache',
  default: 'public, max-age=300'
};

/**
 * Serves files from `rootDir`. Resolution is confined to the root by comparing
 * against `rootDir + path.sep`, so sibling directories sharing a name prefix
 * cannot be reached.
 */
export function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);
  const rootPrefix = root + path.sep;

  return async (req, res, url) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();

      const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const filePath = path.resolve(root, '.' + path.posix.normalize(requested));

      if (filePath !== root && !filePath.startsWith(rootPrefix)) throw notFound();

      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats?.isFile()) throw notFound();

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
        'Content-Length': stats.size,
        'Cache-Control': CACHE_CONTROL[ext] ?? CACHE_CONTROL.default
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      res.end(await fs.readFile(filePath));
    } catch (error) {
      sendError(res, error);
    }
  };
}
