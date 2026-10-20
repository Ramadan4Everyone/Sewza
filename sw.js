const CACHE_NAME = 'sewza-pwa-v9';
const RUNTIME_CACHE = 'sewza-runtime-v1';
const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const APP_SHELL = [
  './', './index.html', './style.css', './app.js', './manifest.webmanifest',
  './sewza-logo.png', './sewza-mark.png', './sewza-wordmark.png', './migrate.js', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './sewza-fabric-hero.svg', './supabase-config.js', './supabase-client.js', './install.js', './portfolio.html', './portfolio.css', './portfolio.js',
  './slide-fitting.svg', './slide-customer.svg', './slide-studio.svg', './slide-delivery.svg',
  './slide-measure.svg', './slide-receipts.svg'
];
// Third-party files the app needs to start while offline.
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Always fetch fresh copies of the app shell when a new version installs.
    await cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })));
    // The Supabase browser library is cross-origin; store it so the app can start offline.
    try {
      const runtime = await caches.open(RUNTIME_CACHE);
      const res = await fetch(new Request(SUPABASE_LIB, { mode: 'no-cors' }));
      if (res && (res.ok || res.type === 'opaque')) await runtime.put(SUPABASE_LIB, res);
    } catch (e) { /* optional: it is cached again on the next online visit */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Serve from cache immediately (works offline), refresh the copy in the background when online.
function staleWhileRevalidate(request, cacheName, matchOptions) {
  return caches.open(cacheName).then(cache =>
    cache.match(request, matchOptions).then(cached => {
      const network = fetch(request).then(response => {
        if (response && !response.redirected && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
        return response;
      }).catch(() => null);
      if (cached) { network.catch(() => {}); return cached; }
      return network;
    })
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache Supabase API/storage/auth responses. User data must stay governed by Supabase/RLS.
  if (url.hostname.endsWith('.supabase.co')) return;

  if (url.origin !== self.location.origin) {
    if (RUNTIME_HOSTS.includes(url.hostname)) {
      event.respondWith(
        staleWhileRevalidate(request, RUNTIME_CACHE).then(res => res || Response.error())
      );
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      staleWhileRevalidate(request, CACHE_NAME, { ignoreSearch: true })
        .then(res => res || caches.match('./index.html'))
        .then(res => res || Response.error())
    );
    return;
  }

  event.respondWith(
    staleWhileRevalidate(request, CACHE_NAME).then(res => res || Response.error())
  );
});
