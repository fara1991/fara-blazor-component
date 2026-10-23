// build-pages の検査の強化（レビュー指摘の対応）の確認: _redirects の注入・テンプレートの上書き・冪等・本文の約束（class）・言語タグ・未知の項目・上限。
//   node --test tests/build/hardening.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
    buildPages, BuildError, readPagesInput, main, HEAD_START, HEAD_END, BODY_START, BODY_END,
} from "../../build/build-pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "..", "build", "build-pages.mjs");

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    ${HEAD_START}
    <title>Template</title>
    ${HEAD_END}
</head>
<body>
    <div id="boot-indicator"></div>
    <div id="app">
        ${BODY_START}
        ${BODY_END}
    </div>
    <script src="_framework/blazor.webassembly.js"></script>
</body>
</html>
`;

const SITE = {
    name: "Example",
    origin: "https://example.com",
    devOrigin: "https://dev.example.com",
    lang: "ja",
    locale: "ja_JP",
};

const PAGE = { path: "/a", title: "A", description: "d", bodyHtml: "<p>a</p>" };

function build(overrides = {}) {
    return buildPages({ site: SITE, pages: [PAGE], template: TEMPLATE, env: "production", ...overrides });
}

function problemsOf(fn) {
    try {
        fn();
    } catch (error) {
        assert.ok(error instanceof BuildError, `BuildError を期待: ${error.message}`);
        return error.problems;
    }
    assert.fail("例外が出ませんでした");
}

test("_redirects: to に空白・改行・制御文字があると拒否する（1 行の形を壊せない）", () => {
    for (const to of ["https://a.example/x y", "https://a.example/x\n/evil 301", "https://a.example/\u0000x", "/ok\n/evil"]) {
        const problems = problemsOf(() => build({ redirects: [{ from: "/old", to }] }));
        assert.ok(problems.some((p) => /空白・改行・制御文字|小文字・数字・ハイフンのパス/.test(p)), JSON.stringify(to));
    }
});

test("_redirects: to の絶対 URL は https のみ・URL として読めること。出力は正規化した URL", () => {
    assert.ok(problemsOf(() => build({ redirects: [{ from: "/old", to: "http://a.example/x" }] })).some((p) => /https:\/\/ の URL/.test(p)));
    assert.ok(problemsOf(() => build({ redirects: [{ from: "/old", to: "https://" }] })).some((p) => /URL として読めません/.test(p)));
    const files = build({ redirects: [{ from: "/old", to: "https://A.example.org" }] });
    assert.equal(files.get("_redirects"), "/old https://a.example.org/ 301\n");
});

test("_redirects: 静的の上限 2000 件・1 行 1000 文字を超えるとエラー", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ from: `/r${i}`, to: "/t" }));
    assert.ok(problemsOf(() => build({ redirects: many })).some((p) => /2000 件まで/.test(p)));
    const long = { from: "/long", to: `https://a.example/${"x".repeat(1000)}` };
    assert.ok(problemsOf(() => build({ redirects: [long] })).some((p) => /1000 文字/.test(p)));
});

test("本文の約束の class（bodyRootClass）: 先頭の要素に無いと失敗し、ある場合は通る", () => {
    const site = { ...SITE, bodyRootClass: "entry-static" };
    assert.ok(problemsOf(() => build({ site })).some((p) => /class="entry-static" が必要/.test(p)));
    assert.ok(problemsOf(() => build({ site, pages: [{ ...PAGE, bodyHtml: '<main class="entry-static-x">a</main>' }] })).length > 0);
    assert.ok(problemsOf(() => build({ site, pages: [{ ...PAGE, bodyHtml: "<p>x</p><main class=\"entry-static\">a</main>" }] })).length > 0, "先頭の要素だけを見る");
    const ok = build({ site, pages: [{ ...PAGE, bodyHtml: '<main class="a entry-static b" data-route="a">x</main>' }] });
    assert.ok(ok.has("index.html") || ok.has("a.html"));
});

test("本文の構造を固定: SEO-BODY の中は本文の先頭要素（class 付き）で始まり、#app の中にある", () => {
    const site = { ...SITE, bodyRootClass: "entry-static" };
    const html = build({ site, pages: [{ ...PAGE, bodyHtml: '<main class="entry-static" data-route="a"><h1>A</h1></main>' }] }).get("a.html");
    const appStart = html.indexOf('<div id="app">');
    const start = html.indexOf(BODY_START);
    const end = html.indexOf(BODY_END);
    assert.ok(appStart >= 0 && appStart < start && start < end, "#app の中");
    const inside = html.slice(start + BODY_START.length, end).trim();
    assert.match(inside, /^<main class="entry-static" data-route="a">/);
    assert.ok(html.indexOf("</div>", appStart) > end, "#app を閉じる </div> の前に区切りが終わる");
});

test("テンプレートの #app は属性付きでも受ける（<div class=… id=\"app\" …>）", () => {
    const template = TEMPLATE.replace('<div id="app">', '<div class="root" id="app" data-x="1">');
    const html = build({ template }).get("a.html");
    assert.match(html, /<div class="root" id="app" data-x="1">/);
    assert.match(html, /<p>a<\/p>/);
});

