// 報告・テーマ・レイアウトの JS（src/FaraBlazorComponent.Razor/wwwroot/js/）の確認。ブラウザは使わず、最小のフェイクの DOM で動かす。
//   node --test tests/js/kit-js.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "FaraBlazorComponent.Razor", "wwwroot", "js");
const load = (name) => readFileSync(join(JS_DIR, name), "utf8");

/** クラス名の集合（classList の最小の形）。 */
function classList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach((n) => set.add(n)),
        remove: (...names) => names.forEach((n) => set.delete(n)),
        contains: (n) => set.has(n),
        toggle(n, force) {
            const on = force === undefined ? !set.has(n) : !!force;
            if (on) set.add(n); else set.delete(n);
            return on;
        },
        toString: () => [...set].join(" "),
    };
}

/** 最小の要素。id・属性・子・dataset・フォーカスを持つ。セレクタは id と .class と tag だけ。 */
let currentDoc = null;

function element(tag, props = {}) {
    const el = {
        tagName: tag.toUpperCase(),
        id: props.id || "",
        dataset: props.dataset || {},
        attributes: {},
        children: [],
        classList: null,
        style: { setProperty() {} },
        setAttribute(n, v) { this.attributes[n] = String(v); },
        getAttribute(n) { return n in this.attributes ? this.attributes[n] : null; },
        removeAttribute(n) { delete this.attributes[n]; },
        appendChild(c) { this.children.push(c); return c; },
        contains(other) { return other === this || this.children.some((c) => c.contains(other)); },
        focus() { currentDoc.activeElement = this; },
        blur() { if (currentDoc.activeElement === this) currentDoc.activeElement = null; },
        querySelector(sel) { return findAll(this, sel)[0] || null; },
        querySelectorAll(sel) { return findAll(this, sel); },
        closest() { return null; },
    };
    el.classList = classList(el);
    return el;
}

function matches(el, sel) {
    if (sel.startsWith("#")) return el.id === sel.slice(1);
    if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
    const m = /^(\w+)?(?:\[(\w[\w-]*)\*?=?"?([^"\]]*)"?\])?$/.exec(sel);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2]) {
        const value = m[3] || "";
        if (m[2] === "src") return String(el.attributes.src || "").includes(value);
        return el.attributes[m[2]] === value;
    }
    return true;
}

function findAll(root, sel) {
    const out = [];
    const walk = (node) => {
        for (const c of node.children) {
            if (matches(c, sel)) out.push(c);
            walk(c);
        }
    };
    walk(root);
    return out;
}

