// 作者への報告の受け口（worker/report.js）のテスト。  node --test worker
// kit の共有ファイル。各サイトは submodule で読む。
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleReport, clean, cleanPage, isConfigured } from "./report.js";

const ENV = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "secret-value", DISCORD_WEBHOOK_URL: "https://discord.example/webhook/abc" };
const HOST = "https://site.example";

function post(body, { origin = HOST, type = "application/json", raw = false, ip = "203.0.113.5" } = {}) {
  const headers = { "Content-Type": type, "CF-Connecting-IP": ip };
  if (origin !== null) headers.Origin = origin;
  return new Request(`${HOST}/api/report`, { method: "POST", headers, body: raw ? body : JSON.stringify(body) });
}

const valid = { category: "bug", message: "ここが動きません", contact: "me@example.com", page: "/speed", turnstileToken: "tok", website: "" };

/** Turnstile と Discord への fetch を記録する偽物。 */
function fakeFetch({ turnstile = { ok: true, body: { success: true, hostname: "site.example" } }, discord = { ok: true } } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("turnstile")) {
      if (turnstile.throws) throw new Error("network");
      return new Response(turnstile.raw ?? JSON.stringify(turnstile.body), { status: turnstile.status ?? (turnstile.ok ? 200 : 500) });
    }
    if (discord.throws) throw new Error("network");
    return discord.ok ? new Response(null, { status: 204 }) : new Response("error", { status: 500 });
  };
  return { fn, calls };
}

const run = (request, env = ENV, f = fakeFetch()) => handleReport(request, env, "テストサイト", { fetch: f.fn, now: () => new Date("2026-10-22T00:00:00Z") });

test("config は、サイトキーと設定済みかを返す（シークレットは返さない）", async () => {
  const res = await run(new Request(`${HOST}/api/report/config`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { enabled: true, siteKey: "site-key" });
  assert.ok(!JSON.stringify(body).includes("secret-value"));
  const notConfigured = await (await run(new Request(`${HOST}/api/report/config`), {})).json();
  assert.deepEqual(notConfigured, { enabled: false, siteKey: null });
  assert.equal((await run(new Request(`${HOST}/api/report/config`, { method: "POST" }))).status, 405);
});

test("isConfigured は 3 つの値がそろっているときだけ true", () => {
  assert.equal(isConfigured(ENV), true);
  for (const key of Object.keys(ENV)) assert.equal(isConfigured({ ...ENV, [key]: "" }), false, key);
});

test("正しい報告は、Turnstile を確認して Discord に送る", async () => {
  const f = fakeFetch();
  const res = await run(post(valid), ENV, f);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.includes("turnstile/v0/siteverify"));
  const verify = new URLSearchParams(f.calls[0].init.body);
  assert.equal(verify.get("secret"), "secret-value");
  assert.equal(verify.get("response"), "tok");
  assert.equal(verify.get("remoteip"), "203.0.113.5");
  assert.equal(f.calls[1].url, ENV.DISCORD_WEBHOOK_URL);
  const sent = JSON.parse(f.calls[1].init.body);
  assert.deepEqual(sent.allowed_mentions, { parse: [] });
  assert.equal(sent.embeds[0].title, "テストサイト への報告");
  assert.equal(sent.embeds[0].description, "ここが動きません");
  assert.deepEqual(sent.embeds[0].fields.map((x) => x.name), ["種類", "連絡先", "ページ"]);
  assert.equal(sent.embeds[0].timestamp, "2026-10-22T00:00:00.000Z");
});

test("連絡先とページは省略できる", async () => {
  const f = fakeFetch();
  const res = await run(post({ ...valid, contact: undefined, page: undefined }), ENV, f);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(f.calls[1].init.body).embeds[0].fields.map((x) => x.name), ["種類"]);
});

