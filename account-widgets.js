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
  // sizePxは正方形の一辺の長さ(px)。
  function avatarHtml(photoURL, sizePx) {
    const size = Number(sizePx) || 32;
    const style = "width:" + size + "px;height:" + size + "px;";
    if (isValidProfilePhotoUrl(photoURL)) {
      return '<img src="' + photoURL + '" alt="" class="vb-avatar-img" style="' + style + '">';
    }
    return '<span class="vb-avatar-icon" style="' + style + '">' + PERSON_ICON_SVG + '</span>';
  }

  window.VOCABOOST_AVATAR_HTML = avatarHtml;
  window.VOCABOOST_IS_VALID_PHOTO_URL = isValidProfilePhotoUrl;

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
  function saveNotifCache(uid, isAdmin) {
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
        isAdmin: isAdmin
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
      return `
        <div class="notif-item${isUnread ? " notif-unread" : ""}">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-body">${escapeHtml(n.body)}</div>
          <div class="notif-item-time">${formatRelativeTime(date)}</div>
        </div>
      `;
    }).join("");
  }

  function toggleDropdown() {
    const dd = document.getElementById("notifDropdown");
    if (!dd) return;
    dropdownOpen = !dropdownOpen;
    dd.style.display = dropdownOpen ? "block" : "none";
    if (dropdownOpen && markAllReadImpl) {
      markAllReadImpl();
    }
  }

  function closeDropdown() {
    const dd = document.getElementById("notifDropdown");
    if (dd) dd.style.display = "none";
    dropdownOpen = false;
  }

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

      readIds = (userData && userData.readNotificationIds) || [];
      updateBadge();
      renderList();

      repairUserDoc(user, userData);
      updateLastSeen(user, userData);

      await loadNotifications(user, isAdmin);
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
