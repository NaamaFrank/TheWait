/**
 * Service worker for The Wait.
 *
 * Two strategies, chosen by what the request is for:
 *
 * - App shell (HTML, CSS, JS, icons): cache-first, so a cold launch from the
 *   home screen paints instantly and works with no connection.
 * - API: network-first. Live data must never be served stale, but a cached
 *   copy of the last successful GET is kept so an offline launch can still
 *   show your own history rather than an error.
 *
 * Bump CACHE_VERSION whenever the shell changes; the activate handler drops
 * every older cache.
 */

const CACHE_VERSION = 'v34';
const SHELL_CACHE = `thewait-shell-${CACHE_VERSION}`;
const DATA_CACHE = `thewait-data-${CACHE_VERSION}`;

/**
 * Serving the shell cache-first is right in production and actively hostile in
 * development: every edit needs a CACHE_VERSION bump before it can be seen. On
 * a local origin the shell goes to the network instead, so a plain reload shows
 * the code that is actually on disk.
 */
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/styles/tokens.css',
  '/styles/base.css',
  '/styles/components.css',
  '/styles/screens.css',
  '/styles/desktop.css',
  '/styles/desktop.css',
  '/js/main.js',
  '/js/core/api.js',
  '/js/core/carousel.js',
  '/js/core/dom.js',
  '/js/core/format.js',
  '/js/core/identity.js',
  '/js/core/pwa.js',
  '/js/core/store.js',
  '/js/core/view-mode.js',
  '/js/core/view-mode.js',
  '/js/core/wait-timer.js',
  '/js/components/pairing.js',
  '/js/components/welcome.js',
  '/js/components/place-picker.js',
  '/js/components/charts.js',
  '/js/components/receipt.js',
  '/js/components/globe-card.js',
  '/js/components/share-sheet.js',
  '/js/components/geo.js',
  '/js/components/globe.js',
  '/js/components/ui.js',
  '/js/screens/board.js',
  '/js/screens/live.js',
  '/js/screens/stats.js',
  '/js/screens/streaks.js',
  '/js/screens/wait.js',
  '/js/screens/you.js',
  '/data/countries-110m.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

/** Endpoints worth keeping a last-known-good copy of for offline launches. */
const CACHEABLE_API = ['/api/me', '/api/regions', '/api/sessions', '/api/analytics', '/api/suggestions'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is atomic - one 404 would throw away the whole precache, so
      // each asset is added individually and failures are tolerated.
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('thewait-') && key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    if (response.ok && CACHEABLE_API.some((path) => new URL(request.url).pathname.startsWith(path))) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(JSON.stringify({ error: 'You are offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);

    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    // A failed navigation gets the offline page rather than the browser error.
    if (request.mode === 'navigate') {
      return (await caches.match('/offline.html')) ?? Response.error();
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch other origins, and never cache anything that mutates state.
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;

  // The worker itself must always come from the network, or an update can
  // never be picked up.
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(IS_LOCAL ? networkFirst(request) : cacheFirst(request));
});
