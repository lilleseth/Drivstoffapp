// Service worker: gjør at appen åpner seg uten nett. Data synkroniseres når du er på nett igjen.
// Appfiler hentes fra nettet først (så oppdateringer kommer med en gang), med cache som reserve.
const CACHE = 'drivstoff-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/github.js', 'js/merge.js', 'js/receipt-parser.js', 'js/scan.js', 'js/stats.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.github.com') return;

  // Biblioteker og språkdata fra CDN endres aldri for en gitt versjon: cache først.
  if (url.hostname.endsWith('jsdelivr.net') || url.hostname.endsWith('projectnaptha.com')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