/** スクリプトを、フェイクの window・document・localStorage の中で動かす。 */
function sandbox(extra = {}) {
    const docEl = element("html");
    const doc = {
        documentElement: docEl,
        head: element("head"),
        body: element("body"),
        activeElement: null,
        currentScript: null,
        getElementById(id) { return findAll(this.documentElement, `#${id}`)[0] || findAll(this.body, `#${id}`)[0] || null; },
        querySelector(sel) { return findAll(this.documentElement, sel)[0] || findAll(this.body, sel)[0] || null; },
        querySelectorAll(sel) { return [...findAll(this.documentElement, sel), ...findAll(this.body, sel)]; },
        createElement(tag) { return element(tag); },
        // 文書の keydown など（テストから発火させる）
        addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
        removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn); },
    };
    const docListeners = {};
    currentDoc = doc;
    const store = new Map(Object.entries(extra.storage || {}));
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        _store: store,
    };
    const warnings = [];
    const listeners = {};
    const win = {
        document: doc,
        localStorage,
        matchMedia: extra.matchMedia || (() => ({ matches: false, addEventListener() {} })),
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        dispatchEvent(ev) { (listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        setTimeout,
        clearTimeout,
        ...extra.window,
    };
    doc.defaultView = win;
    const ctx = vm.createContext({
        window: win,
        document: doc,
        localStorage,
        console: { warn: (m) => warnings.push(String(m)), log() {}, error() {} },
        Event: class { constructor(type) { this.type = type; } },
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        MutationObserver: class { observe() {} disconnect() {} },
        ...extra.globals,
    });
    win.window = win;
    return { ctx, win, doc, localStorage, warnings, docListeners };
}

// ---- theme-init.js ----

function runThemeInit({ storage = {}, storageKey = "fara-blazor-component.settings", sidebarKey = "fara-blazor-component.sidebar-hidden" } = {}) {
    const s = sandbox({ storage });
    const script = element("script", { dataset: { storageKey, sidebarKey } });
    script.attributes.src = "_content/FaraBlazorComponent.Razor/js/theme-init.js";
    s.doc.currentScript = script;
    vm.runInContext(load("theme-init.js"), s.ctx);
    return s;
}

test("theme-init: 保存が無いときは light、サイドバーは開いたまま", () => {
    const s = runThemeInit();
    assert.equal(s.doc.documentElement.getAttribute("data-bs-theme"), "light");
    assert.equal(s.doc.documentElement.classList.contains("fbc-sidebar-hidden"), false);
});

test("theme-init: 保存された Theme（大文字小文字を問わない）が dark なら dark", () => {
    const s = runThemeInit({ storage: { "fara-blazor-component.settings": '{"DataSetKey":"gen9","theme":"dark"}' } });
    assert.equal(s.doc.documentElement.getAttribute("data-bs-theme"), "dark");
});

test("theme-init: 壊れた JSON は light（例外で止まらない）", () => {
    const s = runThemeInit({ storage: { "fara-blazor-component.settings": "{broken" } });
    assert.equal(s.doc.documentElement.getAttribute("data-bs-theme"), "light");
});

test("theme-init: サイドバーを隠す保存（1）で fbc-sidebar-hidden を付ける", () => {
    const s = runThemeInit({ storage: { "fara-blazor-component.sidebar-hidden": "1" } });
    assert.equal(s.doc.documentElement.classList.contains("fbc-sidebar-hidden"), true);
});

test("theme-init: キーは script の data 属性から読む（別のキーの保存を見ない）", () => {
    const s = runThemeInit({
        storage: { "fara-blazor-component.settings": '{"Theme":"dark"}', "old.settings": '{"Theme":"light"}' },
        storageKey: "fara-blazor-component.settings",
    });
    assert.equal(s.doc.documentElement.getAttribute("data-bs-theme"), "dark");
    const other = runThemeInit({ storage: { "old.settings": '{"Theme":"dark"}' }, storageKey: "old.settings" });
    assert.equal(other.doc.documentElement.getAttribute("data-bs-theme"), "dark");
});

// ---- fara-blazor-component.js ----

function runKit(extra = {}) {
    const s = sandbox(extra);
    vm.runInContext(load("fara-blazor-component.js"), s.ctx);
    return s;
}

test("fara-blazor-component: sidebarChanged は html のクラスと保存（1/0）を変える", () => {
    const s = runKit();
    const api = s.win.faraBlazorComponent;
    api.sidebarChanged(true, "k.sidebar");
    assert.equal(s.doc.documentElement.classList.contains("fbc-sidebar-hidden"), true);
    assert.equal(s.localStorage.getItem("k.sidebar"), "1");
    api.sidebarChanged(false, "k.sidebar");
    assert.equal(s.doc.documentElement.classList.contains("fbc-sidebar-hidden"), false);
    assert.equal(s.localStorage.getItem("k.sidebar"), "0");
});

test("fara-blazor-component: searchSheet を閉じるとき、中にフォーカスがあれば検索ボタンへ戻す", () => {
    const s = runKit();
    const sheet = element("div", { id: "fbc-search-sheet" });
    const input = element("input");
    sheet.appendChild(input);
    const button = element("button");
    button.classList.add("fbc-search-toggle");
    s.doc.body.appendChild(sheet);
    s.doc.body.appendChild(button);
    s.doc.activeElement = input;
    const api = s.win.faraBlazorComponent;

    api.searchSheet(true, true);
    assert.equal(s.doc.documentElement.classList.contains("fbc-search-open"), true);
    assert.equal(s.doc.activeElement, input, "開くとき、欄の入力にフォーカス");

    s.doc.activeElement = input;
    api.searchSheet(false, false);
    assert.equal(s.doc.documentElement.classList.contains("fbc-search-open"), false);
    assert.equal(s.doc.activeElement, button, "閉じるとき、欄の中にあったフォーカスは検索ボタンへ");
});

test("fara-blazor-component: focusMain は main（#fbc-main）にフォーカスする", () => {
    const s = runKit();
    const main = element("main", { id: "fbc-main" });
    s.doc.body.appendChild(main);
    s.win.faraBlazorComponent.focusMain();
    assert.equal(s.doc.activeElement, main);
});

test("fara-blazor-component: watchMobile は、今の幅（matches）を返す", () => {
    const s = runKit({ matchMedia: () => ({ matches: true, addEventListener() {} }) });
    const ref = { invokeMethodAsync() {} };
    assert.equal(s.win.faraBlazorComponent.watchMobile(ref), true);
});

test("fara-blazor-component: 送れなかった OnMobileChanged の Promise は、未処理の拒否のまま残らない（回線が切れた後）", async () => {
    let fire = null;
    const s = runKit({ matchMedia: () => ({ matches: false, addEventListener(_t, fn) { fire = fn; } }) });
    const ref = { invokeMethodAsync() { return Promise.reject(new Error("回線が切れました")); } };
    s.win.faraBlazorComponent.watchMobile(ref);
    fire({ matches: true });
    // 未処理の拒否があれば、ここで node:test が失敗にする
    await new Promise((resolve) => setTimeout(resolve, 20));
});

test("fara-blazor-component: watchMobile は Esc で ref.OnEscape を呼ぶ（Esc 以外のキーでは呼ばない）", () => {
    const calls = [];
    const s = runKit({ matchMedia: () => ({ matches: true, addEventListener() {} }) });
    s.win.faraBlazorComponent.watchMobile({ invokeMethodAsync: (name) => { calls.push(name); return Promise.resolve(); } }, "k1");
    // 「同じ key」以外の呼び方（key を渡さない古い呼び出し）は、Esc を監視しない（OnEscape を受けられない参照へ送らない）
    const legacy = runKit({ matchMedia: () => ({ matches: false, addEventListener() {} }) });
    legacy.win.faraBlazorComponent.watchMobile({ invokeMethodAsync: () => assert.fail("Esc では送らない") });
    assert.equal(legacy.docListeners.keydown, undefined);
    s.docListeners.keydown.forEach((fn) => fn({ key: "Enter" }));
    assert.deepEqual(calls, []);
    s.docListeners.keydown.forEach((fn) => fn({ key: "Escape" }));
    assert.deepEqual(calls, ["OnEscape"]);
});

test("fara-blazor-component: unwatchMobile は、登録した matchMedia の変化と Esc の監視を外す（画面を移るたびに増えない）", () => {
    const removed = [];
    let mediaFn = null;
    const mq = {
        matches: false,
        addEventListener(_t, fn) { mediaFn = fn; },
        removeEventListener(_t, fn) { removed.push(fn); },
    };
    const s = runKit({ matchMedia: () => mq });
    const calls = [];
    s.win.faraBlazorComponent.watchMobile({ invokeMethodAsync: (name) => { calls.push(name); return Promise.resolve(); } }, "k2");
    assert.equal(s.docListeners.keydown.length, 1);
    s.win.faraBlazorComponent.unwatchMobile("k2");
    assert.deepEqual(removed, [mediaFn], "matchMedia の listener を外す");
    assert.equal(s.docListeners.keydown.length, 0, "keydown を外す");
    s.docListeners.keydown?.forEach((fn) => fn({ key: "Escape" }));
    assert.deepEqual(calls, [], "外した後は、Esc でも送らない");
});

test("fara-blazor-component: 同じ key で watchMobile を二重に呼んでも、監視は一つだけ残る", () => {
    const s = runKit({ matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
    const ref = { invokeMethodAsync() { return Promise.resolve(); } };
    s.win.faraBlazorComponent.watchMobile(ref, "same");
    s.win.faraBlazorComponent.watchMobile(ref, "same");
    assert.equal(s.docListeners.keydown.length, 1);
});

test("fara-blazor-component: OnEscape の送信が失敗しても、未処理の拒否は残らない", async () => {
    const s = runKit({ matchMedia: () => ({ matches: false, addEventListener() {} }) });
    const ref = { invokeMethodAsync() { return Promise.reject(new Error("回線が切れました")); } };
    s.win.faraBlazorComponent.watchMobile(ref, "k3");
    s.docListeners.keydown.forEach((fn) => fn({ key: "Escape" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
});

test("fara-blazor-component: watchWidth は、指定の幅（px）より狭いかを返し、変わったら OnCollapsedChanged を送る", () => {
    const queries = [];
    let fire = null;
    const s = runKit({ matchMedia: (q) => { queries.push(q); return { matches: true, addEventListener(_t, fn) { fire = fn; } }; } });
    const calls = [];
    const ref = { invokeMethodAsync: (name, v) => { calls.push([name, v]); return Promise.resolve(); } };
    assert.equal(s.win.faraBlazorComponent.watchWidth(ref, "w1", 900), true);
    assert.deepEqual(queries, ["(max-width: 899.98px)"]);
    fire({ matches: false });
    assert.deepEqual(calls, [["OnCollapsedChanged", false]]);
});

test("fara-blazor-component: unwatchWidth は監視を外す。同じ key の二重の登録は、前のを外す", () => {
    const removed = [];
    const s = runKit({ matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener(_t, fn) { removed.push(fn); } }) });
    const ref = { invokeMethodAsync() { return Promise.resolve(); } };
    s.win.faraBlazorComponent.watchWidth(ref, "w2", 768);
    s.win.faraBlazorComponent.watchWidth(ref, "w2", 768);
    assert.equal(removed.length, 1, "二重の登録は、前のを外す");
    s.win.faraBlazorComponent.unwatchWidth("w2");
    assert.equal(removed.length, 2);
    s.win.faraBlazorComponent.unwatchWidth("w2");
    assert.equal(removed.length, 2, "外した後の unwatchWidth は何もしない");
});

test("fara-blazor-component: focusById は id の要素にフォーカスする（無ければ何もしない）", () => {
    const s = runKit();
    const btn = element("button", { id: "target" });
    s.doc.body.appendChild(btn);
    s.win.faraBlazorComponent.focusById("none");
    assert.equal(s.doc.activeElement, null);
    s.win.faraBlazorComponent.focusById("target");
    assert.equal(s.doc.activeElement, btn);
});

function dropdownFixture() {
    const removedWin = [];
    const s = runKit({ window: { innerWidth: 360, removeEventListener: (t) => removedWin.push(t) } });
    const root = element("nav", { id: "root" });
    const toggle = element("button", { id: "toggle" });
    toggle.getBoundingClientRect = () => ({ left: 300, bottom: 50 });
    const panel = element("ul", { id: "panel" });
    Object.defineProperty(panel, "offsetWidth", { value: 192 });
    const items = [element("a"), element("a"), element("a")];
    panel.querySelectorAll = () => items;
    items.forEach((a) => panel.appendChild(a));
    root.appendChild(toggle);
    root.appendChild(panel);
    s.doc.body.appendChild(root);
    const keydown = [];
    root.addEventListener = (type, fn) => { if (type === "keydown") keydown.push(fn); };
    root.removeEventListener = (type, fn) => { const i = keydown.indexOf(fn); if (i >= 0) keydown.splice(i, 1); };
    const sent = [];
    const ref = { invokeMethodAsync: (name) => { sent.push(name); return Promise.resolve(); } };
    return { s, root, toggle, panel, items, keydown, sent, ref, removedWin };
}

test("fara-blazor-component: dropdownOpen はパネルをボタンの下（fixed）に置き、画面の端にはみ出さない", () => {
    const f = dropdownFixture();
    f.s.win.faraBlazorComponent.dropdownOpen("root", "toggle", "panel", f.ref, "d1");
    assert.equal(f.panel.style.position, "fixed");
    assert.equal(f.panel.style.top, "54px");
    assert.equal(f.panel.style.left, "160px", "360 - 192 - 8");
});

test("fara-blazor-component: dropdown の ↑↓・Home・End で項目を移り、外のクリック・フォーカスで CloseFromOutside を送る", () => {
    const f = dropdownFixture();
    f.s.win.faraBlazorComponent.dropdownOpen("root", "toggle", "panel", f.ref, "d2");
    let prevented = 0;
    const key = (k, extra = {}) => f.keydown.forEach((fn) => fn({ key: k, preventDefault() { prevented++; }, ...extra }));
    key("ArrowDown");
    assert.equal(f.s.doc.activeElement, f.items[0]);
    key("ArrowDown");
    assert.equal(f.s.doc.activeElement, f.items[1]);
    key("End");
    assert.equal(f.s.doc.activeElement, f.items[2]);
    key("ArrowDown");
    assert.equal(f.s.doc.activeElement, f.items[0], "最後の次は先頭");
    key("ArrowUp");
    assert.equal(f.s.doc.activeElement, f.items[2], "先頭の前は最後");
    key("Home");
    assert.equal(f.s.doc.activeElement, f.items[0]);
    assert.equal(prevented, 6, "移ったときは、画面のスクロールを止める");
    key("a");
    assert.equal(prevented, 6, "他のキーには触らない");
    // 中のクリックでは閉じない。外のクリックで閉じ、監視も外れる
    f.s.docListeners.pointerdown.forEach((fn) => fn({ target: f.toggle }));
    assert.deepEqual(f.sent, []);
    f.s.docListeners.pointerdown.forEach((fn) => fn({ target: element("div") }));
    assert.deepEqual(f.sent, ["CloseFromOutside"]);
    assert.equal(f.s.docListeners.pointerdown.length, 0);
    assert.equal(f.s.docListeners.focusin.length, 0);
    assert.equal(f.keydown.length, 0);
});

test("fara-blazor-component: dropdown は最後の項目から Tab で外へ出ると閉じる。dropdownClose で監視が外れる", () => {
    const f = dropdownFixture();
    f.s.win.faraBlazorComponent.dropdownOpen("root", "toggle", "panel", f.ref, "d3");
    f.items[2].focus();
    f.keydown.forEach((fn) => fn({ key: "Tab", shiftKey: false, preventDefault() { assert.fail("Tab は止めない"); } }));
    assert.deepEqual(f.sent, ["CloseFromOutside"]);

    const g = dropdownFixture();
    g.s.win.faraBlazorComponent.dropdownOpen("root", "toggle", "panel", g.ref, "d4");
    g.s.win.faraBlazorComponent.dropdownClose("d4");
    assert.equal(g.s.docListeners.pointerdown.length, 0);
    assert.equal(g.keydown.length, 0);
    assert.deepEqual(g.removedWin, ["resize"]);
});

test("fara-blazor-component: dropdown の要素が見つからないときは何も登録しない", () => {
    const s = runKit();
    s.win.faraBlazorComponent.dropdownOpen("none", "none", "none", { invokeMethodAsync() { return Promise.resolve(); } }, "d5");
    assert.equal(s.docListeners.pointerdown, undefined);
});

test("fara-blazor-component: focusMenu はメニューボタン（.fbc-menu-toggle）にフォーカスを戻す", () => {
    const s = runKit();
    const btn = element("button", { id: "" });
    btn.classList.add("fbc-menu-toggle");
    s.doc.body.appendChild(btn);
    s.win.faraBlazorComponent.focusMenu();
    assert.equal(s.doc.activeElement, btn);
});

test("fara-blazor-component: checkConfig は、キーが一致すれば true、違えば警告を出す", () => {
    const s = runKit();
    const script = element("script", { dataset: { storageKey: "a.settings", sidebarKey: "a.sidebar" } });
    script.attributes.src = "_content/FaraBlazorComponent.Razor/js/theme-init.js";
    s.doc.body.appendChild(script);
    const api = s.win.faraBlazorComponent;

    assert.equal(api.checkConfig("a.settings", "a.sidebar"), true);
    assert.equal(s.warnings.length, 0);

    assert.equal(api.checkConfig("b.settings", "a.sidebar"), false);
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0], /data-storage-key/);

    assert.equal(api.checkConfig("a.settings", "b.sidebar"), false);
    assert.equal(s.warnings.length, 2);
    assert.match(s.warnings[1], /data-sidebar-key/);
});

test("fara-blazor-component: checkConfig は theme-init.js が無いときに警告する", () => {
    const s = runKit();
    assert.equal(s.win.faraBlazorComponent.checkConfig("a", "b"), false);
    assert.match(s.warnings[0], /theme-init\.js が無い/);
});

// ---- report.js ----

function runReport({ enabled = true, siteKey = "key-1", ok = true, turnstile } = {}) {
    const calls = { fetch: [], render: [], reset: [], remove: [] };
    const ts = turnstile || {
        render(el, opts) { calls.render.push({ el, opts }); return "widget-1"; },
        reset(id) { calls.reset.push(id); },
        remove(id) { calls.remove.push(id); },
    };
    const s = sandbox({
        globals: {
            fetch: async (url) => {
                calls.fetch.push(url);
                return { ok, json: async () => ({ enabled, siteKey }) };
            },
        },
    });
    const container = element("div", { id: "fbc-report-turnstile" });
    s.doc.body.appendChild(container);
    s.win.turnstile = ts;
    vm.runInContext(load("report.js"), s.ctx);
    return { s, calls, container };
}

test("report.js: mount は設定（enabled と siteKey）を読み、確認の欄を描く", async () => {
    const { s, calls, container } = runReport();

    const ok = await s.win.faraBlazorComponent.report.mount("fbc-report-turnstile", "api/report/config");

    assert.equal(ok, true);
    assert.deepEqual(calls.fetch, ["api/report/config"]);
    assert.equal(calls.render[0].el, container);
    assert.equal(calls.render[0].opts.sitekey, "key-1");
});

test("report.js: 設定が無効（enabled=false）なら mount は false（描かない）", async () => {
    const { s, calls } = runReport({ enabled: false });

    assert.equal(await s.win.faraBlazorComponent.report.mount("fbc-report-turnstile", "api/report/config"), false);
    assert.equal(calls.render.length, 0);
});

test("report.js: 設定の取得に失敗したら false", async () => {
    const { s } = runReport({ ok: false });

    assert.equal(await s.win.faraBlazorComponent.report.mount("fbc-report-turnstile", "api/report/config"), false);
});

test("report.js: 確認が済んだトークンを token() と waitToken() で返し、reset・dispose で消す", async () => {
    const { s, calls } = runReport();
    const api = s.win.faraBlazorComponent.report;
    await api.mount("fbc-report-turnstile", "api/report/config");
    calls.render[0].opts.callback("tok-1");

    assert.equal(api.token(), "tok-1");
    assert.equal(await api.waitToken(1000), "tok-1");

    api.reset();
    assert.deepEqual(calls.reset, ["widget-1"]);
    assert.equal(api.token(), "");

    api.dispose();
    assert.deepEqual(calls.remove, ["widget-1"]);
});

test("report.js: waitToken は届かなければ、待ち時間の後に空を返す", async () => {
    const { s } = runReport();
    assert.equal(await s.win.faraBlazorComponent.report.waitToken(50), "");
});

test("report.js: 確認の部品が例外を投げても、reset と dispose は止まらない", async () => {
    const { s } = runReport({
        turnstile: {
            render() { return "w"; },
            reset() { throw new Error("gone"); },
            remove() { throw new Error("gone"); },
        },
    });
    const api = s.win.faraBlazorComponent.report;
    await api.mount("fbc-report-turnstile", "api/report/config");
    assert.doesNotThrow(() => api.reset());
    assert.doesNotThrow(() => api.dispose());
});

// ---- boot-indicator.js・scroll-progress.js（要素が無いページでも落ちないこと） ----

test("boot-indicator.js: 要素が無いページでも例外を出さずに何もしない", () => {
    const s = sandbox();
    assert.doesNotThrow(() => vm.runInContext(load("boot-indicator.js"), s.ctx));
});

test("scroll-progress.js: 進捗の線が無いページでも例外を出さない", () => {
    const s = sandbox();
    assert.doesNotThrow(() => vm.runInContext(load("scroll-progress.js"), s.ctx));
});
