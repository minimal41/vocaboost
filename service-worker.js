// Cache name
// キャッシュ内容を変更したら必ずバージョンを上げる（古いキャッシュが残り続けるのを防ぐため）
const CACHE_NAME = 'pwa-sample-caches-v2';
// Cache targets
const urlsToCache = [
  './',
  './index.html',
  './create.html',
  './edit.html',
  './flash.html',
  './list.html',
  './login.html',
  './register.html',
  './forgot.html',
  './reset.html',
  './mypage.html',
  './test.html',
  './update.html',
  './user.html',
  './view.html',
  './contact.html',
  './style.css',
  './login.css',
  './manifest.json',
  './images/icon.png',
  './images/rogo.png',
  './images/to-create.jpeg',
  './images/to-list.jpeg',
  './images/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // addAllは1件でも失敗すると全体が失敗するため、
        // 1件ずつ追加してエラーをログに残しつつ続行できるようにする
        return Promise.all(
          urlsToCache.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('Service Worker: キャッシュ追加に失敗しました:', url, err);
            })
          )
        );
      })
  );
});

// 古いバージョンのキャッシュを削除する
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});