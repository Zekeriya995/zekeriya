/* Cache version — bump CACHE_VERSION on every deploy so activate() evicts
   the previous generation atomically. The old string ('nexus-v10-v14-modules')
   was static, which meant a hot-fix to app.js was never fetched from the
   network until users hard-refreshed. */
var CACHE_VERSION = 'v10.15.0-server-side-indicators-2026-05-10';
var CACHE_NAME = 'nexus-' + CACHE_VERSION;
/* Critical assets — install fails if any fail */
var CRITICAL_ASSETS = [
  './',
  './index.html',
  './style.css',
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
  './src/monitor-step.js',
  './src/visibility-pause.js',
  './src/source-health.js',
  './src/source-health-ui.js',
  './src/push-client.js',
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

/* Hosts whose responses MUST NOT be cached (live data, POST endpoints). */
var API_HOST_PATTERNS = [
  '/api/',
  '/notify',
  'api.binance',
  'fapi.binance',
  'stream.binance',
  'api.bybit',
  'api.coingecko',
  'api.coinbase',
  'alternative.me',
  'llama.fi',
  'tokenomist',
  'cryptocompare',
  'mempool.space',
];
function isApiRequest(url) {
  for (var i = 0; i < API_HOST_PATTERNS.length; i++) {
    if (url.indexOf(API_HOST_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

/* Fetch handler — three lanes:

   1. API requests: network-only. On failure return a 503 (NOT 200 +
      `{error:"offline"}` — the old shape made `fetch().ok` return true,
      so callers couldn't distinguish offline from a real upstream
      reply. 503 surfaces correctly through the existing fj() failure
      path in src/connection.js).

   2. App shell + src/* + index.html: stale-while-revalidate. Serve
      the cached copy immediately if we have one, fire a background
      revalidate, and fall back to the network when there is no cache
      entry. This eliminates the 1-RTT cost on every navigation.

   3. Other assets (fonts, manifest, icons): cache-first with network
      fallback. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;

  if (isApiRequest(url)) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var network = fetch(e.request)
        .then(function (res) {
          if (res && res.status === 200) {
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
          return cached || new Response('Offline', { status: 503 });
        });
      /* SWR: cached wins the race when present; the network update
         lands silently in the background for the next navigation. */
      return cached || network;
    })
  );
});

/* ═══ WEB PUSH ═══

   Push events arrive even when the PWA is closed; the browser keeps
   the SW alive long enough to call showNotification. The payload is
   a JSON blob the server crafted, with title / body / tag / url.
   `tag` collapses repeated alerts about the same symbol into a
   single notification entry instead of stacking five lines. The
   click handler focuses an open tab if one exists, otherwise opens
   the URL fresh — same UX as native apps. */

self.addEventListener('push', function (e) {
  var data = {};
  try {
    if (e.data) data = e.data.json();
  } catch (err) {
    data = { title: 'NEXUS PRO', body: e.data ? e.data.text() : '' };
  }
  var title = data.title || 'NEXUS PRO';
  var options = {
    body: data.body || '',
    tag: data.tag || 'nexus',
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%23060b14'/%3E%3Ctext x='96' y='125' font-size='110' text-anchor='middle' fill='%2300ff88' font-family='Arial,sans-serif' font-weight='bold'%3EN%3C/text%3E%3C/svg%3E",
    badge:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='20' fill='%23060b14'/%3E%3Ctext x='48' y='65' font-size='60' text-anchor='middle' fill='%2300ff88' font-family='Arial,sans-serif' font-weight='bold'%3EN%3C/text%3E%3C/svg%3E",
    data: { url: data.url || '/' },
    requireInteraction: false,
    /* Vibrate is honoured on Android but ignored on iOS — leaving it
       opt-in via data.vibrate keeps both platforms quiet by default. */
    vibrate: data.vibrate || [80, 40, 80],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) {
          /* If a tab is already open on the same origin, navigate it
             to the target URL and bring it forward instead of opening
             yet another window. */
          if ('navigate' in c) c.navigate(target).catch(function () {});
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
