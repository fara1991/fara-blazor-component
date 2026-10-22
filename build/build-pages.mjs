// \u9759\u7684\u306a\u516c\u958b\u30d5\u30a1\u30a4\u30eb\u4e00\u5f0f\u3092\u4f5c\u308b\uff08\u30b5\u30a4\u30c8\u306b\u4f9d\u5b58\u3057\u306a\u3044\uff09\u3002\u5165\u529b\u306f\u30da\u30fc\u30b8\u4e00\u89a7 JSON \u3068\u3001\u30b5\u30a4\u30c8\u8a2d\u5b9a JSON\u3002\u672c\u6587\u306e HTML \u306f\u547c\u3073\u51fa\u3057\u5074\u304c\u4f5c\u308b\u3002
//   node build/build-pages.mjs --site site.json --pages pages.json --template index.html --out <dir> --env production|develop
//
// 作るもの（--out の中。ファイル名は homeFile・urlStyle の設定による）:
//   <path>.html（または <path>/index.html）  ページごと。head（title・description・canonical・OGP・Twitter カード）と本文（#app の中の SEO-BODY）を差し込む
//   index.html                               spaFallback を指定したときだけ（汎用の title だけ。本文は入れない）
//   404.html                                 notFoundPage を指定したとき（既定は作る。false で作らない）
//   robots.txt                               production は Sitemap と robotsDisallow、develop は developRobots（既定は全部 Disallow）
//   sitemap.xml                              production だけ。noindex のページは入れない
//   _headers                                 site.json の csp を指定したときだけ（csp/render-headers.mjs。develop は X-Robots-Tag: noindex）
//   _redirects                               pages の redirects が 1 つ以上あるとき（旧 URL → 新 URL の 301 など）
//
// テンプレートは index.html（dotnet publish などの出力）。<!-- SEO-HEAD:START/END --> と <!-- SEO-BODY:START/END --> の区切りの間を書き換える。
// 区切りの外（読み込み表示の #boot-indicator・Blazor の読み込み）は触らない。ツールは決定論的（同じ入力で同じバイト列）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderHeaders } from "../csp/render-headers.mjs";

export const HEAD_START = "<!-- SEO-HEAD:START -->";
export const HEAD_END = "<!-- SEO-HEAD:END -->";
export const BODY_START = "<!-- SEO-BODY:START -->";
export const BODY_END = "<!-- SEO-BODY:END -->";

export const ENVIRONMENTS = ["production", "develop"];
const DEFAULT_MAX_DESCRIPTION = 160;
const REDIRECT_STATUSES = [301, 302, 307, 308];
const CHANGEFREQ = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
/** パス: "/" か、小文字・数字・ハイフンの区切り（/ で繋ぐ）。末尾の / は付けない。 */
const PATH_PATTERN = /^\/(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)?$/;
const ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const HTML_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.html$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SITE_KEYS = new Set(["name", "origin", "devOrigin", "lang", "locale", "homeFile", "urlStyle", "spaFallback",
    "notFoundPage", "robotsDisallow", "developRobots", "maxDescription", "csp"]);
const PAGE_KEYS = new Set(["path", "title", "description", "bodyHtml", "canonical", "noindex", "ogImage", "ogType",
    "lang", "lastmod", "changefreq", "priority", "jsonLd"]);
const REDIRECT_KEYS = new Set(["from", "to", "status"]);

