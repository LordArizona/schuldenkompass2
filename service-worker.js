// service-worker.js — macht die App offline nutzbar (wichtig für eine PWA auf dem iPhone,
// z. B. im Tunnel oder ohne Empfang). Cache-Version bei jedem Deploy mit spürbaren Änderungen
// hochzählen, damit Nutzer:innen die neue Version bekommen statt eine alte aus dem Cache.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `schuldenkompass-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Netzwerk zuerst (damit Änderungen nach einem Deploy ankommen), bei Fehler auf Cache zurückfallen.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('index.html')))
  );
});
