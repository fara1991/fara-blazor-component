// 例外のログ用の要約（error-summary.js）のテスト。  node --test worker/error-summary.test.mjs
// 4 つのサイトの Worker が同じ規則でログを出すので、ここで固定する（各サイトの errorSummary は持たない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorSummary, ERROR_SUMMARY_MAX } from "./error-summary.js";

test("名前とメッセージを出す", () => {
  assert.equal(errorSummary(new TypeError("bad input")), "TypeError: bad input");
  assert.equal(errorSummary(new Error("network")), "Error: network");
});

test("URL（Discord の Webhook の URL など）は外す", () => {
  const s = errorSummary(new Error("failed to fetch https://discord.example/api/webhooks/123/secret-token now"));
  assert.equal(s, "Error: failed to fetch [url] now");
  assert.ok(!s.includes("secret-token"));
  assert.equal(errorSummary(new Error("see http://a.example/x?token=1 end")), "Error: see [url] end");
});

test("トークンだけの文字列（長い英数字）・Bearer・token=・token: を取り除く", () => {
  const webhookToken = "AbCdEf123456_ghijkLMNOP-qrstuvWXYZ0123";
  const s = errorSummary(new Error(`sent to ${webhookToken} failed`));
  assert.equal(s, "Error: sent to [redacted] failed");
  assert.ok(!s.includes(webhookToken));
  assert.equal(errorSummary(new Error("auth failed Bearer abc.def-123 for user")), "Error: auth failed Bearer [redacted] for user");
  assert.equal(errorSummary(new Error("bad request token=sk_live_xyz9 in body")), "Error: bad request token=[redacted] in body");
  assert.equal(errorSummary(new Error("TOKEN: hunter2 rejected")), "Error: token=[redacted] rejected");
  // 短い語は残す
  assert.equal(errorSummary(new TypeError("cannot read properties of undefined")), "TypeError: cannot read properties of undefined");
});

test("名前にも同じ規則を当てる（名前に URL が入っていても出さない）", () => {
  const error = new Error("x");
  error.name = "Err https://discord.example/webhooks/9/secret-x";
  const s = errorSummary(error);
  assert.ok(!s.includes("secret-x"), s);
  assert.match(s, /^Err \[url\]: x$/);
});

test("制御文字は空白にし、長さは ERROR_SUMMARY_MAX（200 字）で切る", () => {
  assert.equal(errorSummary(new Error("a\nb\tc\u0000d")), "Error: a b c d");
  const long = errorSummary(new Error("x y ".repeat(500)));
  assert.equal(long.length, "Error: ".length + ERROR_SUMMARY_MAX);
  assert.equal(ERROR_SUMMARY_MAX, 200);
});

test("Error 以外の値（文字列・数・オブジェクト・null・undefined）も文字列にして出す", () => {
  assert.equal(errorSummary("plain"), "Error: plain");
  assert.equal(errorSummary(42), "Error: 42");
  assert.equal(errorSummary(null), "Error: ");
  assert.equal(errorSummary(undefined), "Error: ");
  assert.equal(errorSummary({ message: "from object" }), "Error: from object");
  assert.equal(errorSummary("token: hunter2 failed https://x.example/a"), "Error: token=[redacted] failed [url]");
});

test("文字列にできない値（Symbol）は中身を出さない", () => {
  const s = errorSummary(Symbol("secret-symbol"));
  assert.equal(typeof s, "string");
  assert.ok(!s.includes("secret-symbol"), s);
});
