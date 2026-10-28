// 報告の 1 日の送信回数の制限（report-rate-limit.js と report.js の差し込み）のテスト。  node --test worker
// kit の共有ファイル。各サイトは submodule で読む。DO は本物の ReportRateLimiter を、Map のストレージで包んで使う（結合で確かめる）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleReport } from "./report.js";
import { ReportRateLimiter, clientHash, jstDay, nextJstMidnight, secondsUntilNextJstMidnight, REPORT_DAILY_LIMIT } from "./report-rate-limit.js";

const SECRET = "secret-value";
const ENV = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: SECRET, DISCORD_WEBHOOK_URL: "https://discord.example/webhook/abc" };
const HOST = "https://site.example";
const IP = "203.0.113.5";
const valid = { category: "bug", message: "ここが動きません", contact: "me@example.com", page: "/speed", turnstileToken: "tok", website: "" };

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Map で作るストレージ（get・put・delete・list・alarm・transaction）。
 * get・put は、1 回ごとに他の処理へ譲る（await の間に別のリクエストが割り込める）。transaction は、中の処理が終わるまで、次の transaction を待たせる（ミューテックス）。
 */
function fakeStorage() {
  const map = new Map();
  let alarm = null;
  let chain = Promise.resolve();
  const txnOps = {
    async get(key) { await tick(); return map.get(key); },
    async put(key, value) { await tick(); map.set(key, value); },
    async delete(keys) { await tick(); let n = 0; for (const k of [].concat(keys)) if (map.delete(k)) n++; return n; },
  };
  return {
    map,
    get alarm() { return alarm; },
    ...txnOps,
    async list() { await tick(); return new Map(map); },
    async getAlarm() { return alarm; },
    async setAlarm(ms) { alarm = ms; },
    async transaction(closure) {
      const run = chain.then(() => closure());
      chain = run.catch(() => {});
      return run;
    },
  };
}

/**
 * 本物の ReportRateLimiter を、DO の namespace の形で包む。送られた本文と、ストレージを記録する。
 * failRelease: true なら /release の呼び出しを例外にする（戻しが失敗する場合）。
 */
function limiterNamespace(storage = fakeStorage(), { failRelease = false } = {}) {
  const limiter = new ReportRateLimiter({ storage }, {});
  const bodies = [];
  const namespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (url, init) => {
        bodies.push(String(init.body));
        if (failRelease && String(url).endsWith("/release")) throw new Error("release failed");
        return limiter.fetch(new Request(url, init));
      },
    }),
  };
  return { namespace, storage, bodies, limiter };
}

/** namespace が例外を投げる（DO が使えない）。 */
const brokenNamespace = () => ({
  idFromName: (name) => name,
  get: () => ({ fetch: async () => { throw new Error("durable object unavailable"); } }),
});

/**
 * Turnstile と Discord への fetch。Discord の呼び出し回数を数える。
 * discordFailures: 最初の何回を失敗（500）にするか。
 */