test("別のサイトからの送信（Origin 違い・無し）は 403 で、何も外へ出さない", async () => {
  for (const origin of ["https://evil.example", "null", null]) {
    const f = fakeFetch();
    const res = await run(post(valid, { origin }), ENV, f);
    assert.equal(res.status, 403, String(origin));
    assert.equal(f.calls.length, 0);
  }
});

test("JSON 以外・壊れた JSON・大きすぎる本文を断る", async () => {
  assert.equal((await run(post("x", { type: "text/plain", raw: true }))).status, 415);
  assert.equal((await run(post("{not json", { raw: true }))).status, 400);
  assert.equal((await run(post("[1]", { raw: true }))).status, 400);
  assert.equal((await run(post("null", { raw: true }))).status, 400);
  assert.equal((await run(post("x".repeat(40000), { raw: true }))).status, 413);
});

test("種類・内容・確認の欠けを断る", async () => {
  const cases = [
    [{ ...valid, category: "x" }, "invalid_category"],
    [{ ...valid, category: undefined }, "invalid_category"],
    [{ ...valid, category: "__proto__" }, "invalid_category"],
    [{ ...valid, message: "あ" }, "invalid_message"],
    [{ ...valid, message: "😀😀😀" }, "invalid_message"],
    [{ ...valid, message: "   \n  " }, "invalid_message"],
    [{ ...valid, message: 123 }, "invalid_message"],
    [{ ...valid, turnstileToken: "" }, "missing_token"],
    [{ ...valid, turnstileToken: undefined }, "missing_token"],
  ];
  for (const [body, error] of cases) {
    const f = fakeFetch();
    const res = await run(post(body), ENV, f);
    assert.equal(res.status, 400, error);
    assert.equal((await res.json()).error, error);
    assert.equal(f.calls.length, 0, "確認の前に断るので、外へは出ない");
  }
});

test("罠の欄（website）が入っていたら、何も送らず成功したように返す", async () => {
  const f = fakeFetch();
  const res = await run(post({ ...valid, website: "http://spam.example" }), ENV, f);
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 0);
});

test("設定が足りないときは 503（何も送らない）", async () => {
  for (const key of Object.keys(ENV)) {
    const f = fakeFetch();
    const res = await run(post(valid), { ...ENV, [key]: undefined }, f);
    assert.equal(res.status, 503, key);
    assert.equal((await res.json()).error, "not_configured");
    assert.equal(f.calls.length, 0);
  }
});

test("Turnstile の確認に失敗したら 400、通信できなければ 502。Discord には送らない", async () => {
  let f = fakeFetch({ turnstile: { ok: true, body: { success: false } } });
  assert.equal((await run(post(valid), ENV, f)).status, 400);
  assert.equal(f.calls.length, 1);
  f = fakeFetch({ turnstile: { throws: true } });
  await captureErrors(async () => { assert.equal((await run(post(valid), ENV, f)).status, 502); });
  assert.equal(f.calls.length, 1);
});

test("Discord への送信に失敗したら 502", async () => {
  for (const discord of [{ ok: false }, { throws: true }]) {
    let res;
    const logs = await captureErrors(async () => { res = await run(post(valid), ENV, fakeFetch({ discord })); });
    assert.equal(res.status, 502);
    assert.equal(logs.length, 1, "サーバー側のログに残す");
    // 状態コードなどだけ。Webhook の URL・シークレット・報告の本文・連絡先は出さない
    const text = logs.join(" ") + await res.text();
    for (const secret of ["discord.example", "abc", "secret-value", valid.message, valid.contact]) assert.ok(!text.includes(secret), secret);
  }
  const logs = await captureErrors(async () => { await run(post(valid), ENV, fakeFetch({ discord: { ok: false } })); });
  assert.ok(logs[0].includes("500"), "状態コードは出す");
});

test("応答にシークレットと Webhook の URL を含めない", async () => {
  for (const f of [fakeFetch(), fakeFetch({ discord: { ok: false } }), fakeFetch({ turnstile: { ok: true, body: { success: false } } })]) {
    const text = await (await run(post(valid), ENV, f)).text();
    assert.ok(!text.includes("secret-value") && !text.includes("discord.example"), text);
  }
});

