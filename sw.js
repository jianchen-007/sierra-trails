/* Sierra Camp Trails service worker — full offline support */
'use strict';

const SHELL_CACHE = 'sierra-shell-v16';
const TILE_CACHE = 'sierra-tiles-v1';

const SHELL = [
  './',
  'index.html',
  'app.js',
  'manifest.webmanifest',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'data/trails.js',
  'data/tile-manifest.js',
  'data/photos.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      // cache:'reload' bypasses the HTTP cache so a new SW version always
      // installs fresh copies of the shell, never stale heuristically-cached ones
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, TILE_CACHE];
    for (const k of await caches.keys()) {
      if (!keep.includes(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // map tiles + photos: cache-first in the tile cache, fill from network when online
  if (url.pathname.includes('/tiles/') || url.pathname.includes('/photos/')) {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      try {
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      } catch (err) {
        return new Response('', { status: 404 });
      }
    })());
    return;
  }

  // app shell: cache-first, fall back to network (and refresh cache)
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const resp = await fetch(e.request);
      if (resp.ok && e.request.method === 'GET') cache.put(e.request, resp.clone());
      return resp;
    } catch (err) {
      return new Response('offline', { status: 503 });
    }
  })());
});
