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

  waitForFirebase(() => {
    const auth = firebase.auth();
    const db = firebase.firestore();

    let notifications = [];
    let readIds = [];
    let dropdownOpen = false;

    auth.onAuthStateChanged(async (user) => {
      if (!user) return;

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
        await auth.signOut();
        location.href = "login.html";
        return;
      }

      readIds = (userData && userData.readNotificationIds) || [];

      repairUserDoc(user, userData);

      renderBell();
      loadNotifications(user);

      if (ADMIN_EMAILS.includes(user.email)) {
        renderAdminLink();
      }
    });

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

    function renderBell() {
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

    function renderAdminLink() {
      const container = document.getElementById("notifBellContainer");
      if (!container) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "header-btn admin-link-btn";
      btn.textContent = "運営";
      btn.addEventListener("click", () => { location.href = "admin.html"; });
      container.appendChild(btn);
    }

    async function loadNotifications(user) {
      try {
        const [allSnap, mineSnap] = await Promise.all([
          db.collection("notifications").where("target", "==", "all").orderBy("createdAt", "desc").limit(20).get(),
          db.collection("notifications").where("targetUserIds", "array-contains", user.uid).orderBy("createdAt", "desc").limit(20).get()
        ]);

        const map = new Map();
        allSnap.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
        mineSnap.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));

        notifications = Array.from(map.values())
          .filter(n => n.createdAt && typeof n.createdAt.toMillis === "function")
          .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
          .slice(0, 20);

        updateBadge();
        renderList();
      } catch (e) {
        console.error("account-widgets: failed to load notifications", e);
      }
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
      if (dropdownOpen) {
        markAllRead();
      }
    }

    function closeDropdown() {
      const dd = document.getElementById("notifDropdown");
      if (dd) dd.style.display = "none";
      dropdownOpen = false;
    }

    async function markAllRead() {
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
      } catch (e) {
        console.error("account-widgets: failed to mark notifications as read", e);
      }
    }
  });
})();