/** HTML の文字として安全にする（属性の値・本文のどちらにも使う）。 */
export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** JSON-LD を <script> の中に入れても壊れない形にする（< > & と行区切りを \u の形に）。 */
export function escapeJsonLd(json) {
    return json
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/** 入力の不備をまとめて例外にする（1 回の実行で、直すべき点を全部見せる）。 */
export class BuildError extends Error {
    constructor(problems) {
        super(`入力に問題があります:\n- ${problems.join("\n- ")}`);
        this.name = "BuildError";
        this.problems = problems;
    }
}

function unknownKeys(object, allowed, where, problems) {
    for (const key of Object.keys(object)) {
        if (!allowed.has(key)) problems.push(`${where}: 知らない項目 "${key}"（綴りを確かめてください）`);
    }
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

/** 絶対 URL（https://…）か、サイトの中のパス（/…）を、絶対 URL にする。それ以外は null。 */
function toAbsoluteUrl(value, origin) {
    if (typeof value !== "string") return null;
    if (value.startsWith("https://")) return value;
    if (value.startsWith("/") && !value.startsWith("//")) return `${origin}${value}`;
    return null;
}

/** サイト設定を検査し、既定値を入れた設定を返す（問題は problems に積む）。 */
export function checkSite(site, problems) {
    if (typeof site !== "object" || site === null || Array.isArray(site)) {
        problems.push("サイト設定はオブジェクトにしてください");
        return null;
    }
    unknownKeys(site, SITE_KEYS, "サイト設定", problems);
    for (const key of ["name", "lang", "locale"]) {
        if (!isNonEmptyString(site[key])) problems.push(`サイト設定: ${key} がありません`);
    }
    for (const key of ["origin", "devOrigin"]) {
        if (typeof site[key] !== "string" || !ORIGIN_PATTERN.test(site[key])) {
            problems.push(`サイト設定: ${key} は https://ホスト名 の形（末尾の / なし）にしてください`);
        }
    }
    const homeFile = site.homeFile ?? "index.html";
    if (!HTML_FILE_PATTERN.test(homeFile)) problems.push(`サイト設定: homeFile（${homeFile}）はファイル名（例: home.html）にしてください`);
    const urlStyle = site.urlStyle ?? "html";
    if (!["html", "directory"].includes(urlStyle)) problems.push('サイト設定: urlStyle は "html"（<path>.html）か "directory"（<path>/index.html）');
    const robotsDisallow = site.robotsDisallow ?? [];
    if (!Array.isArray(robotsDisallow) || robotsDisallow.some((p) => typeof p !== "string" || !p.startsWith("/") || /\s/.test(p))) {
        problems.push("サイト設定: robotsDisallow は / で始まるパスの配列にしてください");
    }
    const developRobots = site.developRobots ?? "disallow";
    if (!["disallow", "allow"].includes(developRobots)) problems.push('サイト設定: developRobots は "disallow" か "allow"');
    const maxDescription = site.maxDescription ?? DEFAULT_MAX_DESCRIPTION;
    if (!Number.isInteger(maxDescription) || maxDescription <= 0) problems.push("サイト設定: maxDescription は正の整数");
    if (site.spaFallback !== undefined && site.spaFallback !== false && (typeof site.spaFallback !== "object" || site.spaFallback === null)) {
        problems.push("サイト設定: spaFallback は {}（index.html を作る）か false");
    }
    if (site.notFoundPage !== undefined && site.notFoundPage !== false && (typeof site.notFoundPage !== "object" || site.notFoundPage === null)) {
        problems.push("サイト設定: notFoundPage は {}（404.html を作る）か false");
    }
    if (site.csp !== undefined && (typeof site.csp !== "object" || site.csp === null || Array.isArray(site.csp))) {
        problems.push("サイト設定: csp は、CSP の欄（scriptSrc など）を持つオブジェクト");
    }
    return {
        ...site,
        homeFile,
        urlStyle,
        robotsDisallow,
        developRobots,
        maxDescription,
        spaFallback: site.spaFallback ?? false,
        notFoundPage: site.notFoundPage ?? {},
    };
}

/** テンプレートの区切りが 1 つずつあるか。#app の中に SEO-BODY があるか。 */
export function checkTemplate(template, problems) {
    if (typeof template !== "string") {
        problems.push("テンプレート（index.html）が読めません");
        return;
    }
    for (const marker of [HEAD_START, HEAD_END, BODY_START, BODY_END]) {
        const count = template.split(marker).length - 1;
        if (count !== 1) problems.push(`テンプレートの区切り ${marker} が ${count} 個です（1 個にしてください）`);
    }
    const app = template.indexOf('<div id="app">');
    if (app < 0) problems.push('テンプレートに <div id="app"> がありません');
    else if (template.indexOf(BODY_START) < app) problems.push("SEO-BODY の区切りは #app の中に置いてください");
    if (!/<html\b[^>]*>/i.test(template)) problems.push("テンプレートに <html> がありません");
}

/** start と end の間を content に置き換える（前後に改行とインデントを 1 つずつ入れる）。区切りは検査済みであること。 */
function replaceBetween(text, start, end, content) {
    const s = text.indexOf(start);
    const e = text.indexOf(end);
    return text.slice(0, s + start.length) + "\n    " + content + "\n    " + text.slice(e);
}

/** <html> の lang を書き換える（無ければ足す）。 */
function setHtmlLang(text, lang) {
    return text.replace(/<html\b([^>]*)>/i, (match, attrs) => {
        if (/\slang="[^"]*"/.test(attrs)) return `<html${attrs.replace(/\slang="[^"]*"/, ` lang="${escapeHtml(lang)}"`)}>`;
        return `<html lang="${escapeHtml(lang)}"${attrs}>`;
    });
}

/** ページの head の行（title → description → robots → canonical → OGP → Twitter → JSON-LD の順）。 */
export function buildHeadLines(page, site, origin) {
    const url = `${origin}${page.path}`;
    const image = page.ogImage ? toAbsoluteUrl(page.ogImage, origin) : null;
    const lines = [
        `<title>${escapeHtml(page.title)}</title>`,
        `<meta name="description" content="${escapeHtml(page.description)}" />`,
    ];
    if (page.noindex) lines.push('<meta name="robots" content="noindex" />');
    lines.push(
        `<link rel="canonical" href="${escapeHtml(page.canonicalUrl ?? url)}" />`,
        `<meta property="og:site_name" content="${escapeHtml(site.name)}" />`,
        `<meta property="og:locale" content="${escapeHtml(site.locale)}" />`,
        `<meta property="og:type" content="${escapeHtml(page.ogType)}" />`,
        `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
        `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
        `<meta property="og:url" content="${escapeHtml(url)}" />`,
    );
    if (image) lines.push(`<meta property="og:image" content="${escapeHtml(image)}" />`);
    lines.push(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`);
    if (page.jsonLd !== undefined) {
        lines.push(`<script type="application/ld+json">${escapeJsonLd(JSON.stringify(page.jsonLd))}</script>`);
    }
    return lines;
}

/** 1 ページ分の HTML（テンプレートの head と SEO-BODY を書き換える）。bodyHtml が null なら本文はテンプレートのまま。 */
export function renderPage({ template, headLines, bodyHtml, lang }) {
    let html = replaceBetween(template, HEAD_START, HEAD_END, headLines.join("\n    "));
    if (bodyHtml !== null) html = replaceBetween(html, BODY_START, BODY_END, bodyHtml);
    return setHtmlLang(html, lang);
}

/** robots.txt。production は robotsDisallow と Sitemap。develop は developRobots（既定は全部 Disallow）。 */
export function renderRobots(site, env, origin) {
    if (env === "develop") {
        return site.developRobots === "allow" ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n";
    }
    return [
        "User-agent: *",
        ...site.robotsDisallow.map((path) => `Disallow: ${path}`),
        "",
        `Sitemap: ${origin}/sitemap.xml`,
        "",
    ].join("\n");
}

/** sitemap.xml（noindex のページは入れない）。 */
export function renderSitemap(pages, origin) {
    const urls = pages
        .filter((page) => !page.noindex)
        .map((page) => {
            const extra = [
                page.lastmod ? `<lastmod>${page.lastmod}</lastmod>` : "",
                page.changefreq ? `<changefreq>${page.changefreq}</changefreq>` : "",
                page.priority !== undefined ? `<priority>${page.priority}</priority>` : "",
            ].join("");
            return `  <url><loc>${escapeHtml(`${origin}${page.path}`)}</loc>${extra}</url>`;
        })
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** _redirects（旧 URL → 新 URL）。検査済みの行を受ける。 */
export function renderRedirects(lines) {
    return lines.map((r) => `${r.from} ${r.to} ${r.status}`).join("\n") + "\n";
}

/** パス → 出力ファイル名。"/" は homeFile。 */
export function outputFileFor(path, site) {
    if (path === "/") return site.homeFile;
    return site.urlStyle === "directory" ? `${path.slice(1)}/index.html` : `${path.slice(1)}.html`;
}

function normalizePage(raw, index, origin, site, problems) {
    const label = `ページ ${index + 1}${typeof raw?.path === "string" ? `（${raw.path}）` : ""}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        problems.push(`${label}: オブジェクトにしてください`);
        return null;
    }
    unknownKeys(raw, PAGE_KEYS, label, problems);
    let ok = true;
    if (typeof raw.path !== "string" || !PATH_PATTERN.test(raw.path)) {
        problems.push(`${label}: path は / で始まる小文字・数字・ハイフンのパス（例: /battle-terms、/learn/intro）にしてください`);
        ok = false;
    }
    for (const key of ["title", "description"]) {
        if (!isNonEmptyString(raw[key])) {
            problems.push(`${label}: ${key} がありません`);
            ok = false;
        }
    }
    if (typeof raw.description === "string" && raw.description.length > site.maxDescription) {
        problems.push(`${label}: description が ${site.maxDescription} 文字を超えています（${raw.description.length} 文字）`);
    }
    if (typeof raw.bodyHtml !== "string" || raw.bodyHtml === "") {
        problems.push(`${label}: bodyHtml（本文の HTML）がありません`);
        ok = false;
    } else if ([HEAD_START, HEAD_END, BODY_START, BODY_END].some((marker) => raw.bodyHtml.includes(marker))) {
        problems.push(`${label}: bodyHtml に SEO の区切りを入れないでください（再生成が壊れます）`);
    }
    if (raw.noindex !== undefined && typeof raw.noindex !== "boolean") problems.push(`${label}: noindex は true か false`);
    if (raw.lang !== undefined && !isNonEmptyString(raw.lang)) problems.push(`${label}: lang が不正です`);
    if (raw.lastmod !== undefined && !(typeof raw.lastmod === "string" && DATE_PATTERN.test(raw.lastmod)
        && new Date(`${raw.lastmod}T00:00:00Z`).toISOString().slice(0, 10) === raw.lastmod)) {
        problems.push(`${label}: lastmod は YYYY-MM-DD（実在する日付）にしてください`);
    }
    if (raw.changefreq !== undefined && !CHANGEFREQ.includes(raw.changefreq)) {
        problems.push(`${label}: changefreq は ${CHANGEFREQ.join(" / ")} のどれか`);
    }
    if (raw.priority !== undefined && !(typeof raw.priority === "number" && raw.priority >= 0 && raw.priority <= 1)) {
        problems.push(`${label}: priority は 0 から 1 の数`);
    }
    if (raw.ogImage !== undefined && toAbsoluteUrl(raw.ogImage, origin) === null) {
        problems.push(`${label}: ogImage は https://… か / で始まるパス`);
    }
    let canonicalUrl = null;
    if (raw.canonical !== undefined) {
        canonicalUrl = toAbsoluteUrl(raw.canonical, origin);
        if (canonicalUrl === null) problems.push(`${label}: canonical は https://… か / で始まるパス`);
        else if (!canonicalUrl.startsWith(`${origin}/`) && canonicalUrl !== origin) {
            problems.push(`${label}: canonical は同じホスト（${origin}）の URL にしてください`);
        }
    }
    if (!ok) return null;
    const url = `${origin}${raw.path}`;
    if (raw.noindex === true && canonicalUrl !== null && canonicalUrl !== url) {
        problems.push(`${label}: noindex のページに別の canonical（${canonicalUrl}）は指定できません（シグナルが矛盾します）`);
    }
    return { ...raw, ogType: raw.ogType ?? "website", canonicalUrl, noindex: raw.noindex === true };
}

/** redirects を検査して _redirects の行にする。 */
function normalizeRedirects(redirects, origin, pagePaths, problems) {
    const lines = [];
    const froms = new Set();
    redirects.forEach((r, index) => {
        const label = `redirects ${index + 1}`;
        if (typeof r !== "object" || r === null || Array.isArray(r)) return problems.push(`${label}: オブジェクトにしてください`);
        unknownKeys(r, REDIRECT_KEYS, label, problems);
        if (typeof r.from !== "string" || r.from === "/" || !PATH_PATTERN.test(r.from)) {
            return problems.push(`${label}: from は / 以外のパス（例: /old-page）`);
        }
        if (pagePaths.has(r.from)) problems.push(`${label}: from（${r.from}）は既存のページと同じです`);
        if (froms.has(r.from)) problems.push(`${label}: from（${r.from}）が重複しています`);
        froms.add(r.from);
        const isPath = typeof r.to === "string" && r.to.startsWith("/");
        if (!(isPath ? PATH_PATTERN.test(r.to) : toAbsoluteUrl(r.to, origin) !== null)) {
            return problems.push(`${label}: to は / で始まるパスか https://… の URL`);
        }
        const target = isPath ? `${origin}${r.to}` : r.to;
        if (target === `${origin}${r.from}`) problems.push(`${label}: from と to が同じです`);
        const status = r.status ?? 301;
        if (!REDIRECT_STATUSES.includes(status)) problems.push(`${label}: status は ${REDIRECT_STATUSES.join(" / ")}`);
        lines.push({ from: r.from, to: r.to, status });
    });
    return lines;
}

/**
 * 出力のファイル一式を作る（書き込みはしない）。戻り値は ファイル名 → 内容 の Map（作る順に並ぶ）。
 * @param {{ site: object, pages: object[], redirects?: object[], template: string, env: "production"|"develop" }} input
 * @throws {BuildError} 入力に問題があるとき（見つかった問題をすべてまとめて返す）
 */
export function buildPages({ site, pages, redirects, template, env }) {
    const problems = [];
    if (!ENVIRONMENTS.includes(env)) problems.push(`env は ${ENVIRONMENTS.join(" か ")} を指定してください`);
    const settings = checkSite(site, problems);
    checkTemplate(template, problems);
    if (!Array.isArray(pages) || pages.length === 0) problems.push("ページ一覧が空です");
    if (redirects !== undefined && !Array.isArray(redirects)) problems.push("redirects は配列にしてください");
    if (problems.length > 0 || settings === null) throw new BuildError(problems);

    const origin = env === "production" ? settings.origin : settings.devOrigin;
    const normalized = [];
    const seenPaths = new Set();
    pages.forEach((raw, index) => {
        const page = normalizePage(raw, index, origin, settings, problems);
        if (page === null) return;
        if (seenPaths.has(page.path)) problems.push(`ページ ${index + 1}（${page.path}）: path が重複しています`);
        seenPaths.add(page.path);
        normalized.push(page);
    });

    const noindexUrls = new Set(normalized.filter((page) => page.noindex).map((page) => `${origin}${page.path}`));
    for (const page of normalized) {
        if (page.canonicalUrl !== null && noindexUrls.has(page.canonicalUrl) && page.canonicalUrl !== `${origin}${page.path}`) {
            problems.push(`ページ（${page.path}）: canonical（${page.canonicalUrl}）が noindex のページを指しています（シグナルが矛盾します）`);
        }
    }

    const files = new Map();
    const outputNames = new Map();
    const reserve = (name, source) => {
        const key = name.toLowerCase();
        if (outputNames.has(key)) problems.push(`出力ファイル ${name} が重複しています（${outputNames.get(key)} と ${source}）`);
        outputNames.set(key, source);
    };

    for (const page of normalized) {
        const name = outputFileFor(page.path, settings);
        reserve(name, page.path);
        files.set(name, renderPage({
            template,
            headLines: buildHeadLines(page, settings, origin),
            bodyHtml: page.bodyHtml,
            lang: page.lang ?? settings.lang,
        }));
    }

    if (settings.spaFallback !== false) {
        reserve("index.html", "spaFallback");
        const title = settings.spaFallback.title ?? settings.name;
        files.set("index.html", renderPage({
            template,
            headLines: [`<title>${escapeHtml(title)}</title>`],
            bodyHtml: null,
            lang: settings.lang,
        }));
    }

    if (settings.notFoundPage !== false) {
        reserve("404.html", "notFoundPage");
        const title = settings.notFoundPage.title ?? `ページが見つかりません | ${settings.name}`;
        const bodyHtml = settings.notFoundPage.bodyHtml ?? null;
        if (bodyHtml !== null && !isNonEmptyString(bodyHtml)) problems.push("notFoundPage.bodyHtml は空でない文字列にしてください");
        files.set("404.html", renderPage({
            template,
            headLines: [`<title>${escapeHtml(title)}</title>`, '<meta name="robots" content="noindex" />'],
            bodyHtml,
            lang: settings.lang,
        }));
    }

    files.set("robots.txt", renderRobots(settings, env, origin));
    if (env === "production") files.set("sitemap.xml", renderSitemap(normalized, origin));

    if (settings.csp !== undefined) {
        try {
            files.set("_headers", renderHeaders({ ...settings.csp, noindex: env === "develop" }));
        } catch (error) {
            problems.push(`csp: ${error.message}`);
        }
    }

    if (redirects !== undefined && redirects.length > 0) {
        const lines = normalizeRedirects(redirects, origin, seenPaths, problems);
        if (lines.length > 0 && problems.length === 0) files.set("_redirects", renderRedirects(lines));
    }

    if (problems.length > 0) throw new BuildError(problems);
    return files;
}

/** Map の内容を --out のフォルダに書き出す（フォルダは必要に応じて作る）。書き出したファイル名を返す。 */
export function writeFiles(outDir, files) {
    for (const [name, content] of files) {
        const target = join(outDir, name);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
    }
    return [...files.keys()];
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i];
        const value = argv[i + 1];
        if (!key?.startsWith("--") || value === undefined) throw new Error(`引数が不正です: ${key ?? ""}`);
        args[key.slice(2)] = value;
    }
    for (const required of ["site", "pages", "template", "out", "env"]) {
        if (!args[required]) throw new Error(`--${required} を指定してください`);
    }
    return args;
}

function readJson(path, what) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new Error(`${what}（${path}）を読めません: ${error.message}`);
    }
}

/** CLI の本体（テストからも呼べるよう、書き出したファイル名を返す）。 */
export function main(argv) {
    const args = parseArgs(argv);
    const site = readJson(resolve(args.site), "サイト設定");
    const pagesInput = readJson(resolve(args.pages), "ページ一覧");
    const pages = Array.isArray(pagesInput) ? pagesInput : pagesInput.pages;
    const redirects = Array.isArray(pagesInput) ? undefined : pagesInput.redirects;
    // テンプレートは書き出す前に読み切る（--out がテンプレートのフォルダの中でも壊れない）
    const template = readFileSync(resolve(args.template), "utf8");
    const files = buildPages({ site, pages, redirects, template, env: args.env });
    return writeFiles(resolve(args.out), files);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    try {
        const written = main(process.argv.slice(2));
        console.log(`書き出しました（${written.length} 件）: ${written.join(", ")}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
