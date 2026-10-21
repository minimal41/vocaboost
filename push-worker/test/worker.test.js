// GoogleのAPI(公開鍵・OAuth・Firestore・Identity Toolkit・FCM)を偽物に差し替えて、
// 認証・宛先の決定・二重送信の防止・分割送信・無効トークンの削除を確認する。
import { test, before } from "node:test";
import assert from "node:assert/strict";

const PROJECT = "test-project";
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

let worker, Sender, env, idKey, state;

async function rsaKeyPair() {
  return crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"]);
}

async function makeIdToken(uid, email, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const payload = b64url(JSON.stringify({
    aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub: uid, email, iat: now, exp: now + 3600, ...overrides
  }));
  const sig = await crypto.subtle.sign(RS256, idKey.privateKey, new TextEncoder().encode(header + "." + payload));
  return header + "." + payload + "." + b64url(sig);
}

const str = (v) => ({ stringValue: v });

function addNotification(id, data) {
  state.notifications[id] = data;
}

function setupFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
    const res = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "cache-control": "max-age=3600" } });

    if (url.includes("securetoken@system")) {
      const jwk = await crypto.subtle.exportKey("jwk", idKey.publicKey);
      return res(200, { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
    }
    if (url === "https://oauth2.googleapis.com/token") return res(200, { access_token: "AT", expires_in: 3600 });

    assert.equal(init.headers.Authorization, "Bearer AT");
    const docs = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
    let m;
    if ((m = url.match(/\/documents\/notifications\/(\w+)$/))) {
      const n = state.notifications[m[1]];
      if (!n) return res(404, {});
      return res(200, {
        fields: {
          title: str(n.title), body: str(n.body), target: str(n.target), createdBy: str(n.createdBy),
          link: str(n.link || ""),
          createdAt: { timestampValue: new Date(n.createdAt ?? Date.now()).toISOString() },
          targetUserIds: { arrayValue: { values: (n.targetUserIds || []).map(str) } }
        }
      });
    }
    if ((m = url.match(/\/documents\/pushSent\?documentId=(\w+)$/))) {
      if (state.pushSent.has(m[1])) return res(409, {});
      state.pushSent.add(m[1]);
      return res(200, {});
    }
    if (url === docs + ":runQuery") {
      state.queries++;
      const where = body.structuredQuery.where;
      const uids = where ? where.fieldFilter.value.arrayValue.values.map(v => v.stringValue) : null;
      const rows = state.tokens
        .filter(t => !uids || uids.includes(t.uid))
        .map(t => ({ document: { fields: { uid: str(t.uid), token: str(t.token) } } }));
      return res(200, rows.length ? rows : [{ readTime: "x" }]);
    }
    if (url === docs + ":batchWrite") {
      body.writes.forEach(w => state.deleted.push(w.delete.split("/").pop()));
      return res(200, {});
    }
    if (url.endsWith("/accounts:lookup")) {
      return res(200, { users: body.email.map(e => ({ localId: "uid-" + e })) });
    }
    if (url === `https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`) {
      const token = body.message.token;
      state.sent.push(body.message);
      if (token.startsWith("dead")) return res(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } });
      return res(200, { name: "ok" });
    }
    throw new Error("unexpected fetch " + url);
  };
}

async function notify(notifId, idToken) {
  const req = new Request("https://worker.example/notify", {
    method: "POST",
    headers: { Authorization: "Bearer " + idToken, "Content-Type": "application/json" },
    body: JSON.stringify({ notifId })
  });
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json() };
}

