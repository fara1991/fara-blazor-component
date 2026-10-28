// 文字列の整え方（text.js）と、それを使う report.js・maintenance.js が同じ入力に同じ結果を返すこと。  node --test worker/text.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "./text.js";
import { clean } from "./report.js";
import { getMaintenance } from "./maintenance.js";

const SAMPLES = [
  ["  a\u0000b\u0007c\nd\te  ", 100],
  ["あいうえお", 3],
  ["a\uD83Db😀", 10],
  ["😀".repeat(5), 3],
  ["\uDE00只の末尾", 10],
  ["   ", 5],
];

test("cleanText: 制御文字を取り、前後の空白を取り、長さを文字数で切る", () => {
  assert.equal(cleanText("  a\u0000b\u0007c\nd\te  ", 100), "abc\nd\te");
  assert.equal(cleanText("あいうえお", 3), "あいう");
  assert.equal(cleanText(undefined, 10), "");
  assert.equal(cleanText(5, 10), "");
  assert.equal(cleanText({}, 10), "");
});

test("cleanText: 対になっていないサロゲートを取り、絵文字は割らない", () => {
  assert.equal(cleanText("a\uD83Db😀", 10), "ab😀");
  assert.equal(cleanText("😀".repeat(5), 3), "😀😀😀");
  assert.doesNotMatch(cleanText("😀".repeat(10), 3), /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test("報告（clean）とメンテナンスの文（getMaintenance）は、同じ入力に同じ結果を返す", () => {
  for (const [input, max] of SAMPLES) {
    assert.equal(clean(input, max), cleanText(input, max), `report: ${JSON.stringify(input)}`);
    // メンテナンスの文は 200 文字（MAX_MESSAGE）で切る
    const info = getMaintenance({ MAINTENANCE_MODE: "notice", MAINTENANCE_MESSAGE: input });
    assert.equal(info.message, cleanText(input, 200), `maintenance: ${JSON.stringify(input)}`);
  }
});

test("メンテナンスの文は、対になっていないサロゲートを取り、200 文字で切る（絵文字は割れない）", () => {
  const info = getMaintenance({ MAINTENANCE_MODE: "notice", MAINTENANCE_MESSAGE: "a\uD83D" + "😀".repeat(300) });
  assert.equal(Array.from(info.message).length, 200);
  assert.doesNotMatch(info.message, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.ok(info.message.startsWith("a😀"));
});
