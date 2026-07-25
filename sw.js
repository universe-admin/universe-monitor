/* Universe Monitor service worker.
   Makes repeat visits near-instant without ever staling the live data.
   - Shell/static (same-origin): stale-while-revalidate.
   - Page navigations: network-first (fresh content), cache fallback offline.
   - Data feeds + map tiles (cross-origin): never intercepted — always live. */

/* Bump this whenever a precached asset changes. Navigations are network-first
   while same-origin assets are stale-while-revalidate, so without a bump a
   returning visitor can get new index.html paired with a cached older app.js —
   new markup with no code to fill it. Changing the name makes activate() drop
   the old cache and re-precache the current set. */
const CACHE = 'um-static-v3';

const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'globe.js',
  'exchanges.js',
  'instability.js',
  'assets/data/world.json',
  'assets/vendor/leaflet.js',
  'assets/vendor/leaflet.css',
  'assets/fonts/satoshi-400.woff2',
  'assets/fonts/satoshi-500.woff2',
  'assets/fonts/satoshi-700.woff2',
  'assets/fonts/cabinet-700.woff2',
  'assets/fonts/cabinet-800.woff2',
  'assets/mark.png',
  'assets/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Cross-origin (USGS, EONET, GDELT, CoinGecko, Frankfurter, CARTO tiles):
  // do not intercept — let it hit the network so signals are always live.
  if (!sameOrigin) return;

  // Page navigations: network-first so deployed content updates immediately,
  // fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate — instant from cache,
  // refreshed in the background for the next load.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