test("clean は制御文字を取り、長さを切る。文字列以外は空", () => {
  assert.equal(clean("  a\u0000b\u0007c\nd\te  ", 100), "abc\nd\te");
  assert.equal(clean("あいうえお", 3), "あいう");
  assert.equal(clean(undefined, 10), "");
  assert.equal(clean(5, 10), "");
  assert.equal(clean({}, 10), "");
});

test("メッセージは 2000 文字までに切って送る", async () => {
  const f = fakeFetch();
  await run(post({ ...valid, message: "あ".repeat(5000) }), ENV, f);
  assert.equal(JSON.parse(f.calls[1].init.body).embeds[0].description.length, 2000);
});

test("存在しないパスと、使えないメソッド", async () => {
  assert.equal((await run(new Request(`${HOST}/api/report/x`, { method: "POST" }))).status, 404);
  assert.equal((await run(new Request(`${HOST}/api/report`, { method: "GET" }))).status, 405);
});

test("Turnstile が返した hostname が、このサイトと違えば断る（別のサイトで取ったトークンの使い回し）", async () => {
  const other = fakeFetch({ turnstile: { ok: true, body: { success: true, hostname: "other.example" } } });
  assert.equal((await run(post(valid), ENV, other)).status, 400);
  assert.equal(other.calls.length, 1, "Discord には送らない");
  const same = fakeFetch({ turnstile: { ok: true, body: { success: true, hostname: "site.example" } } });
  assert.equal((await run(post(valid), ENV, same)).status, 200);
  const none = fakeFetch({ turnstile: { ok: true, body: { success: true } } });
  assert.equal((await run(post(valid), ENV, none)).status, 400, "hostname が無いときも失敗扱い");
  assert.equal(none.calls.length, 1, "Discord には送らない");
  const wrongType = fakeFetch({ turnstile: { ok: true, body: { success: true, hostname: 123 } } });
  assert.equal((await run(post(valid), ENV, wrongType)).status, 400);
});

/** console.error を記録して、終わったら戻す。 */
test("clean: 対になっていないサロゲートを取り、絵文字は割らない（長さは文字単位）", () => {
  assert.equal(clean("a\uD83Db😀", 10), "ab😀");
  assert.equal(clean("😀".repeat(5), 3), "😀😀😀");
});

async function captureErrors(fn) {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try { await fn(); } finally { console.error = original; }
  return logs;
}

test("siteverify が 2xx 以外・読めない・秘密の不正のときは 503 にして、ログに残す（Discord には送らない）", async () => {
  const cases = [
    { turnstile: { status: 500, raw: "{}" } },
    { turnstile: { status: 400, raw: '{"success":true,"hostname":"site.example"}' } },   // 本文が成功に見えても、2xx 以外なら使わない
    { turnstile: { status: 403, raw: '{"success":true,"hostname":"site.example"}' } },
    { turnstile: { status: 200, raw: "<html>oops</html>" } },
    { turnstile: { status: 200, raw: "null" } },
    { turnstile: { status: 200, raw: "{}" } },
    { turnstile: { ok: true, body: { success: false, "error-codes": ["invalid-input-secret"] } } },
    { turnstile: { ok: true, body: { success: false, "error-codes": ["missing-input-secret"] } } },
    { turnstile: { ok: true, body: { success: false, "error-codes": ["invalid-input-response", "internal-error"] } } },
  ];
  for (const c of cases) {
    const f = fakeFetch(c);
    let res;
    const logs = await captureErrors(async () => { res = await run(post(valid), ENV, f); });
    assert.equal(res.status, 503, JSON.stringify(c));
    assert.equal(f.calls.length, 1, "Discord には送らない");
    assert.equal(logs.length, 1, JSON.stringify(c));
    const text = await res.text() + logs.join(" ");
    assert.ok(!text.includes("secret-value") && !text.includes("discord.example"), "秘密を出さない");
  }
});

