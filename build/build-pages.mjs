// 静的な公開ファイル一式を作る（サイトに依存しない）。入力はページ一覧 JSON と、サイト設定 JSON。本文の HTML は呼び出し側が作る。
//   node build/build-pages.mjs --site site.json --pages pages.json --template <dir>/index.html --out <dir> --env production|develop
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
// テンプレートは dotnet publish などの出力（出力先とは別のフォルダに置く）。SEO-HEAD と SEO-BODY の区切りの間を書き換える。
// 区切りの外（読み込み表示の #boot-indicator・Blazor の読み込み）は触らない。ツールは決定論的（同じ入力で同じバイト列）。
// 出力先の古いファイルは消さない（urlStyle を変えたときなど）。出力先を空にしてから実行する運用にする。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderHeaders } from "../csp/render-headers.mjs";

export const HEAD_START = "<!-- SEO-HEAD:START -->";
export const HEAD_END = "<!-- SEO-HEAD:END -->";
export const BODY_START = "<!-- SEO-BODY:START -->";
export const BODY_END = "<!-- SEO-BODY:END -->";

export const ENVIRONMENTS = ["production", "develop"];
/** Cloudflare の _redirects の上限（静的な規則。このツールは動的な規則を作らない）。 */
export const MAX_STATIC_REDIRECTS = 2000;
export const MAX_REDIRECT_LINE = 1000;
const DEFAULT_MAX_DESCRIPTION = 160;
const REDIRECT_STATUSES = [301, 302, 307, 308];
const CHANGEFREQ = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
/** パス: "/" か、小文字・数字・ハイフンの区切り（/ で繋ぐ）。末尾の / は付けない。 */
const PATH_PATTERN = /^\/(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)?$/;
const ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const HTML_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.html$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** BCP 47 の言語タグ（ja・en-US など）と、og:locale（ja_JP など）の形。 */
const LANG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,8})*$/;
/** 空白と制御文字（_redirects の 1 行を壊す文字）。 */
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/;
/** テンプレートの #app の開始タグ（class などの属性があっても受ける）。 */
const APP_TAG = /<div\b[^>]*\sid="app"[^>]*>/;
/** bodyRootClass に使える class 名（英字で始まり、英数字・ハイフン）。 */
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

const SITE_KEYS = new Set(["name", "origin", "devOrigin", "lang", "locale", "homeFile", "urlStyle", "spaFallback",
    "notFoundPage", "robotsDisallow", "developRobots", "maxDescription", "bodyRootClass", "csp"]);
const SPA_FALLBACK_KEYS = new Set(["title"]);
const NOT_FOUND_KEYS = new Set(["title", "bodyHtml"]);
const PAGE_KEYS = new Set(["path", "title", "description", "bodyHtml", "canonical", "noindex", "ogImage", "ogType",
    "lang", "lastmod", "changefreq", "priority", "jsonLd"]);
const REDIRECT_KEYS = new Set(["from", "to", "status"]);
const PAGES_FILE_KEYS = new Set(["pages", "redirects"]);
const SEO_MARKERS = [HEAD_START, HEAD_END, BODY_START, BODY_END];

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

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

