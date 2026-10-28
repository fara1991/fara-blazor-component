// レイアウトの自動計測の判定（ブラウザを使わない部分）の確認。  node --test tests/layout-check/rules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIEWPORTS,
  LayoutCheckConfigError,
  MENU_BREAKPOINT,
  TAP_MIN_SIZE,
  exclusionsFor,
  fontSizeOk,
  formatViolation,
  h1Problem,
  hasHorizontalOverflow,
  isFocusVisible,
  isInlineLink,
  isOffscreen,
  normalizeConfig,
  statusOk,
  tapHalfOffset,
  tapTargetOk,
  validateExclusions,
} from "../../tools/layout-check/rules.mjs";

const base = { baseURL: "http://localhost:8820", pages: ["/"] };
const style = (over = {}) => ({ outlineStyle: "none", outlineWidth: 0, boxShadow: "none", borderColors: ["a", "b", "c", "d"], ...over });

test("tapHalfOffset は 44px なら中心から ±20（隣と 44px 間隔の境目 22px より内側）", () => {
  assert.equal(TAP_MIN_SIZE, 44);
  assert.equal(tapHalfOffset(44), 20);
  assert.equal(tapHalfOffset(48), 22);
  // 隣の要素の 44px の箱は、中心から 22px 手前から始まる（間隔 44 の場合）。±20 の点は、それより内側
  assert.equal(tapHalfOffset(44) < 44 - 22, true);
});

test("押せる範囲: 上下左右の点がすべて自分に当たれば OK、1 つでも外れたら NG", () => {
  const hit = { tested: true, hit: true };
  const miss = { tested: true, hit: false };
  const off = { tested: false, hit: false };
  assert.equal(tapTargetOk([hit, hit, hit, hit, hit]), true);
  assert.equal(tapTargetOk([hit, miss, hit, hit, hit]), false);
  assert.equal(tapTargetOk([hit, hit, hit, miss, hit]), false);
  // 画面の外の点は数えない（閉じたドロワーの中など）
  assert.equal(tapTargetOk([off, off, off, off, off]), true);
  assert.equal(tapTargetOk([hit, off, off, hit, hit]), true);
});

test("文中のリンク（inline で前後に文字がある）は押せる範囲の判定から外す", () => {
  const paragraph = { display: "inline", hasTextBefore: true, hasTextAfter: false, inParagraph: true };
  assert.equal(isInlineLink(paragraph), true);
  assert.equal(isInlineLink({ ...paragraph, hasTextBefore: false, hasTextAfter: true }), true);
  assert.equal(isInlineLink({ ...paragraph, hasTextBefore: false, hasTextAfter: false }), false, "前後に文字が無い");
  assert.equal(isInlineLink({ ...paragraph, display: "inline-block" }), false);
  assert.equal(isInlineLink({ ...paragraph, display: "block" }), false);
});

test("表のセル（段落でない）の中のリンクは、文字が横にあっても文中のリンクとして外さない", () => {
  // 「詳細は [ここ]」のような表のセル。文字が横にあるが、段落ではない
  assert.equal(isInlineLink({ display: "inline", hasTextBefore: true, hasTextAfter: false, inParagraph: false }), false);
  assert.equal(isInlineLink({ display: "inline", hasTextBefore: false, hasTextAfter: false, inParagraph: false }), false);
});

test("文字の大きさ: 12px 以上が OK（既定）、未満と測れない値は NG", () => {
  assert.equal(fontSizeOk(12), true);
  assert.equal(fontSizeOk(11.9), false);
  assert.equal(fontSizeOk(14, 16), false);
  assert.equal(fontSizeOk(Number.NaN), false);
});

test("見えるフォーカス: outline・box-shadow・枠線の色のどれかが変わればよい", () => {
  assert.equal(isFocusVisible(style(), style()), false, "何も変わらない");
  assert.equal(isFocusVisible(style({ outlineStyle: "solid", outlineWidth: 2 }), style()), true, "outline が出る");
  assert.equal(isFocusVisible(style({ outlineStyle: "auto", outlineWidth: 0 }), style()), false, "幅 0 の outline は見えない");
  assert.equal(isFocusVisible(style({ boxShadow: "0 0 0 2px red" }), style()), true, "box-shadow が変わる");
  assert.equal(isFocusVisible(style({ borderColors: ["x", "b", "c", "d"] }), style()), true, "枠線の色が変わる");
});

