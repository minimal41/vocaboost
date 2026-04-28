// Cache name
const CACHE_NAME = 'pwa-sample-caches-v1';
// Cache targets
const urlsToCache = [
  './',
  './index.html',
  './create.html',
  './edit.html',
  './flash.html',
  './list.html',
  './login.html',
  './mypage.html',
  './register.html',
  './test.html',
  './update.html',
  './user.html',
  './view.html',
  './contact.html',
  './css/style.css',
  './login.css',
  './images/icon.png',
  './images/to-create.jpeg',
  './images/to-list.jpeg',
  './images/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => {
        return response ? response : fetch(event.request);
      })
  );
});
