// 全ページ共通：ヘッダーの通知ベル表示、凍結アカウントの強制ログアウト、
// 管理者向け「運営」リンクの表示を行う。
// 各ページは <span id="notifBellContainer"></span> を設定ボタンの左に置き、
// </body>直前でこのファイルを読み込むだけでよい。
(function () {
  const ADMIN_EMAILS = [
    "202301745@edu.nishiyamato.ed.jp",
    "202305145@edu.nishiyamato.ed.jp"
  ];

  function waitForFirebase(cb) {
    if (window.firebase && firebase.apps && firebase.apps.length > 0) {
      cb();
    } else {
      setTimeout(() => waitForFirebase(cb), 100);
    }
  }

  // ===== オフライン中であることを知らせる常設バナー =====
  // キャッシュから表示できているページ(index.htmlなど)でも、実際には
  // 電波が無く内容が最新でない可能性があることに気付けるよう、
  // オフラインである間は全ページ共通でバナーを表示する
  // （Firebase初期化を待たず、DOM構築後すぐに判定できる）。
  function showOfflineBanner() {
    if (document.getElementById("vb-offline-banner")) return;
    const bar = document.createElement("div");
    bar.id = "vb-offline-banner";
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:9999;" +
      "background:var(--color-accent,#191970);color:#fff;" +
      "font-size:13px;line-height:1.5;padding:8px 14px;" +
      "text-align:center;box-sizing:border-box;box-shadow:0 2px 6px rgba(0,0,0,0.2);";
    bar.textContent = "オフラインです。表示内容が最新でない場合があります。";
    document.body.appendChild(bar);
  }

  function hideOfflineBanner() {
    const bar = document.getElementById("vb-offline-banner");
    if (bar) bar.remove();
  }

  function initOfflineBanner() {
    if (!navigator.onLine) showOfflineBanner();
    window.addEventListener("offline", showOfflineBanner);
    window.addEventListener("online", hideOfflineBanner);
  }

  if (document.body) {
    initOfflineBanner();
  } else {
    document.addEventListener("DOMContentLoaded", initOfflineBanner);
  }

  // ===== 単語帳キャッシュ(book_*)の上限管理 =====
  // list.html/view.htmlは、開いた単語帳ごとに作成者の写真(base64のdata URL)を
  // 含んだキャッシュを book_{id} というキーでlocalStorageに保存し続けており、
  // 削除されることが無いため公開単語帳を見るほど際限なく増え続けていた。
  // これがlocalStorageの容量超過(QuotaExceededError)の主な原因になっており、
  // 単語帳一覧や編集ボタンが表示されない不具合を引き起こしていた。
  // 件数が一定数を超えたら古いものから間引き、容量を圧迫し続けないようにする。
  const BOOK_CACHE_MAX_ENTRIES = 30;

  function pruneBookCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf("book_") === 0) {
          keys.push(key);
        }
      }

      // localStorageのキー列挙順は多くのブラウザで書き込み順(古い順)になるため、
      // 先頭(古いもの)から超過分だけ削除する。
      const overflow = keys.length - BOOK_CACHE_MAX_ENTRIES;
      for (let i = 0; i < overflow; i++) {
        localStorage.removeItem(keys[i]);
      }
    } catch (e) {
      console.warn("単語帳キャッシュの整理に失敗しました", e);
    }
  }

  pruneBookCache();

  // ===== オフライン等によるセッション切れの通知 =====
  // ネットワーク切断でFirebase側の認証が無効になり再ログインが必要になった際、
  // 画面上はヘッダーの「ログイン」ボタンに切り替わるだけで理由が分からず、
  // 不具合のように見えてしまっていた。ページ再読み込みなしで理由を伝える
  // ための、他ページのCSSに依存しない簡易バナーを表示する。
  let sessionLostBannerShown = false;

  function showSessionLostNotice(offline) {
    if (sessionLostBannerShown) return;
    sessionLostBannerShown = true;

    const message = offline
      ? "インターネット接続が失われたため、ログアウトしました。接続を確認のうえ、再度ログインしてください。"
      : "ログインセッションが切れました。お手数ですが、再度ログインしてください。";

    const bar = document.createElement("div");
    bar.setAttribute("role", "alert");
    bar.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:9999;" +
      "background:var(--color-danger,#b60033);color:#fff;" +
      "font-size:13px;line-height:1.5;padding:10px 40px 10px 14px;" +
      "box-sizing:border-box;box-shadow:0 2px 6px rgba(0,0,0,0.2);";
    bar.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.style.cssText =
      "position:absolute;right:8px;top:6px;background:none;border:none;" +
      "color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px;";
    closeBtn.onclick = () => bar.remove();
    bar.appendChild(closeBtn);

    document.body.appendChild(bar);
  }

  window.VOCABOOST_SHOW_SESSION_LOST_NOTICE = showSessionLostNotice;

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatRelativeTime(date) {
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "たった今";
    if (diffMin < 60) return diffMin + "分前";
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour + "時間前";
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return diffDay + "日前";
    return date.toLocaleDateString("ja-JP");
  }

  // ===== プロフィール写真（アバター） =====
  // 設定ページでは選択した画像を縮小したJPEGのdata URLとしてFirestoreの
  // users/{uid}.photoURL に保存する。user.html/view.htmlなど他人のプロフィール写真を
  // 表示する箇所では、意図しない文字列が書き込まれていた場合に備えて
  // 「必ずbase64エンコードされた画像data URLである」ことを検証してから描画する
  // （data:や属性値への文字列埋め込みによるXSSを防ぐため）。
  const PROFILE_PHOTO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  function isValidProfilePhotoUrl(url) {
    return typeof url === "string" && PROFILE_PHOTO_DATA_URL_RE.test(url);
  }

  const PERSON_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12Zm0 2.5c-3.3 0-9.8 1.6-9.8 4.9v2.4h19.6v-2.4c0-3.3-6.5-4.9-9.8-4.9Z"/>' +
    '</svg>';

  // photoURLが有効な画像data URLならその<img>、そうでなければ人物アイコンのHTMLを返す。
  // sizePxは正方形の一辺の長さ(px)。cohort(期)を渡すと、写真未設定時の人物アイコンを
  // その期の色(緑/青/赤)で表示する。
  function avatarHtml(photoURL, sizePx, cohort) {
    const size = Number(sizePx) || 32;
    const style = "width:" + size + "px;height:" + size + "px;";
    if (isValidProfilePhotoUrl(photoURL)) {
      return '<img src="' + photoURL + '" alt="" class="vb-avatar-img" style="' + style + '">';
    }
    const color = cohortColor(cohort);
    const cls = "vb-avatar-icon" + (color ? " vb-cohort-" + color : "");
    return '<span class="' + cls + '" style="' + style + '">' + PERSON_ICON_SVG + '</span>';
  }

  window.VOCABOOST_AVATAR_HTML = avatarHtml;

  // ===== 期（学年タグ） =====
  // メールアドレス(学籍番号)の先頭4桁が入学年度。2023→41期、2024→42期…とし、
  // 先頭4桁が2023以上の数字でない場合は「その他」(0)とする。
  // users/{uid}.cohort と、未ログインの閲覧者でも絞り込めるよう
  // wordbooks/{id}.ownerCohort に複製して保存する（ownerName等と同じ方針）。
  const COHORT_BASE_YEAR = 2023;
  const COHORT_BASE_NUMBER = 41;
  const COHORT_OTHER = 0;

  // 学年として扱うのは「2023年〜現在の年」の範囲のみ。それ以外(未来の年や
  // 学籍番号でない数字)はすべて「その他」とする。
  function maxCohortNumber() {
    return new Date().getFullYear() - COHORT_BASE_YEAR + COHORT_BASE_NUMBER;
  }

  function cohortFromEmail(email) {
    const m = /^(\d{4})/.exec(String(email || ""));
    if (!m) return COHORT_OTHER;
    return normalizeCohort(Number(m[1]) - COHORT_BASE_YEAR + COHORT_BASE_NUMBER);
  }

  function normalizeCohort(cohort) {
    const n = Number(cohort);
    return Number.isInteger(n) && n >= COHORT_BASE_NUMBER && n <= maxCohortNumber()
      ? n
      : COHORT_OTHER;
  }

  function cohortLabel(cohort) {
    const n = normalizeCohort(cohort);
    return n === COHORT_OTHER ? "その他" : n + "期";
  }

  // 41期=緑、42期=青、43期=赤、44期=緑…の3色周期。「その他」は色なし(null)。
  function cohortColor(cohort) {
    if (cohort === undefined || cohort === null) return null;
    const n = normalizeCohort(cohort);
    if (n === COHORT_OTHER) return null;
    return ["green", "blue", "red"][(n - COHORT_BASE_NUMBER) % 3];
  }

  // 「41期」などのタグ(バッジ)のHTML
  function cohortBadgeHtml(cohort) {
    const color = cohortColor(cohort);
    const cls = "vb-cohort-badge" + (color ? " vb-cohort-" + color : "");
    return '<span class="' + cls + '">' + escapeHtml(cohortLabel(cohort)) + '</span>';
  }

  window.VOCABOOST_COHORT_OTHER = COHORT_OTHER;
  window.VOCABOOST_COHORT_BASE_NUMBER = COHORT_BASE_NUMBER;
  window.VOCABOOST_COHORT_FROM_EMAIL = cohortFromEmail;
  window.VOCABOOST_NORMALIZE_COHORT = normalizeCohort;
  window.VOCABOOST_COHORT_LABEL = cohortLabel;
  window.VOCABOOST_COHORT_COLOR = cohortColor;
  window.VOCABOOST_COHORT_BADGE_HTML = cohortBadgeHtml;

  // 指定ユーザーの期を users/{uid}.cohort と、その人の全単語帳の ownerCohort に反映する。
  // 本人のログイン時(下記)と、運営ページでの過去アカウントの一括付与から呼ばれる。
  window.VOCABOOST_APPLY_COHORT = async function (db, uid, cohort, userData) {
    if (!userData || userData.cohort !== cohort) {
      await db.collection("users").doc(uid).set({ cohort }, { merge: true });
    }
    const snap = await db.collection("wordbooks").where("owner", "==", uid).get();
    const targets = snap.docs.filter(d => d.data().ownerCohort !== cohort);
    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      targets.slice(i, i + 400).forEach(d => batch.update(d.ref, { ownerCohort: cohort }));
      await batch.commit();
    }
    return targets.length;
  };
  window.VOCABOOST_IS_VALID_PHOTO_URL = isValidProfilePhotoUrl;

  // ===== フォロー中のユーザーが新しい単語帳を作成したときの通知 =====
  // create.html(新規作成)・edit.html(複製)から、公開状態の単語帳が新規に
  // 保存された直後に呼び出す。フォロワー一覧は、他人のusersドキュメントの
  // followingIds配列に自分のuidがarray-containsで含まれるかどうかで検索する
  // （呼び出し元ページが既に初期化済みのfirebase/dbインスタンスをそのまま使う）。
  window.VOCABOOST_NOTIFY_FOLLOWERS_NEW_BOOK = async function (db, ownerUid, ownerName, bookId, bookTitle) {
    try {
      const snap = await db.collection("users")
        .where("followingIds", "array-contains", ownerUid)
        .get();

      const followerUids = snap.docs.map(d => d.id);
      if (followerUids.length === 0) return;

      await db.collection("notifications").add({
        title: "フォロー中のユーザーが単語帳を作成しました",
        body: `${ownerName || "名無し"}さんが「${bookTitle || "(無題)"}」を作成しました`,
        target: "follow_new_book",
        targetUserIds: followerUids,
        link: `view.html?id=${bookId}`,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: ownerUid
      });
    } catch (e) {
      console.error("account-widgets: failed to notify followers of new book", e);
    }
  };

  // ===== フォローされたときの通知 =====
  // user.html(toggleFollow)から、フォロー状態がオフ→オンに切り替わった直後にだけ呼び出す
  // （フォロー解除時は通知しない）。
  window.VOCABOOST_NOTIFY_FOLLOWED = async function (db, followerUid, followerName, targetUid) {
    if (followerUid === targetUid) return;
    try {
      await db.collection("notifications").add({
        title: "新しいフォロワーがいます",
        body: `${followerName || "名無し"}さんにフォローされました`,
        target: "follow",
        targetUserIds: [targetUid],
        link: `user.html?id=${followerUid}`,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: followerUid
      });
    } catch (e) {
      console.error("account-widgets: failed to notify followed user", e);
    }
  };

  // ===== 単語帳がお気に入りに登録されたときの通知 =====
  // view.html(toggleFavorite)から、お気に入り状態がオフ→オンに切り替わった直後にだけ呼び出す
  // （お気に入り解除時や、自分自身の単語帳をお気に入りにした場合は通知しない）。
  window.VOCABOOST_NOTIFY_FAVORITED = async function (db, favoriterUid, favoriterName, bookOwnerUid, bookId, bookTitle) {
    if (favoriterUid === bookOwnerUid) return;
    try {
      await db.collection("notifications").add({
        title: "単語帳がお気に入りに登録されました",
        body: `${favoriterName || "名無し"}さんに「${bookTitle || "(無題)"}」がお気に入りに登録されました`,
        target: "favorite_book",
        targetUserIds: [bookOwnerUid],
        link: `user.html?id=${favoriterUid}`,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: favoriterUid
      });
    } catch (e) {
      console.error("account-widgets: failed to notify book owner of favorite", e);
    }
  };

  // ===== フォロワー一覧の取得 =====
  // 指定uidをフォローしている（=フォロワーである）ユーザーの一覧を返す。
  // user.html（フォロワー数表示・フォロワー一覧モーダル）から利用する。
  window.VOCABOOST_FETCH_FOLLOWERS = async function (db, targetUid) {
    const snap = await db.collection("users")
      .where("followingIds", "array-contains", targetUid)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  // ===== 単語帳をお気に入りにしているユーザー一覧の取得 =====
  // 指定した単語帳IDをfavoriteBookIdsに含むユーザーの一覧を返す。
  // view.html（単語帳の作成者だけに表示する「お気に入りした人」一覧）から利用する。
  window.VOCABOOST_FETCH_FAVORITERS = async function (db, bookId) {
    const snap = await db.collection("users")
      .where("favoriteBookIds", "array-contains", bookId)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  let notifications = [];
  let readIds = [];
  let dropdownOpen = false;
  // markAllRead の実処理は auth/db が使える waitForFirebase() の中でのみ定義できるが、
  // ベルのクリックハンドラ自体はキャッシュ表示時点（Firebase初期化前）から有効にしたいため、
  // 間接呼び出し用の差し替え可能な参照を用意しておく
  let markAllReadImpl = null;

  function notifCacheKey(uid) {
    return "accountWidgets_notifCache_" + uid;
  }

  // 直近の通知一覧・既読状態・管理者判定をlocalStorageに保存しておき、
  // 次回訪問時にFirebase/Firestoreの応答を待たずに即座に描画できるようにする
  const NOTIF_REFRESH_MS = 3 * 60 * 1000;
  let notifFetchedAt = 0; // 通知一覧を実際にFirestoreから取得した時刻

  function saveNotifCache(uid, isAdmin, savedAt) {
    try {
      const serializable = notifications.map(n => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt && n.createdAt.toDate ? n.createdAt.toDate().toISOString() : new Date().toISOString()
      }));
      localStorage.setItem(notifCacheKey(uid), JSON.stringify({
        notifications: serializable,
        readIds: readIds,
        isAdmin: isAdmin,
        savedAt: savedAt || notifFetchedAt || Date.now()
      }));
    } catch (e) {
      console.warn("account-widgets: failed to save cache", e);
    }
  }

  function loadNotifCache(uid) {
    try {
      const raw = localStorage.getItem(notifCacheKey(uid));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      parsed.notifications = (parsed.notifications || []).map(n => {
        const d = new Date(n.createdAt);
        return { ...n, createdAt: { toDate: () => d, toMillis: () => d.getTime() } };
      });
      return parsed;
    } catch (e) {
      return null;
    }
  }

  // 二重描画を避けつつベルのDOMを用意する。既に描画済みなら何もしない
  function renderBell() {
    if (document.getElementById("notifBellBtn")) return;
    const container = document.getElementById("notifBellContainer");
    if (!container) return;
    container.innerHTML = `
      <span class="notif-bell-wrap">
        <button type="button" id="notifBellBtn" class="header-btn notif-bell-btn" aria-label="通知">
          <svg class="notif-bell-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span id="notifBadge" class="notif-badge" style="display:none">0</span>
        </button>
        <div id="notifDropdown" class="notif-dropdown" style="display:none">
          <div class="notif-dropdown-title">通知</div>
          <div id="notifList" class="notif-list"><div class="notif-empty">通知はありません</div></div>
          <div class="notif-dropdown-footer">
            <button type="button" class="notif-view-all-btn" onclick="location.href='notifications.html'">すべての通知</button>
          </div>
        </div>
      </span>
    `;
    document.getElementById("notifBellBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("notifDropdown");
      const bellBtn = document.getElementById("notifBellBtn");
      if (dd && dropdownOpen && !dd.contains(e.target) && e.target !== bellBtn) {
        closeDropdown();
      }
    });
  }

  // 二重描画を避けつつ運営リンクを追加する。既に追加済みなら何もしない
  function renderAdminLink() {
    if (document.querySelector(".admin-link-btn")) return;
    const container = document.getElementById("notifBellContainer");
    if (!container) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "header-btn admin-link-btn";
    btn.textContent = "運営";
    btn.addEventListener("click", () => { location.href = "admin.html"; });
    container.appendChild(btn);
  }

  // 通知一覧ページ(notifications.html)で既読にした内容を、ヘッダーのベルのバッジにも即座に反映する
  window.VOCABOOST_MARK_NOTIFICATIONS_READ = function (ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    readIds = Array.from(new Set(readIds.concat(ids)));
    updateBadge();
    renderList();
    try {
      const savedUser = JSON.parse(localStorage.getItem("cachedUser") || "null");
      const cache = savedUser && savedUser.uid ? loadNotifCache(savedUser.uid) : null;
      if (cache) saveNotifCache(savedUser.uid, !!cache.isAdmin);
    } catch (e) { }
  };

  function updateBadge() {
    const unread = notifications.filter(n => !readIds.includes(n.id)).length;
    const badge = document.getElementById("notifBadge");
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
  }

  function renderList() {
    const listEl = document.getElementById("notifList");
    if (!listEl) return;
    if (notifications.length === 0) {
      listEl.innerHTML = `<div class="notif-empty">通知はありません</div>`;
      return;
    }
    listEl.innerHTML = notifications.map(n => {
      const isUnread = !readIds.includes(n.id);
      const date = n.createdAt.toDate();
      // linkがある通知（フォロー中のユーザーの新規単語帳など）はクリックで遷移できるようにする。
      // 単語帳ID等から組み立てた相対パスのみを許可し、外部URLやjavascript:等の
      // 意図しない遷移先を書き込まれても実害が出ないようにする。
      const isSafeLink = typeof n.link === "string" && /^[a-zA-Z0-9_-]+\.html(\?[a-zA-Z0-9_=&%.-]*)?$/.test(n.link);
      const tag = isSafeLink ? "a" : "div";
      const hrefAttr = isSafeLink ? ` href="${escapeHtml(n.link)}"` : "";
      return `
        <${tag} class="notif-item${isUnread ? " notif-unread" : ""}"${hrefAttr}>
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-body">${escapeHtml(n.body)}</div>
          <div class="notif-item-time">${formatRelativeTime(date)}</div>
        </${tag}>
      `;
    }).join("");
  }

  function toggleDropdown() {
    const dd = document.getElementById("notifDropdown");
    if (!dd) return;
    dropdownOpen = !dropdownOpen;
    dd.style.display = dropdownOpen ? "flex" : "none";
    if (dropdownOpen && mobileMenuOpen) setMobileMenuOpen(false);
    if (dropdownOpen && markAllReadImpl) {
      markAllReadImpl();
    }
  }

  function closeDropdown() {
    const dd = document.getElementById("notifDropdown");
    if (dd) dd.style.display = "none";
    dropdownOpen = false;
  }

  // ===== ヘッダーの自分のアイコン =====
  // ログアウトボタンの右に自分のプロフィール写真(未設定なら期の色の人物アイコン)を置き、
  // 押すと自分のプロフィールページ(user.html)へ移動する。表示・非表示は各ページが
  // 切り替えているログアウトボタンの表示状態にそのまま合わせる。
  const HEADER_AVATAR_CACHE_KEY = "vocaboost_header_avatar";

  function loadHeaderAvatarCache() {
    try {
      return JSON.parse(localStorage.getItem(HEADER_AVATAR_CACHE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function saveHeaderAvatarCache(data) {
    try {
      localStorage.setItem(HEADER_AVATAR_CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      // 写真が大きく容量超過した場合は写真なしで保存する
      try {
        localStorage.setItem(HEADER_AVATAR_CACHE_KEY, JSON.stringify({ ...data, photoURL: null }));
      } catch (e2) { }
    }
  }

  function syncHeaderAvatarVisibility() {
    const link = document.getElementById("vbHeaderAvatar");
    const logoutBtn = document.getElementById("logoutBtn");
    if (!link || !logoutBtn) return;
    link.style.display = logoutBtn.style.display === "none" ? "none" : "inline-flex";
  }

  function renderHeaderAvatar(data) {
    if (!data || !data.uid) return;
    renderMobileMenuProfile(data);
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn) return;

    let link = document.getElementById("vbHeaderAvatar");
    if (!link) {
      link = document.createElement("a");
      link.id = "vbHeaderAvatar";
      link.className = "vb-header-avatar";
      link.setAttribute("aria-label", "自分のプロフィール");
      link.title = "自分のプロフィール";
      logoutBtn.insertAdjacentElement("afterend", link);
      new MutationObserver(syncHeaderAvatarVisibility)
        .observe(logoutBtn, { attributes: true, attributeFilter: ["style"] });
    }
    link.href = "user.html?id=" + encodeURIComponent(data.uid);
    link.innerHTML = avatarHtml(data.photoURL, 34, data.cohort);
    syncHeaderAvatarVisibility();
  }

  // プロフィール写真などを変更したページから呼び出し、ヘッダーのアイコンを即座に更新する
  window.VOCABOOST_UPDATE_HEADER_AVATAR = function (partial) {
    const current = loadHeaderAvatarCache() || {};
    const updated = { ...current, ...partial };
    saveHeaderAvatarCache(updated);
    renderHeaderAvatar(updated);
  };

  /* ===== スマホ幅のヘッダー：ハンバーガーメニュー =====
     スマホ幅(768px以下)ではヘッダーのボタン(設定・ログアウト等)をCSSで隠し、
     右端のハンバーガーメニューの中にまとめる。メニューの一番上には自分の写真と
     ユーザー名(押すと自分のプロフィールへ)を出す。メニュー内の各項目は、
     各ページがもともと持っているボタンの表示状態に合わせて出し分け、
     押されたら元のボタンのクリックをそのまま呼び出す（ページ側の処理を再利用するため）。 */
  const MENU_ICON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  let mobileMenuOpen = false;

  function ensureMobileMenu() {
    let wrap = document.getElementById("vbMobileMenuWrap");
    if (wrap) return wrap;
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn || !logoutBtn.parentElement) return null;

    wrap = document.createElement("span");
    wrap.id = "vbMobileMenuWrap";
    wrap.className = "vb-mobile-menu-wrap";
    wrap.innerHTML = `
      <button type="button" id="vbMobileMenuBtn" class="vb-mobile-menu-btn" aria-label="メニュー" aria-expanded="false">${MENU_ICON_SVG}</button>
      <div id="vbMobileMenu" class="vb-mobile-menu" style="display:none">
        <a id="vbMenuProfile" class="vb-menu-profile" style="display:none"></a>
        <button type="button" class="vb-menu-item" data-target="adminLink" style="display:none">運営</button>
        <button type="button" class="vb-menu-item" data-target="settingsBtn" style="display:none">設定</button>
        <button type="button" class="vb-menu-item" data-target="loginBtn" style="display:none">ログイン</button>
        <button type="button" class="vb-menu-item" data-target="logoutBtn" style="display:none">ログアウト</button>
      </div>
    `;
    logoutBtn.parentElement.appendChild(wrap);

    const btn = wrap.querySelector("#vbMobileMenuBtn");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMobileMenuOpen(!mobileMenuOpen);
    });
    wrap.querySelectorAll(".vb-menu-item").forEach(item => {
      item.addEventListener("click", () => {
        setMobileMenuOpen(false);
        const original = findMenuTarget(item.dataset.target);
        if (original) original.click();
      });
    });
    document.addEventListener("click", (e) => {
      if (mobileMenuOpen && !wrap.contains(e.target)) setMobileMenuOpen(false);
    });

    // 元のボタンの表示・非表示が切り替わったらメニュー側も追従させる
    const observer = new MutationObserver(syncMobileMenuItems);
    ["settingsBtn", "loginBtn", "logoutBtn"].forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ["style"] });
    });
    const bellContainer = document.getElementById("notifBellContainer");
    if (bellContainer) observer.observe(bellContainer, { childList: true });

    syncMobileMenuItems();
    return wrap;
  }

  function findMenuTarget(target) {
    if (target === "adminLink") return document.querySelector(".admin-link-btn");
    return document.getElementById(target);
  }

  function isShown(el) {
    return !!el && el.style.display !== "none";
  }

  function syncMobileMenuItems() {
    const wrap = document.getElementById("vbMobileMenuWrap");
    if (!wrap) return;
    wrap.querySelectorAll(".vb-menu-item").forEach(item => {
      item.style.display = isShown(findMenuTarget(item.dataset.target)) ? "block" : "none";
    });
    const profile = document.getElementById("vbMenuProfile");
    if (profile) {
      const loggedIn = isShown(document.getElementById("logoutBtn"));
      profile.style.display = loggedIn && profile.dataset.ready ? "flex" : "none";
    }
  }

  function setMobileMenuOpen(open) {
    mobileMenuOpen = open;
    const menu = document.getElementById("vbMobileMenu");
    const btn = document.getElementById("vbMobileMenuBtn");
    if (menu) menu.style.display = open ? "block" : "none";
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      syncMobileMenuItems();
      closeDropdown();
    }
  }

  function renderMobileMenuProfile(data) {
    if (!ensureMobileMenu()) return;
    const profile = document.getElementById("vbMenuProfile");
    profile.href = "user.html?id=" + encodeURIComponent(data.uid);
    profile.innerHTML =
      avatarHtml(data.photoURL, 44, data.cohort) +
      '<span class="vb-menu-profile-text">' +
      '<span class="vb-menu-profile-name">' + escapeHtml(data.username || "ユーザー名未設定") + '</span>' +
      '<span class="vb-menu-profile-sub">プロフィールを見る</span>' +
      '</span>';
    profile.dataset.ready = "1";
    syncMobileMenuItems();
  }

  // ログイン中キャッシュが無い(未ログイン)場合でも、ログインボタン入りのメニューは用意する
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureMobileMenu);
  } else {
    ensureMobileMenu();
  }

  (function renderHeaderAvatarFromCache() {
    let savedUser;
    try {
      savedUser = JSON.parse(localStorage.getItem("cachedUser"));
    } catch (e) {
      savedUser = null;
    }
    if (!savedUser || !savedUser.uid) return;
    const cache = loadHeaderAvatarCache();
    renderHeaderAvatar(cache && cache.uid === savedUser.uid ? cache : { uid: savedUser.uid });
  })();

  // ページ表示直後、Firebaseの初期化やネットワーク応答を一切待たずに、
  // 前回訪問時のキャッシュがあればベル・バッジ・運営リンクを即座に表示する。
  // ここでの表示はあくまで暫定であり、この後 onAuthStateChanged 側で
  // 実際のデータを取得し次第、正しい内容に更新・保存し直される。
  (function renderFromCacheEarly() {
    let savedUser;
    try {
      savedUser = JSON.parse(localStorage.getItem("cachedUser"));
    } catch (e) {
      savedUser = null;
    }
    if (!savedUser || !savedUser.uid) return;

    const cache = loadNotifCache(savedUser.uid);
    if (!cache) return;

    notifications = cache.notifications || [];
    readIds = cache.readIds || [];

    renderBell();
    updateBadge();
    renderList();

    if (cache.isAdmin) {
      renderAdminLink();
    }
  })();

  waitForFirebase(() => {
    const auth = firebase.auth();
    const db = firebase.firestore();

    auth.onAuthStateChanged(async (user) => {
      if (!user) return;

      const isAdmin = ADMIN_EMAILS.includes(user.email);

      // 管理者かどうかはFirebase Authのemailだけで分かるため、Firestoreへの
      // 問い合わせを待たずにベルの外枠・運営リンクを先に出しておく
      // （既にキャッシュから描画済みなら renderBell/renderAdminLink は何もしない）
      renderBell();
      if (isAdmin) {
        renderAdminLink();
      }

      let userData = null;
      try {
        const snap = await db.collection("users").doc(user.uid).get();
        userData = snap.exists ? snap.data() : null;
      } catch (e) {
        console.error("account-widgets: failed to load user status", e);
      }

      // 凍結（アカウント利用停止）されている場合は強制的にログアウトさせる
      if (userData && userData.frozen === true) {
        alert("このアカウントは運営により利用停止されています。");
        localStorage.removeItem("cachedUser");
        localStorage.removeItem(notifCacheKey(user.uid));
        await auth.signOut();
        location.href = "login.html";
        return;
      }

      const headerAvatarData = {
        uid: user.uid,
        username: (userData && userData.username) || user.displayName || "",
        photoURL: (userData && userData.photoURL) || null,
        cohort: cohortFromEmail(user.email || (userData && userData.email))
      };
      saveHeaderAvatarCache(headerAvatarData);
      renderHeaderAvatar(headerAvatarData);

      readIds = (userData && userData.readNotificationIds) || [];
      updateBadge();
      renderList();

      repairUserDoc(user, userData);
      updateLastSeen(user, userData);
      ensureCohort(user, userData);
      syncBookCount(user, userData);

      // 通知一覧はページを移動するたびに最大60件を読み直していたため、
      // 直近(NOTIF_REFRESH_MS以内)に取得したキャッシュがあればそれを使い、通信を省く
      const cached = loadNotifCache(user.uid);
      if (cached && cached.savedAt && Date.now() - cached.savedAt < NOTIF_REFRESH_MS && cached.isAdmin === isAdmin) {
        notifications = cached.notifications || [];
        notifFetchedAt = cached.savedAt;
        updateBadge();
        renderList();
        saveNotifCache(user.uid, isAdmin);
        return;
      }
      await loadNotifications(user, isAdmin);
      notifFetchedAt = Date.now();
      saveNotifCache(user.uid, isAdmin);
    });

    // 運営ページで「最終閲覧日」を確認できるよう、ページ訪問のたびに
    // users/{uid}.lastSeenAt を更新する。ただし毎回のページ遷移で書き込むと
    // 無駄が多いため、前回の記録から一定時間以上経っている場合のみ更新する。
    const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000; // 10分
    async function updateLastSeen(user, userData) {
      const lastSeenMillis = userData && userData.lastSeenAt && typeof userData.lastSeenAt.toMillis === "function"
        ? userData.lastSeenAt.toMillis()
        : 0;
      if (Date.now() - lastSeenMillis < LAST_SEEN_THROTTLE_MS) return;

      try {
        await db.collection("users").doc(user.uid).set({
          lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.error("account-widgets: failed to update lastSeenAt", e);
      }
    }

    // 過去、ユーザー名変更機能が users/{uid} を merge:true なしで set() していたため、
    // 一部アカウントで email / createdAt 等のフィールドが消えてしまっていた（修正済み）。
    // その被害を受けたアカウントが再ログインした際に、Authに残っている情報から
    // 最低限（email）を自動的に復元する。createdAt は元の値が失われているため、
    // 復元時点の日時を「復元日」として補完する（正確な登録日ではない点に注意）。
    async function repairUserDoc(user, userData) {
      if (!userData) return;
      const patch = {};
      if (!userData.email && user.email) {
        patch.email = user.email;
      }
      if (!userData.createdAt) {
        patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      }
      if (Object.keys(patch).length === 0) return;

      try {
        await db.collection("users").doc(user.uid).set(patch, { merge: true });
        console.warn("account-widgets: repaired missing user fields for", user.uid, patch);
      } catch (e) {
        console.error("account-widgets: failed to repair user doc", e);
      }
    }

    // 他人の非公開単語帳はFirestoreルール上読み取れないため、プロフィールページ(user.html)で
    // 「作成した単語帳数」を表示できるよう、自分の単語帳数を users/{uid}.bookCount に保存しておく。
    // 集計クエリ(count)が使える場合は毎回、使えない場合は全件取得になるため10分に1回だけ更新する。
    const BOOK_COUNT_THROTTLE_MS = 10 * 60 * 1000;
    async function syncBookCount(user, userData) {
      if (!userData) return;
      try {
        const query = db.collection("wordbooks").where("owner", "==", user.uid);
        let count;
        if (typeof query.count === "function") {
          const agg = await query.count().get();
          count = agg.data().count;
        } else {
          const key = "vocaboost_bookcount_synced_" + user.uid;
          const last = Number(localStorage.getItem(key) || 0);
          if (typeof userData.bookCount === "number" && Date.now() - last < BOOK_COUNT_THROTTLE_MS) return;
          count = (await query.get()).size;
          try { localStorage.setItem(key, String(Date.now())); } catch (e) { }
        }
        if (userData.bookCount !== count) {
          await db.collection("users").doc(user.uid).set({ bookCount: count }, { merge: true });
        }
      } catch (e) {
        console.error("account-widgets: failed to sync book count", e);
      }
    }

    // 過去に作られたアカウントも含め、ログイン時に期(学年タグ)が未設定・不一致なら付与し、
    // 自分の単語帳にも複製する。一度反映されれば以降は何もしない。
    async function ensureCohort(user, userData) {
      if (!userData) return;
      const cohort = cohortFromEmail(user.email || userData.email);
      if (userData.cohort === cohort) return;
      try {
        await window.VOCABOOST_APPLY_COHORT(db, user.uid, cohort, userData);
      } catch (e) {
        console.error("account-widgets: failed to apply cohort", e);
      }
    }

    async function loadNotifications(user, isAdmin) {
      // 「全員向け」「自分宛て」「（管理者のみ）通報などの運営宛て」は別クエリなので、
      // どれかが失敗（未作成の複合インデックス等）しても、他の結果まで巻き添えで
      // 消えないように allSettled で個別に扱う。
      // target=="admin" の通知は一般ユーザーの画面には出す必要が無いため、
      // 管理者のときだけ問い合わせる。
      const queries = [
        db.collection("notifications").where("target", "==", "all").orderBy("createdAt", "desc").limit(20).get(),
        db.collection("notifications").where("targetUserIds", "array-contains", user.uid).orderBy("createdAt", "desc").limit(20).get()
      ];
      const labels = ["全員向け通知", "自分宛て通知（複合インデックスが未作成の可能性）"];
      if (isAdmin) {
        queries.push(db.collection("notifications").where("target", "==", "admin").orderBy("createdAt", "desc").limit(20).get());
        labels.push("運営宛て通知");
      }

      const results = await Promise.allSettled(queries);

      const map = new Map();
      results.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          result.value.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
        } else {
          console.error(`account-widgets: failed to load ${labels[idx]}`, result.reason);
        }
      });

      notifications = Array.from(map.values())
        .filter(n => n.createdAt && typeof n.createdAt.toMillis === "function")
        .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
        .slice(0, 20);

      updateBadge();
      renderList();
    }

    markAllReadImpl = async function markAllRead() {
      const user = auth.currentUser;
      if (!user) return;
      const unreadIds = notifications.filter(n => !readIds.includes(n.id)).map(n => n.id);
      if (unreadIds.length === 0) return;
      readIds = readIds.concat(unreadIds);
      updateBadge();
      renderList();
      try {
        await db.collection("users").doc(user.uid).update({
          readNotificationIds: firebase.firestore.FieldValue.arrayUnion(...unreadIds)
        });
        saveNotifCache(user.uid, ADMIN_EMAILS.includes(user.email));
      } catch (e) {
        console.error("account-widgets: failed to mark notifications as read", e);
      }
    };
  });
})();
