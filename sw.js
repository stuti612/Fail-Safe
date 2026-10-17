// Caches the whole app so the receiver keeps working with no network.
// Bump VERSION whenever any cached file changes.
const VERSION = 'chirp-v2';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './receiver/',
  './receiver/index.html',
  './receiver/app.js',
  './console/',
  './console/index.html',
  './console/app.js',
  './console/cap.js',
  './console/speak.js',
  './shared/cap-map.json',
  './docs/samples/1-evacuation-altadena.xml',
  './docs/samples/2-smoke-multi-area.xml',
  './docs/samples/3-unknown-event-tsunami.xml',
  './shared/style.css',
  './shared/payload.js',
  './shared/trust.js',
  './shared/keys.js',
  './shared/audio.js',
  './shared/config.js',
  './shared/phrasebook.js',
  './shared/phrasebook.json',
  './shared/zones.json',
  './vendor/ggwave.js',
  './vendor/nacl-fast.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates land during the hackathon), cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
