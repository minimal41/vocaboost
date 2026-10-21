// notificationsコレクションに通知が追加されたら、宛先ユーザーのスマホへプッシュ通知を送る。
// 端末のFCMトークンは account-widgets.js（設定ページでプッシュ通知をオンにした時）が
// pushTokens/{トークン} に { uid, token } として保存している。
// 表示は service-worker.js が行うため、表示用のnotificationは付けずにdataメッセージとして送る。
//
// デプロイ: Firebaseプロジェクトを従量課金(Blaze)プランにしたうえで
//   cd functions && npm install && cd .. && firebase deploy --only functions
const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");

initializeApp();

// account-widgets.js / admin.html / firestore.rules などと同じ管理者一覧。
// 管理者を追加/削除する場合はこちらも書き換えること。
const ADMIN_EMAILS = [
  "202301745@edu.nishiyamato.ed.jp",
  "202305145@edu.nishiyamato.ed.jp"
];

// Firestoreの in クエリで一度に指定できる件数 / FCMの一括送信で一度に送れる件数
const IN_QUERY_LIMIT = 30;
const MULTICAST_LIMIT = 500;

// 通知ベル・通知一覧ページ・service-worker.js と同じ安全性チェック
function isSafeLink(link) {
  return typeof link === "string" && /^[a-zA-Z0-9_-]+\.html(\?[a-zA-Z0-9_=&%.-]*)?$/.test(link);
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

async function adminUids() {
  const result = await getAuth().getUsers(ADMIN_EMAILS.map(email => ({ email })));
  return result.users.map(u => u.uid);
}

// 通知の宛先(target / targetUserIds)から、送信先のトークン一覧を求める
async function tokensForNotification(notif) {
  const db = getFirestore();

  if (notif.target === "all") {
    const snap = await db.collection("pushTokens").get();
    return snap.docs.map(d => d.id);
  }

  let uids;
  if (notif.target === "admin") {
    uids = await adminUids();
  } else {
    uids = Array.isArray(notif.targetUserIds) ? notif.targetUserIds : [];
  }
  uids = [...new Set(uids.filter(uid => typeof uid === "string" && uid))];

  const snaps = await Promise.all(chunk(uids, IN_QUERY_LIMIT).map(group =>
    db.collection("pushTokens").where("uid", "in", group).get()
  ));
  return snaps.flatMap(snap => snap.docs.map(d => d.id));
}

exports.sendPushOnNotificationCreated = functions
  .region("asia-northeast1")
  .firestore.document("notifications/{notifId}")
  .onCreate(async (snap, context) => {
    const notif = snap.data() || {};
    const tokens = [...new Set(await tokensForNotification(notif))];
    if (tokens.length === 0) return;

    // dataメッセージの値はすべて文字列にする必要がある
    const data = {
      notifId: context.params.notifId,
      title: String(notif.title || "Vocaboost").slice(0, 200),
      body: String(notif.body || "").slice(0, 1000),
      link: isSafeLink(notif.link) ? notif.link : "notifications.html"
    };

    const messaging = getMessaging();
    const invalidTokens = [];
    let successCount = 0;

    for (const group of chunk(tokens, MULTICAST_LIMIT)) {
      const response = await messaging.sendEachForMulticast({
        tokens: group,
        data,
        webpush: {
          // 端末がスリープ中でもすぐ届くようにし、届かなかった場合は1日で破棄する
          headers: { Urgency: "high", TTL: String(24 * 60 * 60) }
        }
      });
      successCount += response.successCount;
      response.responses.forEach((res, idx) => {
        if (res.success) return;
        const code = res.error && res.error.code;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
          invalidTokens.push(group[idx]);
        } else {
          logger.warn("push send failed", { code, message: res.error && res.error.message });
        }
      });
    }

    // アプリの削除・通知の解除などで無効になったトークンは、次回以降送らないよう削除する
    if (invalidTokens.length > 0) {
      const db = getFirestore();
      await Promise.all(chunk(invalidTokens, 500).map(group => {
        const batch = db.batch();
        group.forEach(token => batch.delete(db.collection("pushTokens").doc(token)));
        return batch.commit();
      }));
    }

    logger.info("push sent", {
      notifId: context.params.notifId,
      target: notif.target,
      tokens: tokens.length,
      success: successCount,
      removed: invalidTokens.length
    });
  });