before(async () => {
  idKey = await rsaKeyPair();
  const saKey = await rsaKeyPair();
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", saKey.privateKey)).toString("base64");
  const mod = await import("../src/index.js");
  worker = mod.default;
  Sender = mod.Sender;
  env = {
    ADMIN_EMAILS: "admin@example.com",
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: PROJECT,
      client_email: "sa@example.com",
      private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`
    })
  };
  env.SENDER = new Sender({}, env);
  setupFetch();
});

function reset(tokens) {
  state = { notifications: {}, pushSent: new Set(), tokens, sent: [], deleted: [], queries: 0 };
}

test("作成者の依頼で宛先ユーザーの端末にだけ送り、二度目は送らない", async () => {
  reset([{ uid: "bob", token: "bob-phone" }, { uid: "bob", token: "bob-tablet" }, { uid: "carol", token: "carol-phone" }]);
  addNotification("n1", { title: "新しいフォロワーがいます", body: "aliceさんにフォローされました", target: "follow", targetUserIds: ["bob"], createdBy: "alice", link: "user.html?id=alice" });
  const token = await makeIdToken("alice", "alice@example.com");

  const first = await notify("n1", token);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { tokens: 2, success: 2, removed: 0 });
  assert.deepEqual(state.sent.map(m => m.token).sort(), ["bob-phone", "bob-tablet"]);
  assert.deepEqual(state.sent[0].data, { notifId: "n1", title: "新しいフォロワーがいます", body: "aliceさんにフォローされました", link: "user.html?id=alice" });

  const second = await notify("n1", token);
  assert.equal(second.status, 200);
  assert.equal(second.body.skipped, "already sent");
  assert.equal(state.sent.length, 2);
});

test("作成者でも管理者でもないユーザーの依頼は拒否する", async () => {
  reset([{ uid: "bob", token: "bob-phone" }]);
  addNotification("n2", { title: "t", body: "b", target: "follow", targetUserIds: ["bob"], createdBy: "alice" });
  const res = await notify("n2", await makeIdToken("mallory", "mallory@example.com"));
  assert.equal(res.status, 403);
  assert.equal(state.sent.length, 0);
});

test("不正・期限切れ・別プロジェクトのIDトークンは拒否する", async () => {
  reset([]);
  addNotification("n3", { title: "t", body: "b", target: "follow", targetUserIds: ["bob"], createdBy: "alice" });
  assert.equal((await notify("n3", "garbage")).status, 401);
  assert.equal((await notify("n3", await makeIdToken("alice", "", { exp: 1 }))).status, 401);
  assert.equal((await notify("n3", await makeIdToken("alice", "", { aud: "other" }))).status, 401);
  const t = await makeIdToken("alice", "");
  const tampered = t.split(".");
  tampered[1] = b64url(JSON.stringify({ ...JSON.parse(Buffer.from(tampered[1], "base64url")), sub: "admin" }));
  assert.equal((await notify("n3", tampered.join("."))).status, 401);
});

test("古い通知は送らない", async () => {
  reset([{ uid: "bob", token: "bob-phone" }]);
  addNotification("n4", { title: "t", body: "b", target: "follow", targetUserIds: ["bob"], createdBy: "alice", createdAt: Date.now() - 60 * 60 * 1000 });
  assert.equal((await notify("n4", await makeIdToken("alice", ""))).status, 409);
  assert.equal(state.sent.length, 0);
});

test("全員向け: 管理者の依頼で多数の端末に分割して送り、無効なトークンを削除する", async () => {
  const tokens = [];
  for (let i = 0; i < 2500; i++) tokens.push({ uid: "u" + i, token: (i % 100 === 0 ? "dead-" : "t-") + i });
  reset(tokens);
  addNotification("n5", { title: "お知らせ", body: "メンテナンス", target: "all", createdBy: "admin-uid", link: "https://evil.example" });

  const res = await notify("n5", await makeIdToken("admin-uid", "admin@example.com"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { tokens: 2500, success: 2475, removed: 25 });
  assert.equal(new Set(state.sent.map(m => m.token)).size, 2500);
  assert.equal(state.deleted.length, 25);
  // 外部URLへのリンクは通知一覧ページに置き換える
  assert.equal(state.sent[0].data.link, "notifications.html");
});

test("運営宛て: 管理者の端末に送る / 宛先が多い場合は全件取得して絞り込む", async () => {
  reset([{ uid: "uid-admin@example.com", token: "admin-phone" }, { uid: "bob", token: "bob-phone" }]);
  addNotification("n6", { title: "新しい通報があります", body: "b", target: "admin", targetUserIds: [], createdBy: "bob" });
  const res = await notify("n6", await makeIdToken("bob", "bob@example.com"));
  assert.deepEqual(res.body, { tokens: 1, success: 1, removed: 0 });
  assert.equal(state.sent[0].token, "admin-phone");

  const followers = Array.from({ length: 1000 }, (_, i) => "f" + i);
  reset([...followers.slice(0, 50).map(uid => ({ uid, token: uid + "-phone" })), { uid: "stranger", token: "stranger-phone" }]);
  addNotification("n7", { title: "t", body: "b", target: "follow_new_book", targetUserIds: followers, createdBy: "alice" });
  const res2 = await notify("n7", await makeIdToken("alice", ""));
  assert.deepEqual(res2.body, { tokens: 50, success: 50, removed: 0 });
  assert.equal(state.queries, 1);
  assert.ok(!state.sent.some(m => m.token === "stranger-phone"));
});