test("画面の外（閉じたドロワーの x < -100 など）を判定する", () => {
  const vw = 360;
  const vh = 800;
  assert.equal(isOffscreen({ left: -260, right: 0, top: 56, bottom: 100 }, vw, vh), true);
  assert.equal(isOffscreen({ left: -150, right: 110, top: 0, bottom: 40 }, vw, vh), true, "x < -100");
  assert.equal(isOffscreen({ left: 0, right: 100, top: 0, bottom: 40 }, vw, vh), false);
  assert.equal(isOffscreen({ left: 360, right: 420, top: 0, bottom: 40 }, vw, vh), true, "右の外");
});

test("横スクロール: scrollWidth が clientWidth より大きいときだけ", () => {
  assert.equal(hasHorizontalOverflow(360, 360), false);
  assert.equal(hasHorizontalOverflow(361, 360), true);
});

test("見える h1 は、ちょうど 1 つだけ OK", () => {
  assert.equal(h1Problem(1), null);
  assert.match(h1Problem(0), /無い/);
  assert.match(h1Problem(2), /2 つ/);
});

test("除外: 理由が無い・空の除外は設定エラー", () => {
  assert.throws(() => validateExclusions([{ rule: "tap-target", selector: "#x" }]), LayoutCheckConfigError);
  assert.throws(() => validateExclusions([{ rule: "tap-target", selector: "#x", reason: "  " }]), /reason/);
  assert.throws(() => validateExclusions([{ rule: "tap-target", reason: "理由" }]), /selector/);
  assert.throws(() => validateExclusions([{ rule: "no-such-rule", selector: "#x", reason: "理由" }]), /rule/);
  assert.throws(() => validateExclusions([{ rule: "tap-target", selector: "#x", reason: "理由", page: "works" }]), /page/);
  assert.throws(() => validateExclusions("tap-target"), LayoutCheckConfigError);
});

test("除外: 正しく書けば、ルール・ページごとに取り出せる", () => {
  const list = validateExclusions([
    { rule: "tap-target", selector: " .footer a ", reason: "文字の一部。見た目は変えない" },
    { rule: "tap-target", selector: "#cookie", reason: "一時的な帯", page: "/works" },
    { rule: "min-font-size", selector: ".badge", reason: "装飾の数字" },
  ]);
  assert.deepEqual(exclusionsFor(list, "tap-target", "/"), [".footer a"]);
  assert.deepEqual(exclusionsFor(list, "tap-target", "/works"), [".footer a", "#cookie"]);
  assert.deepEqual(exclusionsFor(list, "min-font-size", "/works"), [".badge"]);
});

test("normalizeConfig: 既定値・ページの省略形・ルールの既定の on/off", () => {
  const config = normalizeConfig({ ...base, pages: ["/", { path: "/works" }] });
  assert.deepEqual(config.viewports, [...DEFAULT_VIEWPORTS]);
  assert.deepEqual(config.pages, [
    { path: "/", name: "/", allowStatus: [] },
    { path: "/works", name: "/works", allowStatus: [] },
  ]);
  assert.equal(config.baseURL, "http://localhost:8820");
  assert.equal(config.rules["menu-esc"], false, "buttonSelector が無いと menu-esc は off");
  assert.equal(config.rules["tap-target"], true);
  assert.equal(config.tapTarget.maxWidth, 600);
  assert.equal(config.focus.maxStops, 40);
});

test("normalizeConfig: menuEsc を書けば menu-esc は on（既定の breakpoint は kit のスマホの境目）", () => {
  const config = normalizeConfig({ ...base, menuEsc: { buttonSelector: ".fsk-menu-toggle" } });
  assert.equal(config.rules["menu-esc"], true);
  assert.equal(config.menuEsc.breakpoint, MENU_BREAKPOINT);
});

