// アクセス解析（analytics.html、運営専用）のための計測スクリプト。
// 各ページの </body> 直前で読み込むだけで、そのページの表示のたびに
// Pv（ページビュー）・Ss（セッション）を30分単位の集計バケットに加算する。
// admin.html / analytics.html 自体は運営の閲覧で数値が膨らまないよう、意図的にこのスクリプトを読み込んでいない。
//
// Pv: 同じ端末からのビューであっても、バケット内のアクセスをすべて数える（表示のたびに+1）。
// Ss: 同じ端末は同じ30分バケット内では1回しか数えない。30分経って次のバケットに移ると、
//     同じ端末からのアクセスも改めて1回として数える。
//
// バックエンドを持たない静的サイトのため、集計はブラウザから直接Firestoreに書き込む方式を取っている。
// そのため未ログインの利用者（ログイン画面など）でも書き込めるよう、firestore.rules 側では
// analytics / analyticsSessionMarkers への書き込みをログイン状態に関わらず許可しつつ、
// 1回の書き込みで増やせる件数を厳しく制限（pvは常に+1、ssは+0か+1のみ）することで、
// 悪意のある大量書き込みによる数値の水増しをある程度防いでいる（完全な対策ではない点に注意）。
(function () {
  function waitForFirebase(cb) {
    if (window.firebase && firebase.apps && firebase.apps.length > 0) {
      cb();
    } else {
      setTimeout(() => waitForFirebase(cb), 100);
    }
  }

  // 端末を識別するためのランダムなIDをlocalStorageに保存し、以後の訪問でも使い回す。
  // localStorageが使えない環境（プライベートブラウズ等）ではSsの計測のみ諦める（Pvは計測できる）。
  function getDeviceId() {
    try {
      let id = localStorage.getItem("vocaboost_deviceId");
      if (!id) {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
        localStorage.setItem("vocaboost_deviceId", id);
      }
      return id;
    } catch (e) {
      return null;
    }
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // 現在時刻が属する30分バケット（00分 or 30分始まり）のIDと開始時刻を返す。
  // 例: 13:12 → "202608301300"、13:47 → "202608301330"
  function getBucket(date) {
    const d = new Date(date.getTime());
    const minutes = d.getMinutes() < 30 ? 0 : 30;
    d.setMinutes(minutes, 0, 0);
    const id = "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(minutes);
    return { id: id, start: d };
  }

  waitForFirebase(async () => {
    if (!firebase.firestore) return;
    const db = firebase.firestore();
    const bucket = getBucket(new Date());
    const deviceId = getDeviceId();

    let ssDelta = 0;
    if (deviceId) {
      const markerId = bucket.id + "_" + deviceId;
      try {
        // 同じ(バケット, 端末)の組み合わせでは一度しか作成に成功しないため、
        // これが成功したときだけ「このバケットでのこの端末からの初回アクセス」と分かる。
        await db.collection("analyticsSessionMarkers").doc(markerId).set({
          bucket: bucket.id,
          device: deviceId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        ssDelta = 1;
      } catch (e) {
        // 既にこのバケット・この端末からのアクセスを記録済み（2回目以降の表示）→ Ssは増やさない
        ssDelta = 0;
      }
    }

    db.collection("analytics").doc(bucket.id).set({
      bucketStart: firebase.firestore.Timestamp.fromDate(bucket.start),
      pv: firebase.firestore.FieldValue.increment(1),
      ss: firebase.firestore.FieldValue.increment(ssDelta),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(e => console.warn("analytics-tracker: failed to record view", e));
  });
})();
