// 報告の 1 日の送信回数の制限（report-rate-limit.js と report.js の差し込み）のテスト。  node --test worker
// kit の共有ファイル。各サイトは submodule で読む。DO は本物の ReportRateLimiter を、Map のストレージで包んで使う（結合で確かめる）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleReport } from "./report.js";
import { ReportRateLimiter, clientHash, jstDay, nextJstMidnight, secondsUntilNextJstMidnight, REPORT_DAILY_LIMIT } from "./report-rate-limit.js";

const ENV = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "secret-value", DISCORD_WEBHOOK_URL: "https://discord.example/webhook/abc" };
const HOST = "https://site.example";
const IP = "203.0.113.5";
const valid = { category: "bug", message: "ここが動きません", contact: "me@example.com", page: "/speed", turnstileToken: "tok", website: "" };

/** Map で作るストレージ（get・put・delete・list・alarm）。 */
function fakeStorage() {
  const map = new Map();
  let alarm = null;
  return {
    map,
    get alarm() { return alarm; },
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(keys) { let n = 0; for (const k of [].concat(keys)) if (map.delete(k)) n++; return n; },
    async list() { return new Map(map); },
    async getAlarm() { return alarm; },
    async setAlarm(ms) { alarm = ms; },
  };
}

/** 本物の ReportRateLimiter を、DO の namespace の形で包む。送られた本文を記録する。 */
function limiterNamespace(storage = fakeStorage()) {
  const limiter = new ReportRateLimiter({ storage }, {});
  const bodies = [];
  const namespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: async (url, init) => { bodies.push(String(init.body)); return limiter.fetch(new Request(url, init)); } }),
  };
  return { namespace, storage, bodies, limiter };
}

/** namespace が例外を投げる（DO が使えない）。 */
const brokenNamespace = () => ({
  idFromName: (name) => name,
  get: () => ({ fetch: async () => { throw new Error("durable object unavailable"); } }),
});

/** Turnstile と Discord への fetch。Discord の呼び出し回数を数える。 */
function fakeFetch({ turnstile = { success: true, hostname: "site.example" }, turnstileStatus = 200 } = {}) {
  const f = { discordCalls: 0 };
  f.fn = async (url) => {
    if (String(url).includes("turnstile")) return new Response(JSON.stringify(turnstile), { status: turnstileStatus });
    f.discordCalls += 1;
    return new Response(null, { status: 204 });
  };
  return f;
}

function post(ip = IP, body = valid) {
  const headers = { "Content-Type": "application/json", Origin: HOST };
  if (ip !== null) headers["CF-Connecting-IP"] = ip;
  return new Request(`${HOST}/api/report`, { method: "POST", headers, body: JSON.stringify(body) });
}

/** 指定の時刻（UTC の ISO 文字列）で報告を送る。 */
const sendAt = (at, { env = ENV, ip = IP, body = valid, f = fakeFetch() } = {}) =>
  handleReport(post(ip, body), env, "テストサイト", { fetch: f.fn, now: () => new Date(at) });

/** JST の 2026-10-22（木）の途中。UTC では 10-22 の 00:00 から 14:59 まで。 */
const DAY1_EARLY = "2026-10-22T01:00:00Z";
const DAY1_LATE = "2026-10-22T14:59:50Z";   // JST 23:59:50
const DAY2_START = "2026-10-22T15:00:00Z";  // JST 2026-10-23 0:00:00

test("REPORT_LIMITER が無いサイトは、制限せず従来どおり送る（後方互換）", async () => {
  const f = fakeFetch();
  for (let i = 0; i < REPORT_DAILY_LIMIT + 2; i += 1) {
    const res = await sendAt(DAY1_EARLY, { f });
    assert.equal(res.status, 200);
  }
  assert.equal(f.discordCalls, REPORT_DAILY_LIMIT + 2);
});

test("1 日 3 回まで通り、4 回目は 429（日本語の JSON・Retry-After）。Discord には送らない", async () => {
  const { namespace } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  const f = fakeFetch();
  for (let i = 0; i < REPORT_DAILY_LIMIT; i += 1) assert.equal((await sendAt(DAY1_EARLY, { env, f })).status, 200);
  assert.equal(f.discordCalls, 3);

  const res = await sendAt(DAY1_EARLY, { env, f });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "rate_limited", message: "1 日の送信上限（3 回）に達しました。明日もう一度お試しください。" });
  assert.equal(res.headers.get("Retry-After"), String(secondsUntilNextJstMidnight(new Date(DAY1_EARLY))));
  assert.equal(f.discordCalls, 3);
});

