// レイアウトの自動計測の統合テスト（ブラウザを使う）。 node --test tests/layout-check/integration.test.mjs
// 正しい例（fixtures/good）は違反 0 件、わざと崩した例（fixtures/bad）は各ルールの違反が出ることを確かめる。
// 既定は bundled の chromium（CI は npx playwright-core install --with-deps chromium）。ローカルで Edge を使うときは LAYOUT_CHECK_CHANNEL=msedge。
// npm test には含めない（npm run test:layout-check）。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatViolation, runLayoutCheck } from "../../tools/layout-check/index.mjs";
import { startStaticServer } from "../../tools/layout-check/serve-static.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIRST_PORT = 8820;
const CHANNEL = process.env.LAYOUT_CHECK_CHANNEL || undefined;
const TIMEOUT = 180000;

let stopServer;
let origin;

function config(site, overrides = {}) {
  return {
    baseURL: `${origin}/${site}`,
    pages: [{ path: "/", name: "テスト" }],
    viewports: [360, 1024],
    readySelector: "main",
    menuEsc: { buttonSelector: "#menu" },
    browser: { channel: CHANNEL },
    timeoutMs: 30000,
    ...overrides,
  };
}

before(async () => {
  const started = await startStaticServer(FIXTURES, FIRST_PORT);
  origin = started.origin;
  stopServer = started.close;
});

after(async () => {
  if (stopServer) await stopServer();
});

test("正しい例は違反 0 件", { timeout: TIMEOUT }, async () => {
  const { violations, runs } = await runLayoutCheck(config("good"));
  assert.equal(runs, 2);
  assert.deepEqual(violations.map(formatViolation), []);
});

test("わざと崩した例は、各ルールの違反が出る", { timeout: TIMEOUT }, async () => {
  const { violations } = await runLayoutCheck(config("bad"));
  const rules = new Set(violations.map((v) => v.rule));
  for (const rule of [
    "single-h1",
    "no-horizontal-scroll",
    "tap-target",
    "focus-visible",
    "no-offscreen-focus",
    "min-font-size",
    "menu-esc",
  ]) {
    assert.ok(rules.has(rule), `${rule} の違反が出ていない:\n${violations.map(formatViolation).join("\n")}`);
  }
  const h1 = violations.find((v) => v.rule === "single-h1");
  assert.match(h1.message, /2 つ/);
});

test("除外（理由つき）で、その要素の違反が消える", { timeout: TIMEOUT }, async () => {
  const { violations } = await runLayoutCheck(
    config("bad", {
      viewports: [360],
      rules: { "single-h1": false, "no-horizontal-scroll": false, "focus-visible": false, "no-offscreen-focus": false, "min-font-size": false, "menu-esc": false },
      exclusions: [{ rule: "tap-target", selector: "#small-button", reason: "テスト用の小さなボタン（除外の動作を見る）" }],
    }),
  );
  const text = violations.map(formatViolation).join("\n");
  assert.ok(violations.every((v) => v.rule === "tap-target"), text);
  assert.ok(violations.some((v) => v.selector.includes("#menu")), `前提が崩れている（メニューボタンも違反に出るはず）:\n${text}`);
  assert.ok(!violations.some((v) => v.selector.includes("#small-button")), `除外したボタンが違反に出ている:\n${text}`);
});

test("ブラウザを起動できないときは、明確な文の LayoutCheckRunError（CLI は終了コード 2）", { timeout: TIMEOUT }, async () => {
  await assert.rejects(
    runLayoutCheck(config("good", { browser: { channel: "no-such-browser-channel" } })),
    (error) => error.name === "LayoutCheckRunError" && /ブラウザを起動できなかった/.test(error.message),
  );
});
