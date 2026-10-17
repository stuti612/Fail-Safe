// Caches the whole app so the receiver keeps working with no network.
// Bump VERSION whenever any cached file changes.
const VERSION = 'chirp-v13';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './receiver/',
  './receiver/index.html',
  './receiver/app.js',
  './range/',
  './range/index.html',
  './range/app.js',
  './range/pattern.js',
  './console/',
  './console/index.html',
  './console/app.js',
  './console/cap.js',
  './console/speak.js',
  './console/slow.js',
  './console/helpqueue.js',
  './shared/receive.js',
  './shared/help.js',
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
  './shared/demo-policy.js',
  './shared/phrasebook.js',
  './shared/phrasebook.json',
  './shared/zones.json',
  './vendor/ggwave.js',
  './vendor/nacl-fast.min.js',
];
const APP_PATHS = new Set(FILES.map((file) => new URL(file, self.registration.scope).pathname));

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

// Only cache the static app shell. Help queues and authenticated responses may
// contain resident details and must never enter Cache Storage.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !APP_PATHS.has(url.pathname) || e.request.headers.has('Authorization')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
