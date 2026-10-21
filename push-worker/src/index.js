// Vocaboost のプッシュ通知送信用 Cloudflare Worker。
//
// サイトのページは通知(notifications/{id})をFirestoreに作成した直後に、
// ログイン中ユーザーのFirebase IDトークンを付けて POST /notify { notifId } を呼ぶ
// （account-widgets.js の VOCABOOST_SEND_PUSH）。このWorkerは
//   1. IDトークンを検証し、呼び出した本人がその通知の作成者(createdBy)か管理者であることを確かめる
//   2. 同じ通知を二度送らないよう pushSent/{id} を作成する（既にあれば何もしない）
//   3. 通知の宛先(target / targetUserIds)から pushTokens の端末トークンを集める
//   4. Firebase Cloud Messaging(HTTP v1 API)で送信し、無効になったトークンを削除する
// を行う。Firestore・FCMへはサービスアカウント（管理者権限）でアクセスするため、
// Firestoreのルールに関係なく読み書きできる。秘密鍵はこのWorkerのsecretにだけ保存する。
//
// 無料プランでは1回の呼び出しで外部へ送れるリクエストが50件までのため、
// 送信は Sender（自分自身へのサービスバインディング）に40件ずつ分けて任せる。
import { WorkerEntrypoint } from "cloudflare:workers";

// 1回のSender呼び出しで送るトークン数（送信40件 + 無効トークン削除1件で50件に収まる）
const SEND_BATCH = 40;
// 1回のSender呼び出しから、さらに分けて呼び出すSenderの数の上限
const MAX_FANOUT = 40;
// Firestoreの IN クエリで一度に指定できる件数。宛先がこれの数倍を超える場合は
// 1件ずつ問い合わせると外部リクエストの上限を超えるため、全トークンを読んで絞り込む
const IN_QUERY_LIMIT = 30;
const MAX_IN_QUERIES = 5;
// これより前に作成された通知は送らない（古い通知を後から送り直されるのを防ぐ）
const MAX_NOTIFICATION_AGE_MS = 10 * 60 * 1000;

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.messaging";
const SECURETOKEN_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// 通知ベル・通知一覧ページ・service-worker.js と同じ安全性チェック
function isSafeLink(link) {
  return typeof link === "string" && /^[a-zA-Z0-9_-]+\.html(\?[a-zA-Z0-9_=&%.-]*)?$/.test(link);
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

// ===== JWT（Base64URL・RS256）=====

function base64UrlToBytes(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonToBase64Url(obj) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

// 同じWorkerインスタンスが続けて使われる間は、公開鍵・アクセストークンを使い回す
let jwksCache = null; // { keys: Map<kid, CryptoKey>, expiresAt }
let accessTokenCache = null; // { token, expiresAt }

async function getSecureTokenKeys() {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetch(SECURETOKEN_JWKS_URL);
  if (!res.ok) throw new Error("failed to fetch Firebase public keys: " + res.status);
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  const { keys } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, RS256, false, ["verify"]));
  }
  jwksCache = { keys: map, expiresAt: Date.now() + (maxAge ? parseInt(maxAge[1], 10) * 1000 : 60 * 60 * 1000) };
  return map;
}

// Firebase AuthのIDトークンを検証し、中身(uid・email)を返す。不正なら null
async function verifyIdToken(idToken, projectId) {
  const parts = (idToken || "").split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch (e) {
    return null;
  }
  if (header.alg !== "RS256") return null;

  const key = (await getSecureTokenKeys()).get(header.kid);
  if (!key) return null;
  const valid = await crypto.subtle.verify(
    RS256, key, base64UrlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) return null;
  if (payload.iss !== "https://securetoken.google.com/" + projectId) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (!(payload.exp > now) || !(payload.iat <= now + 300)) return null;
  return { uid: payload.sub, email: payload.email || "" };
}

function pemToPkcs8(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}

// サービスアカウントでGoogleのアクセストークンを取得する
async function getAccessToken(serviceAccount) {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60 * 1000) return accessTokenCache.token;

  const now = Math.floor(Date.now() / 1000);
  const unsigned = jsonToBase64Url({ alg: "RS256", typ: "JWT" }) + "." + jsonToBase64Url({
    iss: serviceAccount.client_email,
    scope: GOOGLE_SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  });
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(serviceAccount.private_key), RS256, false, ["sign"]);
  const signature = await crypto.subtle.sign(RS256, key, new TextEncoder().encode(unsigned));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + bytesToBase64Url(signature)
    })
  });
  if (!res.ok) throw new Error("failed to get access token: " + res.status + " " + await res.text());
  const json = await res.json();
  accessTokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

