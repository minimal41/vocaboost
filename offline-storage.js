// ===== オフライン保存した単語帳の共通ストレージ =====
// view.html（保存・解除ボタン）と offline/index.html・offline/flash.html・offline/test.html
// （一覧表示・暗記・テスト）から共通で利用する。Firebase等の外部ネットワークには
// 一切依存せず、localStorageだけで完結させることで、電波が無い状態でも動作させる。
(function () {
  const STORAGE_KEY = "vocaboost_offlineBooks";

  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("オフライン保存データの読み込みに失敗しました", e);
      return {};
    }
  }

  function writeAll(all) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  // 保存済みの単語帳を { id: { id, title, description, ownerName, savedAt, words } } の形で全件返す
  window.VOCABOOST_GET_OFFLINE_BOOKS = function () {
    return readAll();
  };

  // 1件だけ取得。無ければnull
  window.VOCABOOST_GET_OFFLINE_BOOK = function (id) {
    const all = readAll();
    return all[id] || null;
  };

  window.VOCABOOST_IS_OFFLINE_SAVED = function (id) {
    return !!readAll()[id];
  };

  // bookは { id, title, description, ownerName, words } を想定。
  // wordsは [{ front, hint, back, note }, ...] の配列。
  window.VOCABOOST_SAVE_OFFLINE_BOOK = function (book) {
    const all = readAll();
    all[book.id] = {
      id: book.id,
      title: book.title || "(無題)",
      description: book.description || "",
      ownerName: book.ownerName || "",
      savedAt: Date.now(),
      words: (book.words || []).map(w => ({
        front: w.front || "",
        hint: w.hint || "",
        back: w.back || "",
        note: w.note || ""
      }))
    };
    writeAll(all);
  };

  window.VOCABOOST_REMOVE_OFFLINE_BOOK = function (id) {
    const all = readAll();
    delete all[id];
    writeAll(all);
  };
})();
