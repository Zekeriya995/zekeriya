var CACHE_NAME='nexus-v10-v4';
var ASSETS=[
  './',
  './index.html',
  './app.js',
  './websocket.js',
  './ws-worker.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap'
];

/* Install — cache core assets */
self.addEventListener('install',function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ASSETS);
    }).then(function(){self.skipWaiting()})
  );
});

/* Activate — clean old caches */
self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(n){return n!==CACHE_NAME}).map(function(n){return caches.delete(n)})
      );
    }).then(function(){self.clients.claim()})
  );
});

/* Fetch — network first, fallback to cache */
self.addEventListener('fetch',function(e){
  var url=e.request.url;

  /* API calls — network only, never cache */
  if(url.includes('/api/')||url.includes('api.binance')||url.includes('fapi.binance')||url.includes('stream.binance')||url.includes('fstream.binance')||url.includes('stream.bybit')||url.includes('api.bybit')||url.includes('api.coingecko')||url.includes('alternative.me')||url.includes('llama.fi')||url.includes('tokenomist')||url.includes('cryptocompare')){
    e.respondWith(fetch(e.request).catch(function(){return new Response(JSON.stringify({error:'offline'}),{headers:{'Content-Type':'application/json'}})}));
    return;
  }

  /* Static assets — network first, cache fallback */
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res&&res.status===200){
        var clone=res.clone();
        caches.open(CACHE_NAME).then(function(cache){cache.put(e.request,clone)});
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(cached){
        return cached||new Response('Offline',{status:503});
      });
    })
  );
});