// ===== Firestore REST API =====

function documentsUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

// Firestore RESTの値の形式（{ stringValue: "..." } 等）を普通の値に戻す
function fromFirestoreValue(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  return undefined;
}

async function firestoreFetch(path, accessToken, init = {}) {
  return fetch(path, {
    ...init,
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", ...(init.headers || {}) }
  });
}

async function getNotification(projectId, accessToken, notifId) {
  const res = await firestoreFetch(`${documentsUrl(projectId)}/notifications/${encodeURIComponent(notifId)}`, accessToken);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed to read notification: " + res.status);
  const doc = await res.json();
  const data = {};
  for (const [k, v] of Object.entries(doc.fields || {})) data[k] = fromFirestoreValue(v);
  return data;
}

// pushSent/{notifId} を「まだ無い場合だけ」作成する。作成できたら true（＝これから送る）
async function claimNotification(projectId, accessToken, notifId, uid) {
  const res = await firestoreFetch(
    `${documentsUrl(projectId)}/pushSent?documentId=${encodeURIComponent(notifId)}`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        fields: { sentAt: { timestampValue: new Date().toISOString() }, requestedBy: { stringValue: uid } }
      })
    }
  );
  if (res.status === 409) return false;
  if (!res.ok) throw new Error("failed to create pushSent: " + res.status);
  return true;
}

async function runTokenQuery(projectId, accessToken, where) {
  const structuredQuery = {
    from: [{ collectionId: "pushTokens" }],
    select: { fields: [{ fieldPath: "uid" }, { fieldPath: "token" }] }
  };
  if (where) structuredQuery.where = where;
  const res = await firestoreFetch(`${documentsUrl(projectId)}:runQuery`, accessToken, {
    method: "POST",
    body: JSON.stringify({ structuredQuery })
  });
  if (!res.ok) throw new Error("failed to query pushTokens: " + res.status);
  const rows = await res.json();
  return rows
    .filter(row => row.document)
    .map(row => ({
      uid: fromFirestoreValue(row.document.fields.uid),
      token: fromFirestoreValue(row.document.fields.token)
    }))
    .filter(t => typeof t.token === "string" && t.token);
}

async function adminUids(projectId, accessToken, adminEmails) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmails })
  });
  if (!res.ok) throw new Error("failed to look up admin users: " + res.status);
  const json = await res.json();
  return (json.users || []).map(u => u.localId);
}

// 通知の宛先から送信先のトークン一覧を求める
async function tokensForNotification(notif, projectId, accessToken, adminEmails) {
  if (notif.target === "all") {
    return (await runTokenQuery(projectId, accessToken, null)).map(t => t.token);
  }

  let uids = notif.target === "admin"
    ? await adminUids(projectId, accessToken, adminEmails)
    : (Array.isArray(notif.targetUserIds) ? notif.targetUserIds : []);
  uids = [...new Set(uids.filter(uid => typeof uid === "string" && uid))];
  if (uids.length === 0) return [];

  if (uids.length > IN_QUERY_LIMIT * MAX_IN_QUERIES) {
    const wanted = new Set(uids);
    return (await runTokenQuery(projectId, accessToken, null)).filter(t => wanted.has(t.uid)).map(t => t.token);
  }
  const groups = await Promise.all(chunk(uids, IN_QUERY_LIMIT).map(group =>
    runTokenQuery(projectId, accessToken, {
      fieldFilter: {
        field: { fieldPath: "uid" },
        op: "IN",
        value: { arrayValue: { values: group.map(uid => ({ stringValue: uid })) } }
      }
    })
  ));
  return groups.flat().map(t => t.token);
}

// ===== 送信 =====