test("上限を超えた後も、何度送っても 429 のまま（数えるのは通した分だけ）", async () => {
  const { namespace, storage } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  for (let i = 0; i < 6; i += 1) await sendAt(DAY1_EARLY, { env });
  const counts = [...storage.map.values()];
  assert.deepEqual(counts, [3]);
});

test("日付（JST の暦日）が変わるとリセットされる。Retry-After は次の JST 0 時までの秒", async () => {
  const { namespace } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  for (let i = 0; i < 3; i += 1) assert.equal((await sendAt(DAY1_LATE, { env })).status, 200);

  const limited = await sendAt(DAY1_LATE, { env });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "10");

  assert.equal((await sendAt(DAY2_START, { env })).status, 200);
});

test("送信元（CF-Connecting-IP）が違えば、別々に数える", async () => {
  const { namespace } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  for (let i = 0; i < 3; i += 1) await sendAt(DAY1_EARLY, { env, ip: "203.0.113.5" });
  assert.equal((await sendAt(DAY1_EARLY, { env, ip: "203.0.113.5" })).status, 429);
  assert.equal((await sendAt(DAY1_EARLY, { env, ip: "198.51.100.7" })).status, 200);
  assert.equal((await sendAt(DAY1_EARLY, { env, ip: "2001:db8::1" })).status, 200);
});

test("IP はそのまま保存・送信しない。保存するのは、日付つきの短縮ハッシュと回数だけ", async () => {
  const { namespace, storage, bodies } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  await sendAt(DAY1_EARLY, { env });
  await sendAt(DAY2_START, { env });

  const keys = [...storage.map.keys()];
  assert.equal(keys.length, 2);
  for (const key of keys) assert.match(key, /^\d{4}-\d{2}-\d{2}:[0-9a-f]{32}$/);
  const stored = JSON.stringify([...storage.map.entries()]);
  assert.ok(!stored.includes(IP));
  assert.ok(bodies.length === 2 && bodies.every((b) => !b.includes(IP)), "DO に送る本文に IP を含めない");
  // 同じ IP でも日付が違えば、別のキー（日をまたいで同じ人だと分からない）
  assert.notEqual(keys[0].slice(0, 10), keys[1].slice(0, 10));
  assert.notEqual(keys[0].slice(11), keys[1].slice(11));
});

test("clientHash は 32 桁の hex。同じ IP と日付なら同じ値、日付か IP が違えば別の値", async () => {
  const a = await clientHash(IP, "2026-10-22");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, await clientHash(IP, "2026-10-22"));
  assert.notEqual(a, await clientHash(IP, "2026-10-23"));
  assert.notEqual(a, await clientHash("198.51.100.7", "2026-10-22"));
  assert.ok(!a.includes(IP));
});

test("DO が例外を投げたら、制限せず送る（fail-open）。ログには IP を出さない", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const env = { ...ENV, REPORT_LIMITER: brokenNamespace() };
  const f = fakeFetch();
  const res = await sendAt(DAY1_EARLY, { env, f });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(f.discordCalls, 1);
  assert.equal(errors.mock.callCount(), 1);
  assert.ok(!JSON.stringify(errors.mock.calls).includes(IP));
});

test("DO が 2xx 以外を返したときも、制限せず送る（fail-open）", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = {
    ...ENV,
    REPORT_LIMITER: {
      idFromName: (n) => n,
      get: () => ({ fetch: async () => new Response("oops", { status: 500 }) }),
    },
  };
  const f = fakeFetch();
  for (let i = 0; i < 5; i += 1) assert.equal((await sendAt(DAY1_EARLY, { env, f })).status, 200);
  assert.equal(f.discordCalls, 5);
});

test("CF-Connecting-IP が無いときは、制限せず送り、警告をログに残す", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const { namespace, bodies } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  for (let i = 0; i < 5; i += 1) assert.equal((await sendAt(DAY1_EARLY, { env, ip: null })).status, 200);
  assert.equal(warnings.mock.callCount(), 5);
  assert.equal(bodies.length, 0, "DO を呼ばない");
});

