// Cache name
// キャッシュ内容を変更したら必ずバージョンを上げる（古いキャッシュが残り続けるのを防ぐため）
const CACHE_NAME = 'pwa-sample-caches-v10';
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
  './settings.html',
  './test.html',
  './update.html',
  './user.html',
  './view.html',
  './contact.html',
  './style.css',
  './login.css',
  './theme.js',
  './analytics-tracker.js',
  './manifest.json',
  './images/icon.png',
  './images/rogo.png',
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
  const url = new URL(event.request.url);

  // 同一オリジンのリクエストのみキャッシュ戦略を適用する
  // （Firebase・Google Fonts等の外部リクエストはそのままネットワークに流す）
  if (url.origin !== location.origin) {
    return;
  }

  // HTMLファイル・CSSファイル・JSファイルは「ネットワーク優先」で取得する。
  // ネットワーク取得に成功したらキャッシュを最新版に更新し、
  // オフライン等で失敗した場合のみ古いキャッシュを返す。
  const isHtmlOrAsset = /\.(html|css|js)$/.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/');

  if (isHtmlOrAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // レスポンスが正常なときだけキャッシュを更新する
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => {
          // ネットワーク失敗時はキャッシュから返す（オフライン対応）
          return caches.match(event.request);
        })
    );
    return;
  }

  // 画像など変更の少ないリソースは「キャッシュ優先」のままにする
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response || fetch(event.request))
  );
});