async function sendToTokens(projectId, accessToken, tokens, data) {
  const results = await Promise.all(tokens.map(async (token) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          data,
          // 端末がスリープ中でもすぐ届くようにし、届かなかった場合は1日で破棄する
          webpush: { headers: { Urgency: "high", TTL: String(24 * 60 * 60) } }
        }
      })
    });
    if (res.ok) return { token, ok: true };
    const text = await res.text();
    // アプリの削除・通知の解除などで無効になったトークン
    const invalid = res.status === 404 || /UNREGISTERED|registration token is not a valid/i.test(text);
    if (!invalid) console.warn("FCM send failed", res.status, text.slice(0, 300));
    return { token, ok: false, invalid };
  }));

  const invalidTokens = results.filter(r => r.invalid).map(r => r.token);
  if (invalidTokens.length > 0) {
    const base = `projects/${projectId}/databases/(default)/documents/pushTokens/`;
    const res = await firestoreFetch(`${documentsUrl(projectId)}:batchWrite`, accessToken, {
      method: "POST",
      body: JSON.stringify({ writes: invalidTokens.map(token => ({ delete: base + token })) })
    });
    if (!res.ok) console.warn("failed to delete invalid tokens", res.status);
  }
  return { success: results.filter(r => r.ok).length, removed: invalidTokens.length };
}

// 外部からは呼べない、このWorker自身からのサービスバインディング経由でだけ使う送信口。
// 件数が多い場合はさらに自分自身へ分けて任せる（呼び出しごとに外部リクエストの上限が別になる）。
export class Sender extends WorkerEntrypoint {
  async sendAll(projectId, accessToken, tokens, data) {
    if (tokens.length <= SEND_BATCH) return sendToTokens(projectId, accessToken, tokens, data);
    const groupSize = Math.max(SEND_BATCH, Math.ceil(tokens.length / MAX_FANOUT));
    const results = await Promise.all(chunk(tokens, groupSize).map(group =>
      this.env.SENDER.sendAll(projectId, accessToken, group, data)
    ));
    return results.reduce((a, b) => ({ success: a.success + b.success, removed: a.removed + b.removed }), { success: 0, removed: 0 });
  }
}

// ===== HTTP =====

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) }
  });
}

async function handleNotify(request, env) {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = serviceAccount.project_id;
  const adminEmails = (env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);

  const idToken = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const caller = await verifyIdToken(idToken, projectId);
  if (!caller) return json(env, 401, { error: "invalid id token" });

  let notifId;
  try {
    notifId = (await request.json()).notifId;
  } catch (e) {
    return json(env, 400, { error: "invalid body" });
  }
  if (typeof notifId !== "string" || !/^[A-Za-z0-9]{1,100}$/.test(notifId)) {
    return json(env, 400, { error: "invalid notifId" });
  }

  const accessToken = await getAccessToken(serviceAccount);
  const notif = await getNotification(projectId, accessToken, notifId);
  if (!notif) return json(env, 404, { error: "notification not found" });

  // 他人が作成した通知を送らせることはできない（管理者は運営ページから送った通知を送る）
  const isAdmin = adminEmails.includes(caller.email);
  if (notif.createdBy !== caller.uid && !isAdmin) return json(env, 403, { error: "forbidden" });

  const createdAt = Date.parse(notif.createdAt);
  if (!(Date.now() - createdAt < MAX_NOTIFICATION_AGE_MS)) return json(env, 409, { error: "notification too old" });

  if (!(await claimNotification(projectId, accessToken, notifId, caller.uid))) {
    return json(env, 200, { skipped: "already sent" });
  }

  const tokens = [...new Set(await tokensForNotification(notif, projectId, accessToken, adminEmails))];
  if (tokens.length === 0) return json(env, 200, { tokens: 0, success: 0, removed: 0 });

  // dataメッセージの値はすべて文字列にする必要がある
  const data = {
    notifId,
    title: String(notif.title || "Vocaboost").slice(0, 200),
    body: String(notif.body || "").slice(0, 1000),
    link: isSafeLink(notif.link) ? notif.link : "notifications.html"
  };
  const result = tokens.length <= SEND_BATCH
    ? await sendToTokens(projectId, accessToken, tokens, data)
    : await env.SENDER.sendAll(projectId, accessToken, tokens, data);

  console.log("push sent", JSON.stringify({ notifId, target: notif.target, tokens: tokens.length, ...result }));
  return json(env, 200, { tokens: tokens.length, ...result });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/notify") return json(env, 404, { error: "not found" });
    try {
      return await handleNotify(request, env);
    } catch (e) {
      console.error("notify failed", e && e.stack || e);
      return json(env, 500, { error: "internal error" });
    }
  }
};
