// 起動前の読み込み表示（#boot-indicator）と、テンプレートの区切りの扱いの確認。
// pokemon の build-entry-pages.test.mjs の検査を、kit の出力（tests/fixtures/pokemon/index.html のテンプレートから作る）に当てたもの。
//   node --test tests/build/boot-indicator.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPages, BODY_START, BODY_END } from "../../build/build-pages.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pokemon");
const entries = JSON.parse(readFileSync(join(fixtures, "entry-pages.json"), "utf8"));
const template = readFileSync(join(fixtures, "index.html"), "utf8");
const BOOT_INDICATOR = 'id="boot-indicator"';
const MUDBLAZOR_CSS = '<link href="_content/MudBlazor/MudBlazor.min.css"';

const SITE = {
    name: "Pokémon Battle Assistant",
    origin: "https://pokemon.fara-labs.com",
    devOrigin: "https://pokemon-dev.fara-labs.com",
    lang: "ja",
    locale: "ja_JP",
    homeFile: "home.html",
    spaFallback: {},
    notFoundPage: false,
    robotsDisallow: ["/my-", "/data-share", "/api/my/"],
    developRobots: "allow",
    maxDescription: 150,
    bodyRootClass: "entry-static",
};

// 本文は pokemon の本文の形（main と本文のテキスト）を簡単に模したもの。boot-indicator の検査には本文の中身は関係ない
const pages = entries.map((entry) => ({
    path: entry.route === "" ? "/" : `/${entry.route}`,
    title: entry.title,
    description: entry.description,
    bodyHtml: `<main class="entry-static" data-route="${entry.route}"><h1>${entry.heading}</h1><p>${entry.paragraphs[0]}</p></main>`,
}));

const files = buildPages({ site: SITE, pages, template, env: "production" });
const htmlOutputs = [...files].filter(([name]) => name.endsWith(".html"));

test("読み込み表示は、どの出力（ページと SPA のフォールバック）にも 1 つだけあり、#app より前にある", () => {
    assert.ok(htmlOutputs.length >= entries.length + 1);
    for (const [name, html] of htmlOutputs) {
        assert.equal(html.split(BOOT_INDICATOR).length - 1, 1, name);
        assert.ok(html.indexOf(BOOT_INDICATOR) < html.indexOf('<div id="app">'), `${name}: #app の外（前）にある`);
    }
});

test("読み込み表示は本文（main）の中に入らない。本文テキストに「読み込み中」を直接書かない（CSS の :empty で出す）", () => {
    for (const [name, html] of htmlOutputs) {
        const main = html.indexOf("<main");
        if (main >= 0) {
            const mainEnd = html.indexOf("</main>", main);
            assert.doesNotMatch(html.slice(main, mainEnd), /読み込み中|boot-indicator/, `${name}: 本文の中に入っている`);
        }
        const bodyText = html.slice(html.indexOf("<body>")).replace(/<[^>]*>/g, "");
        assert.doesNotMatch(bodyText, /読み込み中/, name);
    }
});

test("起動前のオーバーレイのスタイルはインラインで、どの出力でも最初の stylesheet より前にある", () => {
    for (const [name, html] of htmlOutputs) {
        const style = html.indexOf("<style>");
        assert.ok(style >= 0, `${name}: インラインの style がある`);
        assert.ok(html.indexOf("#boot-indicator {") > style, name);
        assert.ok(style < html.indexOf(MUDBLAZOR_CSS), `${name}: 最初の stylesheet より前`);
        assert.match(html, /html\[data-bs-theme="dark"\] #boot-indicator \{ background: #0c0616;/, name);
        assert.match(html, /\.boot-indicator-label:empty::before \{/, name);
        // 保険: JS が動かなくても 60 秒で隠れる（CSS）。テンプレートに inert は直接書かない（JS が付けて外す）
        assert.match(html, /animation: boot-indicator-release 0s linear 60s forwards;/, name);
        assert.doesNotMatch(html, /inert/, name);
    }
});

test("JavaScript が無いとき読み込み表示を隠す（noscript の style）。起動後に外す js は #app の後・Blazor より前に読む", () => {
    for (const [name, html] of htmlOutputs) {
        assert.match(html, /<noscript><style>#boot-indicator \{ display: none; \}<\/style><\/noscript>/, name);
        const script = html.indexOf('src="js/boot-indicator.js"');
        assert.ok(script > html.indexOf('<div id="app">'), `${name}: #app の後ろで読む`);
        assert.ok(script < html.indexOf("_framework/blazor.webassembly.js"), `${name}: Blazor の起動より前に監視を始める`);
    }
    assert.match(htmlOutputs[0][1], /role="status" aria-live="polite"/);
});

test("SPA のフォールバック（index.html）は汎用の title だけで、本文は空のまま", () => {
    const fallback = files.get("index.html");
    assert.match(fallback, /<title>Pokémon Battle Assistant<\/title>/);
    assert.doesNotMatch(fallback, /entry-static|description/);
    assert.equal(fallback.slice(fallback.indexOf(BODY_START) + BODY_START.length, fallback.indexOf(BODY_END)).trim(), "");
});

test("同じテンプレートから作り直すと、同じ結果になる（区切りが残るので、作り直しても崩れない）", () => {
    // 出力の index.html（SPA のフォールバック）は本文が空なので、テンプレートにしても作り直せる
    const fallback = files.get("index.html");
    const again = buildPages({ site: SITE, pages, template: fallback, env: "production" });
    for (const [name, html] of files) {
        if (name === "robots.txt" || name === "sitemap.xml") continue;
        assert.equal(again.get(name), html, `${name} が作り直しで変わりました`);
    }
});

test("生成済みのページ（本文が入った HTML）をテンプレートにすると、作らずに失敗する", () => {
    const home = files.get("home.html");
    assert.throws(() => buildPages({ site: SITE, pages, template: home, env: "production" }), /生成済みの index\.html/);
});