function fakeFetch({ turnstile = { success: true, hostname: "site.example" }, turnstileStatus = 200, discordFailures = 0 } = {}) {
  const f = { discordCalls: 0, discordFailures };
  f.fn = async (url) => {
    if (String(url).includes("turnstile")) return new Response(JSON.stringify(turnstile), { status: turnstileStatus });
    f.discordCalls += 1;
    if (f.discordCalls <= f.discordFailures) return new Response("error", { status: 500 });
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
  const counts = [...storage.map.entries()].filter(([k]) => /^\d{4}-/.test(k)).map(([, v]) => v);
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

test("IP はそのまま保存・送信しない。保存するのは、日付つきの識別子（HMAC）と回数だけ", async () => {
  const { namespace, storage, bodies } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  await sendAt(DAY1_EARLY, { env });
  await sendAt(DAY2_START, { env });

  const keys = [...storage.map.keys()].filter((k) => /^\d{4}-/.test(k));
  assert.equal(keys.length, 2);
  for (const key of keys) assert.match(key, /^\d{4}-\d{2}-\d{2}:[0-9a-f]{32}$/);
  const stored = JSON.stringify([...storage.map.entries()]);
  assert.ok(!stored.includes(IP));
  assert.ok(!stored.includes(SECRET));
  assert.ok(bodies.length >= 2 && bodies.every((b) => !b.includes(IP) && !b.includes(SECRET)), "DO に送る本文に IP・秘密鍵を含めない");
  // 同じ IP でも日付が違えば、別のキー（日をまたいで同じ人だと分からない）
  assert.notEqual(keys[0].slice(0, 10), keys[1].slice(0, 10));
  assert.notEqual(keys[0].slice(11), keys[1].slice(11));
});

test("clientHash: 鍵が違えば別の値、同じ鍵・同じ IP・同じ日付なら同じ値。生の IP・鍵を含まない", async () => {
  const a = await clientHash(SECRET, IP, "2026-10-22");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, await clientHash(SECRET, IP, "2026-10-22"));
  assert.notEqual(a, await clientHash("another-secret", IP, "2026-10-22"), "鍵が違えば別のハッシュ");
  assert.notEqual(a, await clientHash(SECRET, IP, "2026-10-23"));
  assert.notEqual(a, await clientHash(SECRET, "198.51.100.7", "2026-10-22"));
  assert.ok(!a.includes(IP));
});

test("ログ・保存・応答に、生の IP と秘密鍵が出ない（上限・Discord 失敗・DO の例外のどれでも）", async (t) => {
  const logs = [];
  for (const m of ["log", "warn", "error"]) t.mock.method(console, m, (...args) => logs.push(args.map(String).join(" ")));
  const { namespace, storage } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  const bodies = [];
  for (let i = 0; i < 4; i += 1) bodies.push(await (await sendAt(DAY1_EARLY, { env, f: fakeFetch({ discordFailures: 1 }) })).text());
  bodies.push(await (await sendAt(DAY1_EARLY, { env: { ...ENV, REPORT_LIMITER: brokenNamespace() } })).text());
  const everything = [...logs, ...bodies, JSON.stringify([...storage.map.entries()])].join("\n");
  assert.ok(!everything.includes(IP), "生の IP");
  assert.ok(!everything.includes(SECRET), "秘密鍵");
});

test("Discord への送信が失敗した分は枠に数えない（戻す）。3 回失敗しても、3 回まで成功して送れる", async (t) => {
  t.mock.method(console, "error", () => {});
  const { namespace } = limiterNamespace();
  const env = { ...ENV, REPORT_LIMITER: namespace };
  for (let i = 0; i < REPORT_DAILY_LIMIT; i += 1) {
    const res = await sendAt(DAY1_EARLY, { env, f: fakeFetch({ discordFailures: 1 }) });
    assert.equal(res.status, 502);
  }
  const f = fakeFetch();
  for (let i = 0; i < REPORT_DAILY_LIMIT; i += 1) assert.equal((await sendAt(DAY1_EARLY, { env, f })).status, 200);
  assert.equal((await sendAt(DAY1_EARLY, { env, f })).status, 429, "成功の 3 回を使い切ったら、4 回目は 429");
});

test("戻す操作が失敗しても、報告の応答は 502 のまま（ログだけ）", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const { namespace } = limiterNamespace(fakeStorage(), { failRelease: true });
  const env = { ...ENV, REPORT_LIMITER: namespace };
  const res = await sendAt(DAY1_EARLY, { env, f: fakeFetch({ discordFailures: 1 }) });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "notify_failed", message: "送信に失敗しました。しばらくしてからもう一度お試しください" });
  const logged = errors.mock.calls.map((c) => c.arguments.map(String).join(" ")).join("\n");
  assert.match(logged, /daily limit release failed/);
  assert.ok(!logged.includes(IP));
});

test("並行: 同時に 6 件来ても、通るのは 3 件だけ（storage の transaction が直列にする）", async () => {
  const { limiter } = limiterNamespace();
  const day = "2026-10-22";
  const hash = "0123456789abcdef0123456789abcdef";
  const hit = () => limiter.fetch(new Request("https://report-rate-limit/hit", { method: "POST", body: JSON.stringify({ day, hash, limit: 3 }) }));
  const results = await Promise.all(Array.from({ length: 6 }, () => hit().then((r) => r.json())));
  assert.equal(results.filter((r) => r.allowed).length, 3);
  assert.equal(results.filter((r) => !r.allowed).length, 3);
});

