// csp/render-headers.mjs の検査の強化: sha256 の長さ・Cloudflare の _headers の上限（100 ルール・1 行 2000 文字）。
//   node --test tests/csp/limits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderHeaders } from "../../csp/render-headers.mjs";

const REAL_SHA256 = `'sha256-${createHash("sha256").update("inline script").digest("base64")}'`;

test("sha256 のハッシュは、base64 の 44 文字（末尾 =）だけ受ける", () => {
    assert.match(REAL_SHA256, /^'sha256-.{43}='$/);
    assert.match(renderHeaders({ scriptSrc: [REAL_SHA256] }), /script-src 'self' 'wasm-unsafe-eval' '/);
});

test("短い・長いハッシュ、sha384・sha512 は拒否する", () => {
    for (const bad of ["'sha256-abc'", "'sha256-abcDEF0123+/=='", `'sha256-${"A".repeat(42)}='`, `'sha256-${"A".repeat(44)}='`]) {
        assert.throws(() => renderHeaders({ scriptSrc: [bad] }), /不正な値/, bad);
    }
    const sha384 = `'sha384-${createHash("sha384").update("x").digest("base64")}'`;
    const sha512 = `'sha512-${createHash("sha512").update("x").digest("base64")}'`;
    assert.throws(() => renderHeaders({ scriptSrc: [sha384] }), /不正な値/);
    assert.throws(() => renderHeaders({ styleSrc: [sha512] }), /不正な値/);
});

test("ルールは 100 個まで（超えるとエラー）", () => {
    const rules = Array.from({ length: 99 }, (_, i) => ({ path: `/p${i}/*`, value: "no-cache" }));
    assert.doesNotThrow(() => renderHeaders({ cacheRules: rules }));
    assert.throws(() => renderHeaders({ cacheRules: [...rules, { path: "/x/*", value: "no-cache" }] }), /100 個まで/);
});

test("1 行は 2000 文字まで（超えるとエラー）", () => {
    assert.throws(() => renderHeaders({ cacheRules: [{ path: "/long/*", value: "x".repeat(2100) }] }), /2000 文字まで/);
    assert.doesNotThrow(() => renderHeaders({ cacheRules: [{ path: "/long/*", value: "x".repeat(1900) }] }));
});
