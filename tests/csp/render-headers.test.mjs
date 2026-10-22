// csp/render-headers.mjs の確認（_headers の CSP・noindex・キャッシュ）。
//   node --test tests/csp/render-headers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHeaders } from "../../csp/render-headers.mjs";

const SHA = "'sha256-abcDEF0123+/=='";

test("何も渡さないと、既定の CSP（'self' と固定の値だけ）・末尾の改行つき", () => {
    const text = renderHeaders();
    assert.equal(text.endsWith("\n"), true);
    assert.equal(text.endsWith("\n\n"), false);
    assert.match(text, /^\/\*$/m);
    assert.match(text, /^ {2}Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'$/m);
    assert.doesNotMatch(text, /frame-src|X-Robots-Tag|Cache-Control|\{\{/);
});

test("ホストは欄ごとに足す。frame-src は frameSrc があるときだけ（connect-src の後ろ・object-src の前）", () => {
    const text = renderHeaders({ frameSrc: ["https://challenges.cloudflare.com"], connectSrc: ["wss://ws.example.com"] });
    assert.match(text, /connect-src 'self' wss:\/\/ws\.example\.com; frame-src https:\/\/challenges\.cloudflare\.com; object-src 'none'/);
});

test("script-src に 'unsafe-inline' と 'unsafe-eval' は使えない", () => {
    assert.throws(() => renderHeaders({ scriptSrc: ["'unsafe-inline'"] }), /unsafe-inline/);
    assert.throws(() => renderHeaders({ scriptSrc: ["'unsafe-eval'"] }), /unsafe-eval/);
});

test("ホストの値の形: * や https: だけ、; や空白や改行を含む値、http:// は拒否する", () => {
    for (const bad of ["*", "https:", "https://a.example; script-src *", "https://a.example b.example", "https://a.example\nX", "http://a.example", "https://a.example/path"]) {
        assert.throws(() => renderHeaders({ scriptSrc: [bad] }), /不正な値/, bad);
    }
    assert.throws(() => renderHeaders({ imgSrc: [""] }), /空の値/);
});

test("sha256 のハッシュは scriptSrc と styleSrc に入る。frameSrc では拒否する", () => {
    const text = renderHeaders({ scriptSrc: [SHA], styleSrc: [SHA] });
    assert.match(text, new RegExp(`script-src 'self' 'wasm-unsafe-eval' ${escapeRe(SHA)};`));
    assert.match(text, new RegExp(`style-src 'self' 'unsafe-inline' ${escapeRe(SHA)};`));
    assert.throws(() => renderHeaders({ frameSrc: [SHA] }), /不正な値/);
});

test("同じホストは 1 つにまとめる（順序は入力どおり）", () => {
    const text = renderHeaders({ fontSrc: ["https://fonts.gstatic.com", "https://fonts.gstatic.com"] });
    assert.match(text, /font-src 'self' https:\/\/fonts\.gstatic\.com;/);
    assert.equal((text.match(/fonts\.gstatic/g) || []).length, 1);
});

test("noindex: true で X-Robots-Tag: noindex を /* の中に入れる", () => {
    const text = renderHeaders({ noindex: true });
    const lines = text.split("\n");
    const robots = lines.indexOf("  X-Robots-Tag: noindex");
    assert.ok(robots > 0);
    assert.ok(lines.indexOf("/*") < robots);
    assert.doesNotMatch(renderHeaders({ noindex: false }), /X-Robots-Tag/);
});

test("cacheRules: path と Cache-Control を追加する（既定では何も付けない）", () => {
    const text = renderHeaders({ cacheRules: [{ path: "/_framework/*", value: "public, max-age=31536000, immutable" }] });
    assert.match(text, /\n\/_framework\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n$/);
    assert.throws(() => renderHeaders({ cacheRules: [{ path: "no-slash", value: "x" }] }), /path/);
    assert.throws(() => renderHeaders({ cacheRules: [{ path: "/a", value: "x\ny" }] }), /Cache-Control/);
});

test("未知の項目（綴りの間違い）は失敗する", () => {
    assert.throws(() => renderHeaders({ scriptsrc: [] }), /知らない項目 "scriptsrc"/);
});

test("配列でない欄は失敗する", () => {
    assert.throws(() => renderHeaders({ scriptSrc: "https://a.example" }), /配列/);
});

function escapeRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