test("ReportRateLimiter: 形が正しくない本文は 400、判定は上限ちょうどで止まる。release は数を戻す", async () => {
  const limiter = new ReportRateLimiter({ storage: fakeStorage() }, {});
  const send = (path, body) => limiter.fetch(new Request(`https://report-rate-limit${path}`, { method: "POST", body: JSON.stringify(body) }));
  const good = { day: "2026-10-22", hash: "0123456789abcdef0123456789abcdef", limit: 2 };
  assert.equal((await send("/hit", { ...good, day: "2026/10/22" })).status, 400);
  assert.equal((await send("/hit", { ...good, hash: "not-hex" })).status, 400);
  assert.equal((await send("/hit", { ...good, limit: 0 })).status, 400);
  assert.equal((await send("/hit", null)).status, 400);
  assert.equal((await send("/nope", good)).status, 404);
  assert.equal((await new ReportRateLimiter({ storage: fakeStorage() }, {}).fetch(new Request("https://x/hit", { method: "GET" }))).status, 405);
  assert.deepEqual(await (await send("/hit", good)).json(), { allowed: true, count: 1 });
  assert.deepEqual(await (await send("/hit", good)).json(), { allowed: true, count: 2 });
  assert.deepEqual(await (await send("/hit", good)).json(), { allowed: false, count: 2 });
  assert.deepEqual(await (await send("/release", good)).json(), { released: true, count: 1 });
  assert.deepEqual(await (await send("/hit", good)).json(), { allowed: true, count: 2 });
  await send("/release", good);
  await send("/release", good);
  assert.deepEqual(await (await send("/release", good)).json(), { released: false, count: 0 }, "0 より下へは戻さない");
});

test("掃除: alarm は、今日より前のキーを消し、今日以降のキーは残す。残りが無くても次の 0 時を予約する", async () => {
  const storage = fakeStorage();
  storage.map.set("2000-01-01:00000000000000000000000000000001", 2);
  storage.map.set("9999-12-31:00000000000000000000000000000002", 1);
  const limiter = new ReportRateLimiter({ storage }, {});
  await limiter.alarm();
  assert.deepEqual([...storage.map.keys()].filter((k) => /^\d{4}-/.test(k)), ["9999-12-31:00000000000000000000000000000002"]);
  assert.ok(storage.alarm !== null && storage.alarm > Date.now());

  const empty = fakeStorage();
  await new ReportRateLimiter({ storage: empty }, {}).alarm();
  assert.ok(empty.alarm !== null, "残りが無くても予約する");
});

test("掃除: alarm の掃除が失敗しても、次の 0 時の予約は入る（try/finally）", async () => {
  const storage = fakeStorage();
  storage.list = async () => { throw new Error("list failed"); };
  await assert.rejects(new ReportRateLimiter({ storage }, {}).alarm(), /list failed/);
  assert.ok(storage.alarm !== null);
});

test("掃除の保険: alarm が取りこぼされても、次のリクエストで日が変わっていれば古いキーを消す", async () => {
  const storage = fakeStorage();
  storage.map.set("2000-01-01:00000000000000000000000000000001", 2);
  const limiter = new ReportRateLimiter({ storage }, {});
  const res = await limiter.fetch(new Request("https://report-rate-limit/hit", {
    method: "POST",
    body: JSON.stringify({ day: jstDay(new Date()), hash: "0123456789abcdef0123456789abcdef", limit: 3 }),
  }));
  assert.equal(res.status, 200);
  assert.ok(!storage.map.has("2000-01-01:00000000000000000000000000000001"));
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

test("JST の暦日・次の 0 時・Retry-After の境界", () => {
  assert.equal(jstDay(new Date("2026-10-22T14:59:59Z")), "2026-10-22");
  assert.equal(jstDay(new Date("2026-10-22T15:00:00Z")), "2026-10-23");
  assert.equal(nextJstMidnight(new Date("2026-10-22T14:59:59Z")).toISOString(), "2026-10-22T15:00:00.000Z");
  assert.equal(nextJstMidnight(new Date("2026-10-22T15:00:00Z")).toISOString(), "2026-10-23T15:00:00.000Z");
  assert.equal(secondsUntilNextJstMidnight(new Date("2026-10-22T14:59:59Z")), 1);
  assert.equal(secondsUntilNextJstMidnight(new Date("2026-10-22T15:00:00Z")), 86400);
  assert.equal(secondsUntilNextJstMidnight(new Date("2026-10-22T14:59:59.500Z")), 1, "切り上げ・最小 1");
});
