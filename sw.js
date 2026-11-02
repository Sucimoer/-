/* 澪鸢 PWA Service Worker：应用壳离线缓存 + 网络优先回退 */
const CACHE_NAME = 'lingyuan-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/ai.css',
  './css/enhanced.css',
  './js/lib-ready.js',
  './js/core.js',
  './js/ai.js',
  './js/enhanced.js',
  './picture/狂三.png',
  './picture/白.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  if(url.origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function(res){
        // 网络优先：成功后顺便更新缓存（同源 GET）
        if(res && res.ok){
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(c){ c.put(req, copy); }).catch(function(){});
        }
        return res;
      })
      .catch(function(){
        return caches.match(req).then(function(hit){ return hit || caches.match('./index.html'); });
      })
  );
});