test("トークンの不正・期限切れ（利用者の失敗）は従来どおり 400 で、ログに出さない", async () => {
  for (const codes of [["timeout-or-duplicate"], ["invalid-input-response"], ["missing-input-response"], []]) {
    const f = fakeFetch({ turnstile: { ok: true, body: { success: false, "error-codes": codes } } });
    let res;
    const logs = await captureErrors(async () => { res = await run(post(valid), ENV, f); });
    assert.equal(res.status, 400, codes.join());
    assert.equal((await res.json()).error, "turnstile_failed");
    assert.equal(logs.length, 0);
  }
});

test("本文の大きさ: Content-Length が無くても、うそでも、上限を超えたら読むのをやめて 413", async () => {
  const chunk = new Uint8Array(1024).fill(120);
  for (const declared of [null, "10"]) {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) { pulled++; if (pulled >= 200) controller.close(); else controller.enqueue(chunk); },   // 止まらない実装でもテストが終わるように、200 回で閉じる
      cancel() { cancelled = true; },
    });
    const headers = { "Content-Type": "application/json", Origin: HOST };
    if (declared) headers["Content-Length"] = declared;
    const req = new Request(`${HOST}/api/report`, { method: "POST", headers, body: stream, duplex: "half" });
    if (declared) assert.equal(req.headers.get("Content-Length"), declared, "テストの前提: 宣言が残っている");
    const f = fakeFetch();
    assert.equal((await run(req, ENV, f)).status, 413, String(declared));
    assert.ok(pulled <= 40, `無限に読まない（${pulled} 回）`);
    assert.equal(cancelled, true);
    assert.equal(f.calls.length, 0);
  }
});

/** JSON.stringify の結果の非 ASCII を、すべて \uXXXX（UTF-16 の単位ごと。絵文字は 12 文字）にする。既定の JsonSerializer（旧 ReportForm.ToJson）と同じ形。 */
const asciiJson = (value) => JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const postRaw = (text, headers = {}) => new Request(`${HOST}/api/report`, { method: "POST", headers: { "Content-Type": "application/json", Origin: HOST, ...headers }, body: text });

test("最大の報告は、\\uXXXX に直された形（旧クライアントの JSON）でも通る: 日本語 2000 文字・絵文字 2000 個", async () => {
  const jp = asciiJson({ ...valid, message: "あ".repeat(2000), contact: "い".repeat(200), turnstileToken: "t".repeat(2048) });
  assert.ok(jp.length > 8192 && jp.length <= 32 * 1024, `日本語の最大の本文は ${jp.length} 文字`);
  assert.equal((await run(postRaw(jp))).status, 200);
  const emoji = asciiJson({ ...valid, message: "😀".repeat(2000), contact: "😀".repeat(200), page: "/" + "a".repeat(299), turnstileToken: "t".repeat(2048) });
  assert.ok(emoji.length > 28000 && emoji.length <= 32 * 1024, `絵文字の最大の本文は ${emoji.length} 文字`);
  const f = fakeFetch();
  assert.equal((await run(postRaw(emoji), ENV, f)).status, 200);
  assert.equal(Array.from(JSON.parse(f.calls[1].init.body).embeds[0].description).length, 2000);
  // 非 ASCII をそのまま送る形（新クライアント）も通る
  assert.equal((await run(post({ ...valid, message: "あ".repeat(2000) }))).status, 200);
});

