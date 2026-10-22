// Cloudflare の _headers（CSP・確認用の noindex・キャッシュ）を書き出す。サイトに依存しない（ホストはサイトが渡す）。
//   import { renderHeaders } from "../csp/render-headers.mjs";
//   renderHeaders({ scriptSrc: ["https://challenges.cloudflare.com"], connectSrc: [], noindex: false })
// 方針（docs/usage.md・CLAUDE.md）: script-src に 'unsafe-inline' と 'unsafe-eval' は使わない。
// style-src の 'unsafe-inline' は MudBlazor のため固定で入る。wasm-unsafe-eval は固定で入る。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "_headers.template");

/** 外部ホストの欄（許可する値の形）。script・style・font・img・frame は https のみ、connect は wss も可。 */
const HOST_KEYS = ["scriptSrc", "styleSrc", "fontSrc", "imgSrc", "connectSrc", "frameSrc"];
const HASH_KEYS = new Set(["scriptSrc", "styleSrc"]);
const HTTPS_HOST = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const CONNECT_HOST = /^(https|wss):\/\/[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const SHA256_HASH = /^'sha256-[A-Za-z0-9+/]+=*'$/;
const PLACEHOLDER_LINE = /^\{\{[A-Z_]+\}\}$/;
const OPTION_KEYS = new Set([...HOST_KEYS, "noindex", "cacheRules"]);

const template = readFileSync(TEMPLATE_PATH, "utf8").replace(/\n+$/, "");

/** 外部ホストの一覧を検査して、重複を除いて返す。 */
function checkHosts(name, list = []) {
    if (!Array.isArray(list)) throw new Error(`${name} は配列にしてください`);
    const out = [];
    for (const token of list) {
        if (typeof token !== "string" || token === "") throw new Error(`${name}: 空の値は使えません`);
        if (token === "'unsafe-inline'" || token === "'unsafe-eval'") {
            throw new Error(`${name}: ${token} は使いません（インラインの script は外部ファイルにする）`);
        }
        const ok = (HASH_KEYS.has(name) && SHA256_HASH.test(token))
            || (name === "connectSrc" ? CONNECT_HOST.test(token) : HTTPS_HOST.test(token));
        if (!ok) throw new Error(`${name}: 不正な値 "${token}"（https://ホスト名 の形。* や https: だけ、; や空白は使えません）`);
        if (!out.includes(token)) out.push(token);
    }
    return out;
}

/** 1 つの欄を、CSP の値（先頭に空白）にする。 */
function suffix(list) {
    return list.map((token) => ` ${token}`).join("");
}

/** キャッシュ規則（path と Cache-Control の値）を _headers の行にする。 */
function renderCacheRules(rules = []) {
    if (!Array.isArray(rules)) throw new Error("cacheRules は配列にしてください");
    return rules.map((rule) => {
        if (typeof rule?.path !== "string" || !rule.path.startsWith("/") || /\s/.test(rule.path)) {
            throw new Error(`cacheRules: 不正な path "${rule?.path}"`);
        }
        if (typeof rule.value !== "string" || rule.value === "" || /[\r\n]/.test(rule.value)) {
            throw new Error(`cacheRules: ${rule.path} の Cache-Control の値が不正です`);
        }
        return `${rule.path}\n  Cache-Control: ${rule.value}`;
    }).join("\n");
}

/**
 * _headers の本文を作る（末尾の改行つき）。
 * @param {object} options scriptSrc・styleSrc・fontSrc・imgSrc・connectSrc・frameSrc（ホストの配列）、
 *   noindex（true で X-Robots-Tag: noindex を全ページに付ける。確認用に使う）、cacheRules（[{ path, value }]）
 */
export function renderHeaders(options = {}) {
    for (const key of Object.keys(options)) {
        if (!OPTION_KEYS.has(key)) throw new Error(`renderHeaders: 知らない項目 "${key}"`);
    }
    const hosts = Object.fromEntries(HOST_KEYS.map((key) => [key, checkHosts(key, options[key])]));
    const values = {
        scriptSrc: suffix(hosts.scriptSrc),
        styleSrc: suffix(hosts.styleSrc),
        fontSrc: suffix(hosts.fontSrc),
        imgSrc: suffix(hosts.imgSrc),
        connectSrc: suffix(hosts.connectSrc),
        frameSrc: hosts.frameSrc.length > 0 ? `; frame-src${suffix(hosts.frameSrc)}` : "",
        X_ROBOTS_TAG: options.noindex === true ? "  X-Robots-Tag: noindex" : "",
        CACHE_RULES: renderCacheRules(options.cacheRules),
    };
    const lines = [];
    for (const line of template.split("\n")) {
        const placeholder = PLACEHOLDER_LINE.exec(line.trim());
        if (placeholder) {
            const value = values[placeholder[0].slice(2, -2)];
            if (value === undefined) throw new Error(`テンプレートの ${placeholder[0]} が未知です`);
            if (value !== "") lines.push(value);
            continue;
        }
        lines.push(line.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            if (!(key in values)) throw new Error(`テンプレートの ${match} が未知です`);
            return values[key];
        }));
    }
    const text = `${lines.join("\n")}\n`;
    if (text.includes("{{")) throw new Error("_headers に未置換のプレースホルダが残っています");
    return text;
}