/** 本文（bodyHtml）に SEO の区切りが入っていないか。 */
function hasSeoMarker(text) {
    return SEO_MARKERS.some((marker) => text.includes(marker));
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
    if (!isPlainObject(site)) {
        problems.push("サイト設定はオブジェクトにしてください");
        return null;
    }
    unknownKeys(site, SITE_KEYS, "サイト設定", problems);
    for (const key of ["name", "lang", "locale"]) {
        if (!isNonEmptyString(site[key])) problems.push(`サイト設定: ${key} がありません`);
    }
    if (site.lang !== undefined && !LANG_PATTERN.test(site.lang)) problems.push(`サイト設定: lang（${site.lang}）は BCP 47 の言語タグ（ja・en-US など）にしてください`);
    if (site.locale !== undefined && !LOCALE_PATTERN.test(site.locale)) problems.push(`サイト設定: locale（${site.locale}）は ja_JP のような形にしてください`);
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
    if (!Array.isArray(robotsDisallow) || robotsDisallow.some((p) => typeof p !== "string" || !p.startsWith("/") || WHITESPACE_OR_CONTROL.test(p))) {
        problems.push("サイト設定: robotsDisallow は / で始まるパスの配列にしてください");
    }
    const developRobots = site.developRobots ?? "disallow";
    if (!["disallow", "allow"].includes(developRobots)) problems.push('サイト設定: developRobots は "disallow" か "allow"');
    const maxDescription = site.maxDescription ?? DEFAULT_MAX_DESCRIPTION;
    if (!Number.isInteger(maxDescription) || maxDescription <= 0) problems.push("サイト設定: maxDescription は正の整数");
    if (site.bodyRootClass !== undefined && (typeof site.bodyRootClass !== "string" || !CLASS_NAME.test(site.bodyRootClass))) {
        problems.push("サイト設定: bodyRootClass は class 名（例: entry-static）にしてください");
    }
    if (site.spaFallback !== undefined && site.spaFallback !== false) {
        if (!isPlainObject(site.spaFallback)) problems.push("サイト設定: spaFallback は {}（index.html を作る）か false");
        else {
            unknownKeys(site.spaFallback, SPA_FALLBACK_KEYS, "サイト設定 spaFallback", problems);
            if (site.spaFallback.title !== undefined && !isNonEmptyString(site.spaFallback.title)) problems.push("サイト設定 spaFallback: title は空でない文字列");
        }
    }
    if (site.notFoundPage !== undefined && site.notFoundPage !== false) {
        if (!isPlainObject(site.notFoundPage)) problems.push("サイト設定: notFoundPage は {}（404.html を作る）か false");
        else {
            unknownKeys(site.notFoundPage, NOT_FOUND_KEYS, "サイト設定 notFoundPage", problems);
            if (site.notFoundPage.title !== undefined && !isNonEmptyString(site.notFoundPage.title)) problems.push("サイト設定 notFoundPage: title は空でない文字列");
            const body = site.notFoundPage.bodyHtml;
            if (body !== undefined && (!isNonEmptyString(body) || hasSeoMarker(body))) {
                problems.push("サイト設定 notFoundPage: bodyHtml は空でない文字列で、SEO の区切りを含めない");
            }
        }
    }
    if (site.csp !== undefined && !isPlainObject(site.csp)) problems.push("サイト設定: csp は、CSP の欄（scriptSrc など）を持つオブジェクト");
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

/**
 * テンプレートを検査する。区切りは 1 つずつ。SEO-BODY は <div id="app"> の直下（#app を閉じる </div> より前）にあること。
 * SEO-BODY の中は空（白だけ）であること。生成済みの index.html（本文が入ったもの）を渡すと、404 や SPA のフォールバックに本文が残るため。
 */
export function checkTemplate(template, problems) {
    if (typeof template !== "string") {
        problems.push("テンプレート（index.html）が読めません");
        return;
    }
    let markersOk = true;
    for (const marker of SEO_MARKERS) {
        const count = template.split(marker).length - 1;
        if (count !== 1) {
            problems.push(`テンプレートの区切り ${marker} が ${count} 個です（1 個にしてください）`);
            markersOk = false;
        }
    }
    const appMatch = APP_TAG.exec(template);
    if (!appMatch) problems.push('テンプレートに <div id="app"> がありません');
    if (markersOk && appMatch) {
        const appEnd = appMatch.index + appMatch[0].length;
        const bodyStart = template.indexOf(BODY_START);
        const bodyEnd = template.indexOf(BODY_END);
        const appClose = template.indexOf("</div>", appEnd);
        if (bodyStart < appEnd || appClose < 0 || bodyEnd > appClose) {
            problems.push('SEO-BODY の区切りは <div id="app"> の直下（#app を閉じる </div> より前）に置いてください');
        }
        const body = template.slice(bodyStart + BODY_START.length, bodyEnd);
        if (body.trim() !== "") {
            problems.push("テンプレートの SEO-BODY の中が空ではありません。生成済みの index.html の可能性があります（dotnet publish の出力を使ってください）");
        }
    }
    if (!/<html\b[^>]*>/i.test(template)) problems.push("テンプレートに <html> がありません");
}

/** start と end の間を content に置き換える（前後に改行とインデントを 1 つずつ入れる）。区切りは検査済みであること。 */
function replaceBetween(text, start, end, content) {
    const s = text.indexOf(start);
    const e = text.indexOf(end);
    return text.slice(0, s + start.length) + "\n    " + content + "\n    " + text.slice(e);
}

/** <html> の lang を書き換える（無ければ足す）。lang は検査済み（BCP 47）。置換は関数で行い、$ の解釈を避ける。 */
function setHtmlLang(text, lang) {
    return text.replace(/<html\b([^>]*)>/i, (match, attrs) => {
        if (/\slang="[^"]*"/.test(attrs)) return `<html${attrs.replace(/\slang="[^"]*"/, () => ` lang="${lang}"`)}>`;
        return `<html lang="${lang}"${attrs}>`;
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
    if (!isPlainObject(raw)) {
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
    } else {
        if (hasSeoMarker(raw.bodyHtml)) problems.push(`${label}: bodyHtml に SEO の区切りを入れないでください（再生成が壊れます）`);
        if (site.bodyRootClass !== undefined && !rootHasClass(raw.bodyHtml, site.bodyRootClass)) {
            problems.push(`${label}: bodyHtml の先頭の要素に class="${site.bodyRootClass}" が必要です（サイトの約束。docs/usage.md）`);
        }
    }
    if (raw.noindex !== undefined && typeof raw.noindex !== "boolean") problems.push(`${label}: noindex は true か false`);
    if (raw.lang !== undefined && !(typeof raw.lang === "string" && LANG_PATTERN.test(raw.lang))) {
        problems.push(`${label}: lang は BCP 47 の言語タグ（ja・en-US など）にしてください`);
    }
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

/**
 * 本文の先頭の要素に、サイトの約束の class があるか（例: <main class="entry-static">）。
 * 読み込み表示などの JavaScript は、この class に依存する（docs/usage.md）。
 */
function rootHasClass(bodyHtml, className) {
    const root = /^\s*<[A-Za-z][^>]*>/.exec(bodyHtml);
    if (!root) return false;
    const classes = /\sclass="([^"]*)"/.exec(root[0]);
    return classes !== null && classes[1].split(/\s+/).includes(className);
}

/** 1 つの redirect の to を検査し、_redirects に書く値（URL は正規化したもの）を返す。不正なら null。 */
function checkRedirectTarget(to, origin, problems, label) {
    if (typeof to !== "string" || to === "") {
        problems.push(`${label}: to は / で始まるパスか https:// の URL`);
        return null;
    }
    if (WHITESPACE_OR_CONTROL.test(to)) {
        problems.push(`${label}: to に空白・改行・制御文字は使えません`);
        return null;
    }
    if (to.startsWith("/")) {
        if (!PATH_PATTERN.test(to)) {
            problems.push(`${label}: to（${to}）は小文字・数字・ハイフンのパスにしてください`);
            return null;
        }
        return to;
    }
    let url;
    try {
        url = new URL(to);
    } catch {
        problems.push(`${label}: to（${to}）は URL として読めません`);
        return null;
    }
    if (url.protocol !== "https:") {
        problems.push(`${label}: to は https:// の URL にしてください`);
        return null;
    }
    return url.href;
}

/** redirects を検査して _redirects の行にする。from・to は空白・改行を含めない（1 行の形を壊さないため）。 */
function normalizeRedirects(redirects, origin, pagePaths, problems) {
    const lines = [];
    const froms = new Set();
    redirects.forEach((r, index) => {
        const label = `redirects ${index + 1}`;
        if (!isPlainObject(r)) return problems.push(`${label}: オブジェクトにしてください`);
        unknownKeys(r, REDIRECT_KEYS, label, problems);
        if (typeof r.from !== "string" || r.from === "/" || !PATH_PATTERN.test(r.from)) {
            return problems.push(`${label}: from は / 以外のパス（例: /old-page）`);
        }
        if (pagePaths.has(r.from)) problems.push(`${label}: from（${r.from}）は既存のページと同じです`);
        if (froms.has(r.from)) problems.push(`${label}: from（${r.from}）が重複しています`);
        froms.add(r.from);
        const target = checkRedirectTarget(r.to, origin, problems, label);
        if (target === null) return;
        if (target === r.from || target === `${origin}${r.from}`) problems.push(`${label}: from と to が同じです`);
        const status = r.status ?? 301;
        if (!REDIRECT_STATUSES.includes(status)) problems.push(`${label}: status は ${REDIRECT_STATUSES.join(" / ")}`);
        lines.push({ from: r.from, to: target, status });
    });
    if (lines.length > MAX_STATIC_REDIRECTS) {
        problems.push(`redirects は ${MAX_STATIC_REDIRECTS} 件までです（${lines.length} 件）`);
    }
    for (const line of lines) {
        const text = `${line.from} ${line.to} ${line.status}`;
        if (text.length > MAX_REDIRECT_LINE) problems.push(`redirects（${line.from}）: 1 行が ${MAX_REDIRECT_LINE} 文字を超えています`);
    }
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
        files.set("404.html", renderPage({
            template,
            headLines: [`<title>${escapeHtml(title)}</title>`, '<meta name="robots" content="noindex" />'],
            bodyHtml: settings.notFoundPage.bodyHtml ?? null,
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

/**
 * テンプレートが出力先の書き出し先と同じファイルなら例外にする（テンプレートを出力で上書きすると、2 回目の実行が壊れるため）。
 */
export function assertTemplateNotOverwritten(templatePath, outDir, files) {
    const template = resolve(templatePath).toLowerCase();
    for (const name of files.keys()) {
        if (resolve(outDir, name).toLowerCase() === template) {
            throw new Error(`テンプレート（${templatePath}）が出力先の ${name} と同じです。テンプレートは出力先の外に置いてください（dotnet publish の出力を別フォルダへ）`);
        }
    }
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

/** ページ一覧のファイルを、pages と redirects に分ける（配列、または { pages, redirects }）。 */
export function readPagesInput(input) {
    if (Array.isArray(input)) return { pages: input, redirects: undefined };
    if (!isPlainObject(input)) throw new BuildError(["ページ一覧は配列か、{ pages, redirects } のオブジェクトにしてください"]);
    const problems = [];
    unknownKeys(input, PAGES_FILE_KEYS, "ページ一覧", problems);
    if (problems.length > 0) throw new BuildError(problems);
    return { pages: input.pages, redirects: input.redirects };
}

/** CLI の本体（テストからも呼べるよう、書き出したファイル名を返す）。 */
export function main(argv) {
    const args = parseArgs(argv);
    const site = readJson(resolve(args.site), "サイト設定");
    const { pages, redirects } = readPagesInput(readJson(resolve(args.pages), "ページ一覧"));
    // テンプレートは書き出す前に読み切り、出力先で上書きされないことを確かめてから書く
    const templatePath = resolve(args.template);
    const template = readFileSync(templatePath, "utf8");
    const outDir = resolve(args.out);
    const files = buildPages({ site, pages, redirects, template, env: args.env });
    assertTemplateNotOverwritten(templatePath, outDir, files);
    return writeFiles(outDir, files);
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