test("Turnstile の確認に失敗した送信は数えない（400・503・502 のいずれも）", async (t) => {
  t.mock.method(console, "error", () => {});
  const { namespace, bodies } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  // 利用者の失敗（トークン期限切れ）
  for (let i = 0; i < 5; i += 1) {
    const f = fakeFetch({ turnstile: { success: false, "error-codes": ["timeout-or-duplicate"], hostname: "site.example" } });
    assert.equal((await sendAt(DAY1_EARLY, { env, f })).status, 400);
  }
  // Turnstile 側の問題（503）
  for (let i = 0; i < 5; i += 1) {
    const f = fakeFetch({ turnstileStatus: 500 });
    assert.equal((await sendAt(DAY1_EARLY, { env, f })).status, 503);
  }
  assert.equal(bodies.length, 0, "DO を一度も呼ばない");
  // 数えていないので、3 回通る
  for (let i = 0; i < REPORT_DAILY_LIMIT; i += 1) assert.equal((await sendAt(DAY1_EARLY, { env })).status, 200);
});

test("入口で弾いた送信（本文の不正・罠の欄・種類の欠け）も数えない", async () => {
  const { namespace, bodies } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  assert.equal((await sendAt(DAY1_EARLY, { env, body: { ...valid, message: "短い" } })).status, 400);
  assert.equal((await sendAt(DAY1_EARLY, { env, body: { ...valid, category: "x" } })).status, 400);
  assert.equal((await sendAt(DAY1_EARLY, { env, body: { ...valid, website: "bot" } })).status, 200);
  assert.equal(bodies.length, 0);
});

test("ReportRateLimiter: 形が正しくない本文は 400、判定は上限ちょうどで止まる", async () => {
  const limiter = new ReportRateLimiter({ storage: fakeStorage() }, {});
  const hit = (body) => limiter.fetch(new Request("https://report-rate-limit/hit", { method: "POST", body: JSON.stringify(body) }));
  const good = { day: "2026-10-22", hash: "0123456789abcdef0123456789abcdef", limit: 2 };
  assert.equal((await hit({ ...good, day: "2026/10/22" })).status, 400);
  assert.equal((await hit({ ...good, hash: "not-hex" })).status, 400);
  assert.equal((await hit({ ...good, limit: 0 })).status, 400);
  assert.equal((await hit(null)).status, 400);
  assert.equal((await new ReportRateLimiter({ storage: fakeStorage() }, {}).fetch(new Request("https://x", { method: "GET" }))).status, 405);
  assert.deepEqual(await (await hit(good)).json(), { allowed: true, count: 1 });
  assert.deepEqual(await (await hit(good)).json(), { allowed: true, count: 2 });
  assert.deepEqual(await (await hit(good)).json(), { allowed: false, count: 2 });
});

test("alarm: 今日より前の日のキーは消し、今日以降のキーは残す。残りがあれば次の JST 0 時に予約し直す", async () => {
  const storage = fakeStorage();
  storage.map.set("2000-01-01:00000000000000000000000000000001", 2);
  storage.map.set("9999-12-31:00000000000000000000000000000002", 1);
  const limiter = new ReportRateLimiter({ storage }, {});
  await limiter.alarm();
  assert.deepEqual([...storage.map.keys()], ["9999-12-31:00000000000000000000000000000002"]);
  assert.ok(storage.alarm !== null && storage.alarm > Date.now());
});

test("JST の暦日・次の 0 時・Retry-After の境界", () => {
  assert.equal(jstDay(new Date("2026-10-22T14:59:59Z")), "2026-10-22");
  assert.equal(jstDay(new Date("2026-10-22T15:00:00Z")), "2026-10-23");
  assert.equal(nextJstMidnight(new Date("2026-10-22T14:59:59Z")).toISOString(), "2026-10-22T15:00:00.000Z");
  assert.equal(nextJstMidnight(new Date("2026-10-22T15:00:00Z")).toISOString(), "2026-10-23T15:00:00.000Z");
  assert.equal(secondsUntilNextJstMidnight(new Date("2026-10-22T14:59:59Z")), 1);
  assert.equal(secondsUntilNextJstMidnight(new Date("2026-10-22T15:00:00Z")), 86400);
  assert.equal(secondsUntilNextJstMidnight(new Date("2026-10-22T14:59:59.500Z")), 1, "切り上げ・最小 1");
});