test("normalizeConfig: menu-close-visible も menuEsc が無いと off・あると on。closeSelector は任意（空は設定エラー）", () => {
  assert.equal(normalizeConfig(base).rules["menu-close-visible"], false);
  const on = normalizeConfig({ ...base, menuEsc: { buttonSelector: "#menu" } });
  assert.equal(on.rules["menu-close-visible"], true);
  assert.equal(on.menuEsc.closeSelector, null);
  const withClose = normalizeConfig({ ...base, menuEsc: { buttonSelector: "#menu", closeSelector: " #drawer-close " } });
  assert.equal(withClose.menuEsc.closeSelector, "#drawer-close");
  assert.throws(() => normalizeConfig({ ...base, rules: { "menu-close-visible": true } }), /buttonSelector/);
  assert.throws(() => normalizeConfig({ ...base, menuEsc: { buttonSelector: "#menu", closeSelector: "" } }), /closeSelector/);
});

test("normalizeConfig: 不正な設定は LayoutCheckConfigError", () => {
  assert.throws(() => normalizeConfig(null), LayoutCheckConfigError);
  assert.throws(() => normalizeConfig({ pages: ["/"] }), /baseURL/);
  assert.throws(() => normalizeConfig({ baseURL: "not a url", pages: ["/"] }), /URL/);
  assert.throws(() => normalizeConfig({ ...base, pages: [] }), /pages/);
  assert.throws(() => normalizeConfig({ ...base, pages: ["works"] }), /\//);
  assert.throws(() => normalizeConfig({ ...base, viewports: [0] }), /viewports/);
  assert.throws(() => normalizeConfig({ ...base, rules: { "tap-targt": true } }), /未知のルール名/);
  assert.throws(() => normalizeConfig({ ...base, rules: { "tap-target": "yes" } }), /true か false/);
  assert.throws(() => normalizeConfig({ ...base, rules: { "menu-esc": true } }), /buttonSelector/);
  assert.throws(() => normalizeConfig({ ...base, exclusions: [{ rule: "tap-target", selector: "#x" }] }), /reason/);
  assert.throws(() => normalizeConfig({ ...base, timeoutMs: -1 }), /timeoutMs/);
});

test("reducedMotion（既定 true）と includeDisabled（既定 false）の既定値と検査", () => {
  const config = normalizeConfig(base);
  assert.equal(config.reducedMotion, true);
  assert.equal(config.includeDisabled, false);
  assert.equal(normalizeConfig({ ...base, reducedMotion: false, includeDisabled: true }).reducedMotion, false);
  assert.throws(() => normalizeConfig({ ...base, reducedMotion: "reduce" }), /reducedMotion/);
  assert.throws(() => normalizeConfig({ ...base, includeDisabled: 1 }), /includeDisabled/);
});

test("allowStatus: ページごとに許すステータス。省くと空（2xx だけ）、不正な値は設定エラー", () => {
  const config = normalizeConfig({ ...base, pages: ["/", { path: "/missing", name: "404", allowStatus: [404] }] });
  assert.deepEqual(config.pages.map((p) => p.allowStatus), [[], [404]]);
  assert.throws(() => normalizeConfig({ ...base, pages: [{ path: "/x", allowStatus: "404" }] }), /allowStatus/);
  assert.throws(() => normalizeConfig({ ...base, pages: [{ path: "/x", allowStatus: [99] }] }), /allowStatus/);
});

test("statusOk: 2xx は OK。それ以外は allowStatus に書いたものだけ OK", () => {
  assert.equal(statusOk(200), true);
  assert.equal(statusOk(204), true);
  assert.equal(statusOk(404), false, "許していない 404 は NG");
  assert.equal(statusOk(404, [404]), true);
  assert.equal(statusOk(500, [404]), false);
});

test("違反の 1 行表示", () => {
  const line = formatViolation({ page: "トップ", width: 360, rule: "tap-target", selector: "a.x", value: "30x30px", message: "小さい" });
  assert.equal(line, "[トップ 360px] tap-target  a.x  （30x30px）  小さい");
});
