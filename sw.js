/* Cache version — bump CACHE_VERSION on every deploy so activate() evicts
   the previous generation atomically. The old string ('nexus-v10-v14-modules')
   was static, which meant a hot-fix to app.js was never fetched from the
   network until users hard-refreshed. */
var CACHE_VERSION = 'v10.2.0-scanner-v4-2026-04-27';
var CACHE_NAME = 'nexus-' + CACHE_VERSION;
/* Critical assets — install fails if any fail */
var CRITICAL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './src/constants.js',
  './src/utils.js',
  './src/storage.js',
  './src/translations.js',
  './src/sectors.js',
  './src/connection.js',
  './src/monitor-state.js',
  './src/whale-state.js',
  './src/portfolio.js',
  './src/notifications.js',
];
/* Optional assets — best-effort cache, failure does not block install */
var OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap',
];

/* Install — cache critical first, then optional with failure tolerance */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(CRITICAL_ASSETS).then(function () {
          return Promise.all(
            OPTIONAL_ASSETS.map(function (url) {
              return cache.add(url).catch(function () {
                console.warn('[SW] Optional asset failed to cache:', url);
              });
            })
          );
        });
      })
      .then(function () {
        self.skipWaiting();
      })
  );
});

/* Activate — clean old caches */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n !== CACHE_NAME;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(function () {
        self.clients.claim();
      })
  );
});

/* Fetch — network first, fallback to cache */
self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  /* API calls — network only, never cache. Also treat the Telegram proxy /notify POST the same way. */
  if (
    url.includes('/api/') ||
    url.includes('/notify') ||
    url.includes('api.binance') ||
    url.includes('fapi.binance') ||
    url.includes('api.bybit') ||
    url.includes('api.coingecko') ||
    url.includes('api.coinbase') ||
    url.includes('alternative.me') ||
    url.includes('llama.fi') ||
    url.includes('tokenomist') ||
    url.includes('cryptocompare') ||
    url.includes('mempool.space')
  ) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  /* Static assets — network first, cache fallback. Only cache GET responses. */
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        if (res && res.status === 200 && e.request.method === 'GET') {
          var clone = res.clone();
          caches
            .open(CACHE_NAME)
            .then(function (cache) {
              cache.put(e.request, clone);
            })
            .catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request).then(function (cached) {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});
