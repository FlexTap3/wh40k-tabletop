/* WH40k Tabletop service worker — offline shell caching.
   Bump CACHE when you ship a new wh40k-tabletop.html so clients pull the update. */
const CACHE = 'wh40k-tabletop-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // Don't let one missing/renamed asset abort the whole install.
      Promise.allSettled(SHELL.map((u) => c.add(u)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Cross-origin (e.g. PeerJS CDN, signaling): stay out of the way — go to network.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first (always get the freshest app when online, and cache the
  // exact document URL visited), falling back to that cached document — then the shell —
  // when offline so the app still opens at the table with no connection.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        caches.match(req).then((r) => r || caches.match('./index.html').then((i) => i || caches.match('./')))
      )
    );
    return;
  }

  // Same-origin assets: cache-first, then fill the cache on a network hit.
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