test("本文の上限の境界: ちょうど 32 KB は通り、1 バイト超えたら 413（宣言も、宣言なしも）", async () => {
  const LIMIT = 32 * 1024;
  const pad = (bytes) => { const base = '{"x":""}'; return '{"x":"' + "a".repeat(bytes - base.length) + '"}'; };
  const atLimit = pad(LIMIT);
  const over = pad(LIMIT + 1);
  assert.equal(new TextEncoder().encode(atLimit).length, LIMIT);
  // 上限ちょうど: 大きさの検査は通り、そのあとの検査（種類が無い）で 400
  assert.equal((await run(postRaw(atLimit))).status, 400);
  assert.equal((await run(postRaw(atLimit, { "Content-Length": String(LIMIT) }))).status, 400);
  assert.equal((await run(postRaw(over))).status, 413);
  assert.equal((await run(postRaw(over, { "Content-Length": String(LIMIT + 1) }))).status, 413);
  assert.equal((await run(postRaw(atLimit, { "Content-Length": String(LIMIT + 1) }))).status, 413, "宣言が超えていれば読む前に断る");
  // 2 バイト文字でバイト数が上限を超える（文字数は上限以下）
  assert.equal((await run(postRaw('{"x":"' + "é".repeat(LIMIT / 2) + '"}'))).status, 413);
});

test("トークンは 2048 文字までに切って Turnstile に渡す", async () => {
  const f = fakeFetch();
  assert.equal((await run(post({ ...valid, turnstileToken: "t".repeat(3000) }), ENV, f)).status, 200);
  assert.equal(f.calls[0].init.body.get("response").length, 2048);
  const g = fakeFetch();
  await run(post({ ...valid, turnstileToken: "t".repeat(2048) }), ENV, g);
  assert.equal(g.calls[0].init.body.get("response").length, 2048);
});

test("宣言された本文の大きさが上限を超えたら、読む前に 413", async () => {
  let read = false;
  const req = post(valid);
  const big = new Request(req, { headers: new Headers({ "Content-Type": "application/json", Origin: HOST, "Content-Length": String(40 * 1024) }) });
  big.text = async () => { read = true; return "{}"; };
  assert.equal((await run(big)).status, 413);
  assert.equal(read, false);
});

test("外への通信には、時間切れの signal が付く", async () => {
  const f = fakeFetch();
  await run(post(valid), ENV, f);
  assert.ok(f.calls[0].init.signal instanceof AbortSignal);
  assert.ok(f.calls[1].init.signal instanceof AbortSignal);
});

test("絵文字を含む文字列を切っても、文字が割れない", () => {
  const text = "😀".repeat(10);
  const cut = clean(text, 3);
  assert.equal(Array.from(cut).length, 3);
  assert.equal(cut, "😀😀😀");
  assert.doesNotMatch(cut, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.equal(clean("a\ud83db", 10), "ab", "対になっていないサロゲートは取る");
});

test("2000 文字の絵文字でも、Discord に送る本文は 2000 文字（割れない）", async () => {
  const f = fakeFetch();
  await run(post({ ...valid, message: "😀".repeat(2500) }), ENV, f);
  const description = JSON.parse(f.calls[1].init.body).embeds[0].description;
  assert.equal(Array.from(description).length, 2000);
});

test("ページ（page）は、サーバー側でも、パスだけを通す", async () => {
  assert.equal(cleanPage("/speed-comparison"), "/speed-comparison");
  assert.equal(cleanPage("/"), "/");
  for (const bad of ["", "speed", "//evil.example", "https://evil.example", "/a b", "/[x](https://evil.example)", "/x?y=1", 5, null, undefined, "/" + "a".repeat(300)]) {
    assert.equal(cleanPage(bad), "", String(bad));
  }
  const f = fakeFetch();
  await run(post({ ...valid, page: "[クリック](https://evil.example)" }), ENV, f);
  assert.deepEqual(JSON.parse(f.calls[1].init.body).embeds[0].fields.map((x) => x.name), ["種類", "連絡先"], "不正なページは載せない");
});

test("Discord の上限（title 256・description 4096・field 値 1024）を超えない", async () => {
  const f = fakeFetch();
  await run(post({ ...valid, message: "あ".repeat(3000), contact: "い".repeat(1000), page: "/" + "a".repeat(299) }), ENV, f);
  const embed = JSON.parse(f.calls[1].init.body).embeds[0];
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  for (const field of embed.fields) assert.ok(field.value.length <= 1024 && field.name.length <= 256, field.name);
});