test("lang・locale は形を検査し、置換で $ を解釈しない", () => {
    assert.ok(problemsOf(() => build({ site: { ...SITE, lang: "ja'; $&" } })).some((p) => /BCP 47/.test(p)));
    assert.ok(problemsOf(() => build({ site: { ...SITE, locale: "ja-JP" } })).some((p) => /ja_JP/.test(p)));
    assert.ok(problemsOf(() => build({ pages: [{ ...PAGE, lang: "x$&" }] })).some((p) => /BCP 47/.test(p)));
    const files = build({ site: { ...SITE, lang: "pt-BR" } });
    assert.match(files.get("a.html"), /<html lang="pt-BR">/);
});

test("未知の項目: spaFallback・notFoundPage の中、spaFallback・notFoundPage の型", () => {
    assert.ok(problemsOf(() => build({ site: { ...SITE, spaFallback: { titel: "x" } } })).some((p) => /知らない項目 "titel"/.test(p)));
    assert.ok(problemsOf(() => build({ site: { ...SITE, spaFallback: { title: 5 } } })).some((p) => /title は空でない文字列/.test(p)));
    assert.ok(problemsOf(() => build({ site: { ...SITE, notFoundPage: { body: "x" } } })).some((p) => /知らない項目 "body"/.test(p)));
    assert.ok(problemsOf(() => build({ site: { ...SITE, notFoundPage: { title: 1 } } })).some((p) => /title は空でない文字列/.test(p)));
});

test("notFoundPage.bodyHtml に SEO の区切りを入れると失敗する", () => {
    const problems = problemsOf(() => build({ site: { ...SITE, notFoundPage: { bodyHtml: `<p>${HEAD_START}</p>` } } }));
    assert.ok(problems.some((p) => /SEO の区切り/.test(p)));
});

test("pages.json の最上位の未知の項目（redirect など）は失敗する", () => {
    assert.throws(() => readPagesInput({ pages: [PAGE], redirect: [] }), (error) => error instanceof BuildError && /知らない項目 "redirect"/.test(error.problems[0]));
    assert.deepEqual(readPagesInput([PAGE]).pages, [PAGE]);
    assert.throws(() => readPagesInput(null), BuildError);
});

test("_headers の上限: ルール 100 個・1 行 2000 文字を超えるとエラー（csp の欄の問題として報告）", () => {
    const rules = Array.from({ length: 99 }, (_, i) => ({ path: `/p${i}/*`, value: "no-cache" }));
    assert.doesNotThrow(() => build({ site: { ...SITE, csp: { cacheRules: rules } } }));
    const tooMany = [...rules, { path: "/extra/*", value: "no-cache" }];
    assert.ok(problemsOf(() => build({ site: { ...SITE, csp: { cacheRules: tooMany } } })).some((p) => /100 個まで/.test(p)));
    const longValue = { path: "/long/*", value: "x".repeat(2100) };
    assert.ok(problemsOf(() => build({ site: { ...SITE, csp: { cacheRules: [longValue] } } })).some((p) => /2000 文字/.test(p)));
});

test("テンプレートを出力先で上書きする設定は、書き出す前に失敗する（CLI）", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-overwrite-"));
    const site = join(dir, "site.json");
    const pages = join(dir, "pages.json");
    writeFileSync(site, JSON.stringify(SITE));
    writeFileSync(pages, JSON.stringify([{ path: "/", title: "H", description: "d", bodyHtml: "<p>h</p>" }, PAGE]));
    writeFileSync(join(dir, "index.html"), TEMPLATE);
    assert.throws(() => execFileSync(process.execPath, [CLI, "--site", site, "--pages", pages, "--template", join(dir, "index.html"), "--out", dir, "--env", "production"], { encoding: "utf8", stdio: "pipe" }), (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /テンプレート.*出力先の index\.html と同じ/);
        return true;
    });
    // 書き出されていないこと（テンプレートは元のまま）
    assert.equal(readFileSync(join(dir, "index.html"), "utf8"), TEMPLATE);
    assert.ok(!readdirSync(dir).includes("a.html"));
});

test("冪等: テンプレートを別フォルダに置けば、同じ入力を 2 回実行しても同じ結果（テンプレートは変わらない）", () => {
    const root = mkdtempSync(join(tmpdir(), "kit-idem-"));
    const tpl = join(root, "template");
    const out = join(root, "publish", "wwwroot");
    mkdirSync(tpl);
    writeFileSync(join(tpl, "index.html"), TEMPLATE);
    const site = join(root, "site.json");
    const pages = join(root, "pages.json");
    writeFileSync(site, JSON.stringify(SITE));
    writeFileSync(pages, JSON.stringify({ pages: [PAGE], redirects: [{ from: "/old", to: "/a" }] }));
    const run = () => main(["--site", site, "--pages", pages, "--template", join(tpl, "index.html"), "--out", out, "--env", "production"]);
    const first = run();
    const snapshot = Object.fromEntries(first.map((name) => [name, readFileSync(join(out, name), "utf8")]));
    const second = run();
    assert.deepEqual(second, first);
    for (const name of first) assert.equal(readFileSync(join(out, name), "utf8"), snapshot[name], name);
    assert.equal(readFileSync(join(tpl, "index.html"), "utf8"), TEMPLATE, "テンプレートは上書きされない");
    assert.ok(statSync(join(out, "a.html")).isFile());
});
