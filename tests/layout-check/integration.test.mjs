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
  // 表のセルの中で、文字の横にあるだけのリンクは、文中のリンクとして外さない
  assert.ok(violations.some((v) => v.rule === "tap-target" && v.selector.includes("#cell-link")), "表のセルのリンクが測られていない");
});

test("画面の下の項目・Tab の直後の滑らかスクロール・無効な要素（既定は数えない）", { timeout: TIMEOUT }, async () => {
  // scroll/: html に無条件の scroll-behavior: smooth。下の項目を Tab で通っても、途中位置の誤検出が出ない
  const { violations } = await runLayoutCheck(config("scroll", { viewports: [360], menuEsc: undefined }));
  assert.deepEqual(violations.map(formatViolation), []);
});

test("includeDisabled: true にすると、無効な要素（disabled・aria-disabled・pointer-events: none）も測る", { timeout: TIMEOUT }, async () => {
  const { violations } = await runLayoutCheck(config("scroll", { viewports: [360], includeDisabled: true, menuEsc: undefined }));
  const selectors = violations.map((v) => v.selector).join("\n");
  assert.equal(violations.length, 3, selectors);
  for (const name of ["small-disabled", "aria-off", "no-pointer"]) assert.ok(selectors.includes(name), `${name} が測られていない:\n${selectors}`);
});

test("allowStatus: 404 の画面を、404 のまま測れる（許していなければ計測できないエラー）", { timeout: TIMEOUT }, async () => {
  const notFound = await startStaticServer(join(FIXTURES, "serve"), FIRST_PORT + 2, { notFoundFile: "404.html" });
  try {
    const base = { baseURL: notFound.origin, viewports: [360], browser: { channel: CHANNEL } };
    const allowed = await runLayoutCheck({ ...base, pages: [{ path: "/missing", name: "404", allowStatus: [404] }], rules: { "tap-target": false } });
    assert.equal(allowed.runs, 1);
    await assert.rejects(
      runLayoutCheck({ ...base, pages: ["/missing"] }),
      (error) => error.name === "LayoutCheckRunError" && /HTTP 404/.test(error.message),
    );
  } finally {
    await notFound.close();
  }
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
