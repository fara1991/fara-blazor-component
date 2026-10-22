// build/build-pages.mjs の確認（サイトに依存しない入力で）。
//   node --test tests/build/build-pages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildPages, BuildError, escapeHtml, escapeJsonLd, outputFileFor, main, HEAD_START, HEAD_END, BODY_START, BODY_END } from "../../build/build-pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "..", "build", "build-pages.mjs");

const TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-x="1">
<head>
    <meta charset="utf-8" />
    ${HEAD_START}
    <title>Template</title>
    ${HEAD_END}
    <link href="css/app.css" rel="stylesheet" />
</head>
<body>
    <div id="boot-indicator" class="boot"><span role="status"></span></div>
    <div id="app">
        ${BODY_START}
        ${BODY_END}
    </div>
    <script src="_framework/blazor.webassembly.js"></script>
</body>
</html>
`;

const SITE = {
    name: "Example Site",
    origin: "https://example.com",
    devOrigin: "https://dev.example.com",
    lang: "ja",
    locale: "ja_JP",
    robotsDisallow: ["/private"],
};

const PAGES = [
    { path: "/", title: "Home", description: "Top page.", bodyHtml: "<main>home</main>" },
    { path: "/learn/intro", title: "Intro", description: "Intro page.", bodyHtml: "<main>intro</main>", lastmod: "2026-01-15", changefreq: "weekly", priority: 0.8 },
    { path: "/old-note", title: "Note", description: "Hidden.", bodyHtml: "<main>note</main>", noindex: true },
];

function build(overrides = {}) {
    return buildPages({ site: SITE, pages: PAGES, template: TEMPLATE, env: "production", ...overrides });
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

test("production: ページの HTML・robots.txt・sitemap.xml を作り、home は既定で index.html", () => {
    const files = build();
    assert.deepEqual([...files.keys()], ["index.html", "learn/intro.html", "old-note.html", "404.html", "robots.txt", "sitemap.xml"]);
    const home = files.get("index.html");
    assert.match(home, /<title>Home<\/title>/);
    assert.match(home, /<link rel="canonical" href="https:\/\/example\.com\/" \/>/);
    assert.match(home, /<main>home<\/main>/);
    assert.match(home, /<html lang="ja" data-x="1">/, "lang を入れ、他の属性は残す");
    assert.match(home, /<div id="boot-indicator"/, "読み込み表示は残す");
    assert.match(home, /_framework\/blazor\.webassembly\.js/);
});

test("本文の外（区切りの外）は変えず、区切りの中だけを書き換える", () => {
    const html = build().get("learn/intro.html");
    assert.match(html, /<link href="css\/app\.css" rel="stylesheet" \/>/);
    assert.match(html, /<div id="boot-indicator" class="boot"><span role="status"><\/span><\/div>/);
    assert.doesNotMatch(html, /<title>Template<\/title>/);
    assert.equal(html.split(HEAD_START).length - 1, 1, "区切りは残る（作り直しても崩れない）");
});

test("title・description・ogImage はエスケープし、bodyHtml はそのまま入れる", () => {
    const files = build({
        pages: [{ path: "/a", title: 'T "<b>" & c', description: "d <x> & \"y\"", bodyHtml: "<p>raw &amp; <b>ok</b></p>", ogImage: "/img/og.png" }],
    });
    const html = files.get("a.html");
    assert.match(html, /<title>T &quot;&lt;b&gt;&quot; &amp; c<\/title>/);
    assert.match(html, /content="d &lt;x&gt; &amp; &quot;y&quot;"/);
    assert.match(html, /<p>raw &amp; <b>ok<\/b><\/p>/);
    assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/img\/og\.png" \/>/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
});

test("OGP と Twitter カードの順序（画像が無いときは summary）", () => {
    const html = build().get("learn/intro.html");
    const order = ["<title>", 'name="description"', 'rel="canonical"', "og:site_name", "og:locale", "og:type", "og:title", "og:description", "og:url", "twitter:card"]
        .map((needle) => html.indexOf(needle));
    assert.ok(order.every((index) => index >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(html, /<meta name="twitter:card" content="summary" \/>/);
    assert.doesNotMatch(html, /og:image/);
});

test("noindex のページは robots の meta を付け、sitemap に入れない。通常のページには付けない", () => {
    const files = build();
    assert.match(files.get("old-note.html"), /<meta name="robots" content="noindex" \/>/);
    assert.doesNotMatch(files.get("learn/intro.html"), /name="robots"/);
    assert.doesNotMatch(files.get("sitemap.xml"), /old-note/);
});

test("sitemap.xml: lastmod・changefreq・priority は指定があるときだけ。日付は入力のまま（Date を使わない）", () => {
    const xml = build().get("sitemap.xml");
    assert.equal(xml, [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://example.com/</loc></url>",
        "  <url><loc>https://example.com/learn/intro</loc><lastmod>2026-01-15</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>",
        "</urlset>",
        "",
    ].join("\n"));
});

test("robots.txt: production は robotsDisallow と Sitemap。develop は既定で全部 Disallow", () => {
    const prod = build().get("robots.txt");
    assert.equal(prod, "User-agent: *\nDisallow: /private\n\nSitemap: https://example.com/sitemap.xml\n");
    const dev = build({ env: "develop" }).get("robots.txt");
    assert.equal(dev, "User-agent: *\nDisallow: /\n");
    const devAllow = build({ env: "develop", site: { ...SITE, developRobots: "allow" } }).get("robots.txt");
    assert.equal(devAllow, "User-agent: *\nAllow: /\n");
});

test("develop: 本番のホストを canonical にせず、確認用のホストを使う。sitemap.xml は作らない。通常のページに noindex を付けない", () => {
    const files = build({ env: "develop" });
    assert.ok(!files.has("sitemap.xml"));
    assert.match(files.get("learn/intro.html"), /https:\/\/dev\.example\.com\/learn\/intro/);
    assert.doesNotMatch(files.get("learn/intro.html"), /name="robots"/);
});

test("同じ入力は同じ出力（決定論的）", () => {
    const a = [...build().entries()];
    const b = [...build().entries()];
    assert.deepEqual(a, b);
});

test("urlStyle: directory は <path>/index.html、home は homeFile", () => {
    assert.equal(outputFileFor("/learn/intro", { urlStyle: "directory", homeFile: "index.html" }), "learn/intro/index.html");
    assert.equal(outputFileFor("/learn/intro", { urlStyle: "html", homeFile: "index.html" }), "learn/intro.html");
    const files = build({ site: { ...SITE, urlStyle: "directory" } });
    assert.ok(files.has("learn/intro/index.html"));
});

test("spaFallback: 汎用の title だけの index.html（本文は入れない）。homeFile を home.html にする", () => {
    const files = build({ site: { ...SITE, homeFile: "home.html", spaFallback: {} } });
    assert.ok(files.has("home.html"));
    const fallback = files.get("index.html");
    assert.match(fallback, /<title>Example Site<\/title>/);
    assert.doesNotMatch(fallback, /Home|noindex|canonical/);
    assert.doesNotMatch(fallback, /<main>/, "本文は入れない");
});

test("404.html は既定で作る（noindex・既定の title）。notFoundPage: false で作らない", () => {
    const files = build();
    const notFound = files.get("404.html");
    assert.match(notFound, /<title>ページが見つかりません \| Example Site<\/title>/);
    assert.match(notFound, /<meta name="robots" content="noindex" \/>/);
    assert.ok(!build({ site: { ...SITE, notFoundPage: false } }).has("404.html"));
});

test("csp を渡すと _headers を作る。develop は X-Robots-Tag: noindex、production は付けない", () => {
    const csp = { scriptSrc: ["https://challenges.cloudflare.com"], frameSrc: ["https://challenges.cloudflare.com"] };
    const prod = build({ site: { ...SITE, csp } }).get("_headers");
    assert.match(prod, /script-src 'self' 'wasm-unsafe-eval' https:\/\/challenges\.cloudflare\.com;/);
    assert.doesNotMatch(prod, /X-Robots-Tag/);
    const dev = build({ env: "develop", site: { ...SITE, csp } }).get("_headers");
    assert.match(dev, /X-Robots-Tag: noindex/);
    assert.ok(!build().has("_headers"));
});

test("redirects: _redirects に 301 の行を作る（入力の順。status の省略は 301）", () => {
    const files = buildPages({
        site: SITE,
        pages: PAGES,
        redirects: [{ from: "/glossary", to: "/battle-terms" }, { from: "/old", to: "https://other.example.org/x", status: 302 }],
        template: TEMPLATE,
        env: "production",
    });
    assert.equal(files.get("_redirects"), "/glossary /battle-terms 301\n/old https://other.example.org/x 302\n");
});

test("重複・不正な path・長すぎる description・空の項目は、すべてまとめて報告する", () => {
    const problems = problemsOf(() => buildPages({
        site: SITE,
        pages: [
            { path: "/a", title: "A", description: "x".repeat(200), bodyHtml: "<p>a</p>" },
            { path: "/a", title: "A2", description: "ok", bodyHtml: "<p>a2</p>" },
            { path: "/Bad/", title: "B", description: "ok", bodyHtml: "<p>b</p>" },
            { path: "/c", title: "", description: "ok", bodyHtml: "<p>c</p>" },
        ],
        template: TEMPLATE,
        env: "production",
    }));
    assert.ok(problems.some((p) => /description が 160 文字を超えています/.test(p)));
    assert.ok(problems.some((p) => /path が重複しています/.test(p)));
    assert.ok(problems.some((p) => /\/Bad\/.*path は/.test(p)));
    assert.ok(problems.some((p) => /title がありません/.test(p)));
});

test("bodyHtml に SEO の区切りを入れると失敗する", () => {
    const problems = problemsOf(() => build({ pages: [{ path: "/a", title: "A", description: "d", bodyHtml: `<p>${BODY_END}</p>` }] }));
    assert.ok(problems.some((p) => /SEO の区切り/.test(p)));
});

test("noindex のページに別の canonical を指定すると失敗する。noindex のページを canonical に指すのも失敗する", () => {
    const first = problemsOf(() => build({
        pages: [{ path: "/a", title: "A", description: "d", bodyHtml: "<p>a</p>", noindex: true, canonical: "/b" }, { path: "/b", title: "B", description: "d", bodyHtml: "<p>b</p>" }],
    }));
    assert.ok(first.some((p) => /シグナルが矛盾/.test(p)));
    const second = problemsOf(() => build({
        pages: [{ path: "/a", title: "A", description: "d", bodyHtml: "<p>a</p>", canonical: "/b" }, { path: "/b", title: "B", description: "d", bodyHtml: "<p>b</p>", noindex: true }],
    }));
    assert.ok(second.some((p) => /noindex のページを指しています/.test(p)));
});

test("canonical は同じホストだけ。別のホストは失敗する", () => {
    const problems = problemsOf(() => build({ pages: [{ path: "/a", title: "A", description: "d", bodyHtml: "<p>a</p>", canonical: "https://other.example.org/a" }] }));
    assert.ok(problems.some((p) => /同じホスト/.test(p)));
});

test("lastmod は実在する日付だけ。changefreq と priority も検査する", () => {
    const problems = problemsOf(() => build({
        pages: [{ path: "/a", title: "A", description: "d", bodyHtml: "<p>a</p>", lastmod: "2026-02-30", changefreq: "sometimes", priority: 2 }],
    }));
    assert.ok(problems.some((p) => /lastmod/.test(p)));
    assert.ok(problems.some((p) => /changefreq/.test(p)));
    assert.ok(problems.some((p) => /priority/.test(p)));
});

test("知らない項目（綴りの間違い）は失敗する", () => {
    const problems = problemsOf(() => build({ site: { ...SITE, robotDisallow: ["/x"] } }));
    assert.ok(problems.some((p) => /知らない項目 "robotDisallow"/.test(p)));
});

test("テンプレートの区切りが無い・重複・#app が無い・SEO-BODY が #app の外にあると失敗する", () => {
    assert.ok(problemsOf(() => build({ template: "<html><head></head><body></body></html>" })).some((p) => /区切り/.test(p)));
    assert.ok(problemsOf(() => build({ template: TEMPLATE.replace(BODY_END, BODY_END + BODY_END) })).some((p) => /区切り/.test(p)));
    assert.ok(problemsOf(() => build({ template: TEMPLATE.replace('<div id="app">', '<div id="other">') })).some((p) => /<div id="app">/.test(p)));
    const outside = `<html><head>${HEAD_START}${HEAD_END}</head><body>${BODY_START}${BODY_END}<div id="app"></div></body></html>`;
    assert.ok(problemsOf(() => build({ template: outside })).some((p) => /#app の中/.test(p)));
});

test("env が不正・homeFile と spaFallback が index.html で重なる・出力名が重複すると失敗する", () => {
    assert.ok(problemsOf(() => build({ env: "staging" })).some((p) => /env は/.test(p)));
    assert.ok(problemsOf(() => build({ site: { ...SITE, spaFallback: {} } })).some((p) => /index\.html/.test(p)));
    const clash = problemsOf(() => build({ pages: [{ path: "/", title: "H", description: "d", bodyHtml: "<p>h</p>" }, { path: "/index", title: "I", description: "d", bodyHtml: "<p>i</p>" }] }));
    assert.ok(clash.some((p) => /出力ファイル index\.html が重複/.test(p)));
});

test("redirects の検査: 既存のページと同じ from・from と to が同じ・不正な status は失敗する", () => {
    const problems = problemsOf(() => build({
        redirects: [{ from: "/learn/intro", to: "/x" }, { from: "/y", to: "/y" }, { from: "/z", to: "/w", status: 200 }],
    }));
    assert.ok(problems.some((p) => /既存のページと同じ/.test(p)));
    assert.ok(problems.some((p) => /from と to が同じ/.test(p)));
    assert.ok(problems.some((p) => /status は/.test(p)));
});

test("サイト設定の不備（origin の形・必須項目）は失敗する", () => {
    const problems = problemsOf(() => build({ site: { ...SITE, origin: "https://example.com/", lang: undefined } }));
    assert.ok(problems.some((p) => /origin/.test(p)));
    assert.ok(problems.some((p) => /lang/.test(p)));
});

test("escapeHtml / escapeJsonLd: 属性・本文・JSON-LD の安全な形", () => {
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;'");
    assert.equal(escapeJsonLd(JSON.stringify({ n: "</script><b>&" })), '{"n":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026"}');
});

test("JSON-LD は script の中で閉じずに出る", () => {
    const html = build({ pages: [{ path: "/a", title: "A", description: "d", bodyHtml: "<p>a</p>", jsonLd: { "@type": "WebPage", name: "</script>" } }] }).get("a.html");
    assert.match(html, /<script type="application\/ld\+json">\{"@type":"WebPage","name":"\\u003c\/script\\u003e"\}<\/script>/);
});

test("CLI: 一時フォルダに書き出し、_redirects の末尾まで含めて検査し、失敗時は終了コード 1 とメッセージ", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-build-cli-"));
    const site = join(dir, "site.json");
    const pages = join(dir, "pages.json");
    const template = join(dir, "index.html");
    const out = join(dir, "out");
    writeFileSync(site, JSON.stringify(SITE));
    writeFileSync(pages, JSON.stringify({ pages: PAGES, redirects: [{ from: "/glossary", to: "/battle-terms" }] }));
    writeFileSync(template, TEMPLATE);
    const stdout = execFileSync(process.execPath, [CLI, "--site", site, "--pages", pages, "--template", template, "--out", out, "--env", "production"], { encoding: "utf8" });
    assert.match(stdout, /書き出しました/);
    assert.ok(existsSync(join(out, "index.html")));
    assert.equal(readFileSync(join(out, "_redirects"), "utf8"), "/glossary /battle-terms 301\n");
    assert.ok(readdirSync(out).includes("learn"), "ネストしたフォルダを作る");

    const bad = { ...SITE, origin: "http://insecure.example" };
    writeFileSync(site, JSON.stringify(bad));
    assert.throws(() => execFileSync(process.execPath, [CLI, "--site", site, "--pages", pages, "--template", template, "--out", out, "--env", "production"], { encoding: "utf8", stdio: "pipe" }), (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /origin/);
        return true;
    });
});

test("main: 引数が足りないと失敗する", () => {
    assert.throws(() => main(["--site", "x"]), /--pages/);
});
