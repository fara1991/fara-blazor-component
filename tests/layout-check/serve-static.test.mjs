// 静的ファイルの簡易サーバー（serve-static.mjs）の解決順と 404 の確認。ブラウザは使わない。  node --test tests/layout-check/serve-static.test.mjs
// 解決順: ファイルそのもの → <path>.html → <path>/index.html（フォルダに index.html が無ければ <dir>.html）。末尾の / はフォルダを先に見る。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseServeArgs, startStaticServer } from "../../tools/layout-check/serve-static.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "serve");
const FIRST_PORT = 8840;

let plain;
let spa;
let withNotFound;

async function get(server, path) {
  const response = await fetch(`${server.origin}${path}`);
  return { status: response.status, body: await response.text() };
}

before(async () => {
  plain = await startStaticServer(ROOT, FIRST_PORT);
  withNotFound = await startStaticServer(ROOT, FIRST_PORT, { notFoundFile: "404.html" });
  spa = await startStaticServer(ROOT, FIRST_PORT, { spaFallback: true });
});

after(async () => {
  await plain?.close();
  await withNotFound?.close();
  await spa?.close();
});

test("ファイルそのものは、そのまま返す（/index.html・/404.html）", async () => {
  assert.match((await get(plain, "/index.html")).body, /トップ/);
  assert.equal((await get(plain, "/404.html")).status, 200);
});

test("/ は index.html（末尾の / も同じ）", async () => {
  const root = await get(plain, "/");
  assert.equal(root.status, 200);
  assert.match(root.body, /トップ/);
});

test("同名のフォルダがあっても、<path>.html を先に返す（/worlds → worlds.html）", async () => {
  const response = await get(plain, "/worlds");
  assert.equal(response.status, 200);
  assert.match(response.body, /worlds\.html/);
});

test("フォルダに index.html が無ければ <dir>.html へフォールバック（/worlds/ → worlds.html）", async () => {
  const response = await get(plain, "/worlds/");
  assert.equal(response.status, 200);
  assert.match(response.body, /worlds\.html/);
});

test("フォルダの中のファイルは、拡張子を省いても届く（/worlds/item → worlds/item.html）", async () => {
  const response = await get(plain, "/worlds/item");
  assert.equal(response.status, 200);
  assert.match(response.body, /worlds\/item\.html/);
});

test("フォルダに index.html があり、同名の .html が無ければ index.html（/docs・/docs/）", async () => {
  assert.match((await get(plain, "/docs")).body, /docs\/index\.html/);
  assert.match((await get(plain, "/docs/")).body, /docs\/index\.html/);
});

test("<path>.html はフォルダの index.html より先（/learn → learn.html）", async () => {
  assert.match((await get(plain, "/learn")).body, /learn\.html/);
});

test("/works は works.html（ファイルの .html）", async () => {
  assert.match((await get(plain, "/works")).body, /works\.html/);
});

test("存在しないパスは 404（既定は本文 not found）", async () => {
  const response = await get(plain, "/missing");
  assert.equal(response.status, 404);
  assert.equal(response.body, "not found");
});

test("CLI の引数: 位置の引数（配る元・ポート）と、フラグ --not-found・--spa", () => {
  assert.deepEqual(parseServeArgs(["publish/wwwroot", "8820"]), { root: "publish/wwwroot", port: 8820, options: { notFoundFile: undefined, spaFallback: false } });
  assert.deepEqual(parseServeArgs(["dist", "--not-found", "404.html", "--spa"]), { root: "dist", port: 8820, options: { notFoundFile: "404.html", spaFallback: true } });
  assert.throws(() => parseServeArgs(["dist", "--not-found"]), /--not-found/);
});

test("notFoundFile を設定すると、404 のステータスのまま、その本文を返す", async () => {
  const response = await get(withNotFound, "/missing/page");
  assert.equal(response.status, 404);
  assert.match(response.body, /404 の画面/);
});

test("spaFallback を設定すると、存在しないパスは index.html を 200 で返す", async () => {
  const response = await get(spa, "/missing/page");
  assert.equal(response.status, 200);
  assert.match(response.body, /トップ/);
});

test("ルートの外のファイルは返さない（..・.html の候補がルートの外になる / も 404）", async () => {
  assert.equal((await fetch(`${plain.origin}/%2e%2e/serve-static.test.mjs`)).status, 404);
});
