// Cache name
// キャッシュ内容を変更したら必ずバージョンを上げる（古いキャッシュが残り続けるのを防ぐため）
const CACHE_NAME = 'pwa-sample-caches-v15';
// キャッシュした日時などの管理用メタデータだけを保存する専用キャッシュ
const META_CACHE_NAME = 'pwa-sample-cache-meta';
// 単語帳・ユーザーページ等(view.html?id=...のようにURLごとに異なる動的ページ)は
// 訪れるたびにキャッシュへ追加され続け、削除する仕組みが無かったため、
// 長期間使うほどストレージ容量を圧迫していた。取得した日時をキャッシュに記録しておき、
// 30日より古いものは自動的に削除する。
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30日
// 期限切れチェック自体も毎回のfetchで走らせるとオーバーヘッドになるため、
// 実行間隔を1日に1回程度に絞る
const CLEANUP_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1日
const CACHED_AT_HEADER = 'x-vocaboost-cached-at';
const LAST_CLEANUP_REQUEST = new Request('./__sw_meta__/last_cleanup');

// レスポンスに「キャッシュした時刻」ヘッダーを付けてから保存する
async function putWithTimestamp(cache, request, response) {
  try {
    const headers = new Headers(response.headers);
    headers.set(CACHED_AT_HEADER, String(Date.now()));
    const body = await response.clone().blob();
    const timestamped = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    await cache.put(request, timestamped);
  } catch (e) {
    // タイムスタンプの付与に失敗しても、キャッシュ自体は通常通り保存する
    console.warn('Service Worker: タイムスタンプ付与に失敗しました:', request.url, e);
    await cache.put(request, response);
  }
}

// タイムスタンプ付きで保存されているエントリのうち、30日より古いものを削除する。
// 事前キャッシュした静的ファイル(タイムスタンプが無いもの)は対象外
// （urlsToCacheの内容はinstallのたびに最新のものへ入れ替わるため、期限切れの心配が無い）。
async function cleanupOldEntries() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  const now = Date.now();

  await Promise.all(requests.map(async (request) => {
    try {
      const response = await cache.match(request);
      if (!response) return;
      const cachedAtHeader = response.headers.get(CACHED_AT_HEADER);
      if (!cachedAtHeader) return;
      const cachedAt = parseInt(cachedAtHeader, 10);
      if (!isNaN(cachedAt) && now - cachedAt > MAX_CACHE_AGE_MS) {
        await cache.delete(request);
      }
    } catch (e) {
      console.warn('Service Worker: 期限切れキャッシュの確認に失敗しました:', request.url, e);
    }
  }));
}

// 前回チェックから1日以上経っていれば true を返し、チェック時刻を更新する
async function shouldRunCleanup() {
  try {
    const metaCache = await caches.open(META_CACHE_NAME);
    const cached = await metaCache.match(LAST_CLEANUP_REQUEST);
    const lastRun = cached ? parseInt(await cached.text(), 10) : 0;
    if (!isNaN(lastRun) && Date.now() - lastRun < CLEANUP_CHECK_INTERVAL_MS) {
      return false;
    }
    await metaCache.put(LAST_CLEANUP_REQUEST, new Response(String(Date.now())));
    return true;
  } catch (e) {
    return false;
  }
}

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
  './offline-storage.js',
  './manifest.json',
  './images/icon.png',
  './images/rogo.png',
  './images/favicon.ico',
  // オフラインモード（電波が無い状態でも保存済みの単語帳の暗記・テストができるページ群）。
  // これらはネットワーク接続が無い前提のページのため、確実に事前キャッシュしておく必要がある。
  './offline/index.html',
  './offline/flash.html',
  './offline/test.html',
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

// 古いバージョンのキャッシュを削除しつつ、現行キャッシュ内の期限切れエントリも掃除する
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== META_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => cleanupOldEntries())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 同一オリジンのリクエストのみキャッシュ戦略を適用する
  // （Firebase・Google Fonts等の外部リクエストはそのままネットワークに流す）
  if (url.origin !== location.origin) {
    return;
  }

  // 1日に1回程度、30日より古いキャッシュエントリを裏側で削除する。
  // このfetchイベント自体の応答は待たせない。
  event.waitUntil(
    shouldRunCleanup()
      .then((run) => { if (run) return cleanupOldEntries(); })
      .catch(() => {})
  );

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
            caches.open(CACHE_NAME).then((cache) => putWithTimestamp(cache, event.request, cloned));
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