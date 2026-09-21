/* WH40k Tabletop service worker — offline shell caching.
   Bump CACHE when you ship a new wh40k-tabletop.html so clients pull the update. */
const CACHE = 'wh40k-tabletop-v24';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  /* ==== WP3D ==== 3D-view module + sections + vendored three.js, pre-cached so the
     installed PWA can toggle 3D offline even if it was never used online. */
  './wh40k-3d.js',
  './miniatures.html',
  './assets/miniatures/catalog.js',
  './assets/miniatures/sources.json',
  './assets/miniatures/ork-boy.bin',
  './assets/miniatures/ork-boy.webp',
  './assets/miniatures/ork-boy-shoota.bin',
  './assets/miniatures/ork-boy-shoota.webp',
  './assets/miniatures/ork-boy-rokkit.bin',
  './assets/miniatures/ork-boy-rokkit.webp',
  './assets/miniatures/ork-nob.bin',
  './assets/miniatures/ork-nob.webp',
  './assets/miniatures/ork-warboss.bin',
  './assets/miniatures/ork-warboss.webp',
  './assets/miniatures/ork-meganob.bin',
  './assets/miniatures/ork-meganob.webp',
  './assets/miniatures/ork-gretchin.bin',
  './assets/miniatures/ork-gretchin.webp',
  './assets/miniatures/ork-stormboy.bin',
  './assets/miniatures/ork-stormboy.webp',
  './assets/miniatures/ork-stormboy-2.bin',
  './assets/miniatures/ork-stormboy-2.webp',
  './assets/miniatures/ork-snagga.bin',
  './assets/miniatures/ork-snagga.webp',
  './assets/miniatures/ork-kommando.bin',
  './assets/miniatures/ork-kommando.webp',
  './assets/miniatures/ork-weirdboy.bin',
  './assets/miniatures/ork-weirdboy.webp',
  './assets/miniatures/ork-painboy.bin',
  './assets/miniatures/ork-painboy.webp',
  './assets/miniatures/ork-battlewagon.bin',
  './assets/miniatures/ork-battlewagon.webp',
  './assets/miniatures/ork-trukk.bin',
  './assets/miniatures/ork-trukk.webp',
  './assets/miniatures/ork-flash-git.bin',
  './assets/miniatures/ork-flash-git.webp',
  './assets/miniatures/ork-loota.bin',
  './assets/miniatures/ork-loota.webp',
  './assets/miniatures/ork-burna.bin',
  './assets/miniatures/ork-burna.webp',
  './assets/miniatures/ork-ghazghkull.bin',
  './assets/miniatures/ork-ghazghkull.webp',
  './assets/miniatures/ork-runtherd.bin',
  './assets/miniatures/ork-runtherd.webp',
  './assets/miniatures/ork-squighog.bin',
  './assets/miniatures/ork-squighog.webp',
  './assets/miniatures/ork-mega-warboss.bin',
  './assets/miniatures/ork-mega-warboss.webp',
  './assets/miniatures/ork-deff-dread.bin',
  './assets/miniatures/ork-deff-dread.webp',
  './assets/miniatures/ork-killa-kan.bin',
  './assets/miniatures/ork-killa-kan.webp',
  './assets/miniatures/ork-beastboss.bin',
  './assets/miniatures/ork-beastboss.webp',
  './assets/miniatures/ork-gorkanaut.bin',
  './assets/miniatures/ork-gorkanaut.webp',
  './assets/miniatures/ork-morkanaut.bin',
  './assets/miniatures/ork-morkanaut.webp',
  './assets/miniatures/sm-intercessor-modern.bin',
  './assets/miniatures/sm-intercessor-modern.webp',
  './assets/miniatures/sm-intercessor.bin',
  './assets/miniatures/sm-intercessor.webp',
  './assets/miniatures/sm-intercessor-2.bin',
  './assets/miniatures/sm-intercessor-2.webp',
  './assets/miniatures/sm-intercessor-3.bin',
  './assets/miniatures/sm-intercessor-3.webp',
  './assets/miniatures/sm-assault-intercessor.bin',
  './assets/miniatures/sm-assault-intercessor.webp',
  './assets/miniatures/sm-heavy-intercessor.bin',
  './assets/miniatures/sm-heavy-intercessor.webp',
  './assets/miniatures/sm-captain.bin',
  './assets/miniatures/sm-captain.webp',
  './assets/miniatures/sm-gravis-captain.bin',
  './assets/miniatures/sm-gravis-captain.webp',
  './assets/miniatures/sm-librarian.bin',
  './assets/miniatures/sm-librarian.webp',
  './assets/miniatures/sm-chaplain.bin',
  './assets/miniatures/sm-chaplain.webp',
  './assets/miniatures/sm-rhino.bin',
  './assets/miniatures/sm-rhino.webp',
  './assets/miniatures/sm-redemptor.bin',
  './assets/miniatures/sm-redemptor.webp',
  './assets/miniatures/sm-terminator-sgt.bin',
  './assets/miniatures/sm-terminator-sgt.webp',
  './assets/miniatures/sm-aggressor-dw.bin',
  './assets/miniatures/sm-aggressor-dw.webp',
  './assets/miniatures/sm-scout-wolf.bin',
  './assets/miniatures/sm-scout-wolf.webp',
  './assets/miniatures/sm-scout-wolf-2.bin',
  './assets/miniatures/sm-scout-wolf-2.webp',
  './assets/miniatures/sm-reiver.bin',
  './assets/miniatures/sm-reiver.webp',
  './assets/miniatures/sm-reiver-2.bin',
  './assets/miniatures/sm-reiver-2.webp',
  './assets/miniatures/sm-phobos-lieutenant.bin',
  './assets/miniatures/sm-phobos-lieutenant.webp',
  './assets/miniatures/sm-scout-modern-body.bin',
  './assets/miniatures/sm-scout-modern-body.webp',
  './assets/miniatures/sm-infiltrator-modern.bin',
  './assets/miniatures/sm-infiltrator-modern.webp',
  './assets/miniatures/sm-assault-terminator-modern.bin',
  './assets/miniatures/sm-assault-terminator-modern.webp',
  './assets/miniatures/sm-scout-modern-rifle.bin',
  './assets/miniatures/sm-scout-modern-rifle.webp',
  './assets/miniatures/sm-scout-modern-shotgun.bin',
  './assets/miniatures/sm-scout-modern-shotgun.webp',
  './assets/miniatures/sm-incursor-modern.bin',
  './assets/miniatures/sm-incursor-modern.webp',
  './assets/miniatures/sm-infiltrator-veteran.bin',
  './assets/miniatures/sm-infiltrator-veteran.webp',
  './assets/miniatures/sm-intercessor-modern-2.bin',
  './assets/miniatures/sm-intercessor-modern-2.webp',
  './assets/miniatures/sm-assault-intercessor-modern.bin',
  './assets/miniatures/sm-assault-intercessor-modern.webp',
  './assets/miniatures/sm-assault-intercessor-modern-2.bin',
  './assets/miniatures/sm-assault-intercessor-modern-2.webp',


  './sections/wp3d-15-miniatures.js',

  './sections/wp3d-1-geometry.js',
  './sections/wp3d-2-renderer.js',
  './sections/wp3d-3-labels.js',
  './sections/wp3d-4-interaction.js',
  './sections/wp3d-6-terrain2.js',
  './sections/wp3d-7-troops.js',
  './sections/wp3d-8-vehicles.js',
  './sections/wp3d-9-environment.js',
  './sections/wp3d-10-motion.js',
  './sections/wp3d-11-modes.js',
  './sections/wp3d-12-battlecam.js',
  './sections/wp3d-13-extras.js',
  './sections/wp3d-14-battlezone.js',
  './battlezone.html',
  './sections/battlezone-layout.js',
  './sections/battlezone-area.js',
  './sections/battlezone-shapes.js',
  './sections/battlezone-2d.js',
  './terrain/ruin-door.png',
  './terrain/ruin-pipes.png',
  './terrain/ruin-high.png',
  './terrain/ruin-broken.png',
  './terrain/wall-relic.png',
  './terrain/wall-pipes.png',
  './terrain/wall-corner.png',
  './terrain/wall-door.png',
  './terrain/pylon-a.png',
  './terrain/pylon-b.png',
  './terrain/shrine.png',
  './terrain/barricade.png',
  './terrain/capacitor.png',
  './terrain/shock.png',

  './vendor/three.module.min.js'
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
