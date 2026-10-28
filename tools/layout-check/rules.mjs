// レイアウトの自動計測の「判定」（ブラウザを使わない部分）。
// ブラウザでの計測は browser.mjs が行い、測った値をここの関数で判定する。判定だけを node:test で確かめられるように分けている。
// playwright-core を import しない（CI の `npm test` は依存を入れずに動く）。

/** 設定の検査で出る例外（設定の書き方の誤り。CLI は終了コード 2）。 */
export class LayoutCheckConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "LayoutCheckConfigError";
  }
}

/** 実行時の失敗（ページが開けない・ブラウザが動かない）。CLI は終了コード 2。 */
export class LayoutCheckRunError extends Error {
  constructor(message) {
    super(message);
    this.name = "LayoutCheckRunError";
  }
}

/** ルール名。増やすとき・名前を変えるときは docs/layout-check.md も直す。 */
export const RULE_NAMES = Object.freeze([
  "no-horizontal-scroll",
  "single-h1",
  "focus-visible",
  "no-offscreen-focus",
  "tap-target",
  "min-font-size",
  "menu-esc",
]);

export const DEFAULT_VIEWPORTS = Object.freeze([360, 390, 768, 1024, 1440]);
export const DEFAULT_VIEWPORT_HEIGHT = 800;
/** 押せる範囲の最小（px）。WCAG 2.5.5 の 44×44 に合わせる。 */
export const TAP_MIN_SIZE = 44;
/** 押せる範囲を測るのは、この幅未満だけ（スマホの幅）。 */
export const TAP_MAX_WIDTH = 600;
export const MIN_FONT_PX = 12;
/** メニューの開閉を測るのは、この幅未満だけ（kit の SiteLayout のスマホの境目）。 */
export const MENU_BREAKPOINT = 768;
export const DEFAULT_MAX_TAB_STOPS = 40;
/** 画面の左へこれだけはみ出した要素は、画面の外にあるとみなす（閉じたドロワー）。 */
export const OFFSCREEN_LEFT_LIMIT = -100;
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 押せる範囲の判定に使う、中心からの距離（px）。44px なら ±20（以前は ±21.5）。
 * 隣と 44px 間隔で並ぶ要素（SNS のアイコンなど）は、境目が中心から 22px になる。±21.5 だと、サブピクセルの丸めで隣に当たって誤検出した（sample の SNS で確認）。
 * ±20 なら境目までに 2px の余裕がある。これにより、40px の箱が通る（44px の規格からは 4px の緩和）。
 */
export function tapHalfOffset(minSize = TAP_MIN_SIZE) {
  return minSize / 2 - 2;
}

/**
 * 押せる範囲の判定。points は中心と上下左右の点の結果。
 * tested が false の点（画面の外）は数えない。測った点がすべて自分（または子）に当たれば押せる。
 * @param {{ tested: boolean, hit: boolean }[]} points
 */
export function tapTargetOk(points) {
  const tested = points.filter((p) => p.tested);
  if (tested.length === 0) return true;
  return tested.every((p) => p.hit);
}

/**
 * 文中のリンク（段落の中で、前後に他の文字がある inline のリンク）か。タップの大きさの判定から外す。
 * 表のセル（td・th）の中のリンクは、段落とみなさない（セルの中で文字が横にあっても外さない）。inParagraph は、ブラウザ側で「最も近い block の祖先が表のセルでない」かを測った値。
 * @param {{ display: string, hasTextBefore: boolean, hasTextAfter: boolean, inParagraph: boolean }} info
 */
export function isInlineLink({ display, hasTextBefore, hasTextAfter, inParagraph }) {
  return display === "inline" && inParagraph === true && (hasTextBefore === true || hasTextAfter === true);
}

/**
 * ページを開けた応答か。2xx は常に OK。それ以外は pages[].allowStatus に書いたものだけ OK（例: 404 の画面を測る）。
 * @param {number} status HTTP のステータス
 * @param {number[]} allowStatus 許すステータス
 */
export function statusOk(status, allowStatus = []) {
  return (status >= 200 && status < 300) || allowStatus.includes(status);
}

/** 文字の大きさ（px）が下限以上か。 */
export function fontSizeOk(px, min = MIN_FONT_PX) {
  return Number.isFinite(px) && px >= min;
}

/**
 * 見えるフォーカス表示があるか。focused は押した後（フォーカス中）、unfocused は同じ要素のフォーカスを外した後の値。
 * outline が none でない（幅が 0 より大きい）、box-shadow が変わった、枠線の色が変わった、のどれか。
 * @param {{ outlineStyle: string, outlineWidth: number, boxShadow: string, borderColors: string[] }} focused
 * @param {{ outlineStyle: string, outlineWidth: number, boxShadow: string, borderColors: string[] }} unfocused
 */
export function isFocusVisible(focused, unfocused) {
  const outlineShown = focused.outlineStyle !== "none" && focused.outlineWidth > 0;
  const shadowChanged = focused.boxShadow !== unfocused.boxShadow;
  const borderChanged = focused.borderColors.some((color, i) => color !== unfocused.borderColors[i]);
  return outlineShown || shadowChanged || borderChanged;
}

/**
 * フォーカスされた要素が画面の外にあるか（閉じたドロワーの中の項目など）。rect は getBoundingClientRect の値。
 * @param {{ left: number, right: number, top: number, bottom: number }} rect
 */
export function isOffscreen(rect, viewportWidth, viewportHeight) {
  return (
    rect.left < OFFSCREEN_LEFT_LIMIT ||
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= viewportWidth ||
    rect.top >= viewportHeight
  );
}

/** ページ全体の横スクロール（documentElement の scrollWidth が clientWidth より大きい）。 */
export function hasHorizontalOverflow(scrollWidth, clientWidth) {
  return scrollWidth > clientWidth;
}

/**
 * 見える h1 の数の判定。ちょうど 1 つならば null、違うならメッセージ。
 * @param {number} count
 */
export function h1Problem(count) {
  if (count === 1) return null;
  if (count === 0) return "h1 が無い（ページの見出しは 1 つだけ置く）";
  return `h1 が ${count} つある（ページの見出しは 1 つだけ置く。.sr-only の h1 も数える）`;
}

/**
 * 除外の検査。理由の無い除外は設定エラー。
 * @param {unknown} list
 * @returns {{ rule: string, selector: string, reason: string, page: string | null }[]}
 */
export function validateExclusions(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new LayoutCheckConfigError("exclusions は配列で書く");
  return list.map((item, index) => {
    const at = `exclusions[${index}]`;
    if (!item || typeof item !== "object") throw new LayoutCheckConfigError(`${at} はオブジェクトで書く（rule・selector・reason）`);
    if (!RULE_NAMES.includes(item.rule)) {
      throw new LayoutCheckConfigError(`${at}.rule が不正（${String(item.rule)}）。使えるのは ${RULE_NAMES.join(", ")}`);
    }
    if (typeof item.selector !== "string" || item.selector.trim() === "") {
      throw new LayoutCheckConfigError(`${at}.selector が空（除外する要素のセレクターを書く）`);
    }
    if (typeof item.reason !== "string" || item.reason.trim() === "") {
      throw new LayoutCheckConfigError(`${at}.reason が空（除外の理由を書く。理由の無い除外は設定エラー）`);
    }
    if (item.page !== undefined && (typeof item.page !== "string" || !item.page.startsWith("/"))) {
      throw new LayoutCheckConfigError(`${at}.page は / で始まるパス（省くとすべてのページ）`);
    }
    return {
      rule: item.rule,
      selector: item.selector.trim(),
      reason: item.reason.trim(),
      page: item.page ?? null,
    };
  });
}

/** あるページ・ルールで除外されるセレクターの一覧（ブラウザ側で el.matches に渡す）。 */
export function exclusionsFor(exclusions, rule, pagePath) {
  return exclusions
    .filter((e) => e.rule === rule && (e.page === null || e.page === pagePath))
    .map((e) => e.selector);
}

function fail(message) {
  throw new LayoutCheckConfigError(message);
}

function normalizeAllowStatus(value, index) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((code) => !Number.isInteger(code) || code < 100 || code > 599)) {
    fail(`pages[${index}].allowStatus は HTTP のステータスの配列で書く（例: [404]）`);
  }
  return [...new Set(value)];
}

function normalizePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) fail("pages は 1 つ以上の配列で書く（例: [\"/\", { path: \"/works\", name: \"作品\" }]）");
  return pages.map((page, index) => {
    if (typeof page === "string") {
      if (!page.startsWith("/")) fail(`pages[${index}] は / で始まるパスで書く（${page}）`);
      return { path: page, name: page, allowStatus: [] };
    }
    if (!page || typeof page !== "object" || typeof page.path !== "string" || !page.path.startsWith("/")) {
      fail(`pages[${index}] は / で始まるパスの文字列か、{ path, name, allowStatus } で書く`);
    }
    return {
      path: page.path,
      name: typeof page.name === "string" && page.name !== "" ? page.name : page.path,
      allowStatus: normalizeAllowStatus(page.allowStatus, index),
    };
  });
}

function normalizeViewports(viewports) {
  if (viewports === undefined) return [...DEFAULT_VIEWPORTS];
  if (!Array.isArray(viewports) || viewports.length === 0) fail("viewports は幅（px）の配列で書く");
  for (const width of viewports) {
    if (!Number.isInteger(width) || width < 200 || width > 2560) fail(`viewports の幅が不正（${String(width)}。200〜2560 の整数）`);
  }
  return [...new Set(viewports)];
}

function normalizeRules(input, menuEsc) {
  const rules = input ?? {};
  if (typeof rules !== "object" || Array.isArray(rules)) fail("rules はオブジェクトで書く（例: { \"tap-target\": false }）");
  for (const key of Object.keys(rules)) {
    if (!RULE_NAMES.includes(key)) fail(`rules に未知のルール名（${key}）。使えるのは ${RULE_NAMES.join(", ")}`);
    if (typeof rules[key] !== "boolean") fail(`rules["${key}"] は true か false で書く`);
  }
  const result = {};
  for (const name of RULE_NAMES) {
    if (name === "menu-esc") {
      const wanted = rules[name] ?? (menuEsc !== null);
      if (wanted && menuEsc === null) fail("menu-esc を使うには menuEsc.buttonSelector（メニューボタンのセレクター）が要る");
      result[name] = wanted;
    } else {
      result[name] = rules[name] ?? true;
    }
  }
  return result;
}

function normalizeMenuEsc(menuEsc) {
  if (menuEsc === undefined || menuEsc === null) return null;
  if (typeof menuEsc !== "object" || typeof menuEsc.buttonSelector !== "string" || menuEsc.buttonSelector.trim() === "") {
    fail("menuEsc は { buttonSelector, breakpoint? } で書く（buttonSelector はメニューボタンのセレクター）");
  }
  return {
    buttonSelector: menuEsc.buttonSelector.trim(),
    breakpoint: menuEsc.breakpoint ?? MENU_BREAKPOINT,
  };
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) fail(`${name} は 1 以上の整数で書く`);
  return value;
}

/**
 * 設定の検査と、既定値の補完。不正なら LayoutCheckConfigError を投げる。
 * @param {unknown} raw 利用するサイトの設定（layout-check.config.mjs の default export）
 */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object") fail("設定はオブジェクトで書く（export default { baseURL, pages, ... }）");
  if (typeof raw.baseURL !== "string") fail("baseURL が無い（配信中のサイトの URL。例: http://localhost:8820）");
  let baseURL;
  try {
    baseURL = new URL(raw.baseURL);
  } catch {
    fail(`baseURL が URL として読めない（${raw.baseURL}）`);
  }
  const menuEsc = normalizeMenuEsc(raw.menuEsc);
  const tap = raw.tapTarget ?? {};
  const font = raw.minFontSize ?? {};
  const focus = raw.focus ?? {};
  if (!Array.isArray(font.ignoreSelectors ?? [])) fail("minFontSize.ignoreSelectors は配列で書く");
  if (raw.reducedMotion !== undefined && typeof raw.reducedMotion !== "boolean") fail("reducedMotion は true か false で書く（既定は true）");
  if (raw.includeDisabled !== undefined && typeof raw.includeDisabled !== "boolean") fail("includeDisabled は true か false で書く（既定は false）");
  return {
    baseURL: baseURL.href.replace(/\/$/, ""),
    pages: normalizePages(raw.pages),
    viewports: normalizeViewports(raw.viewports),
    viewportHeight: positiveInteger(raw.viewportHeight, DEFAULT_VIEWPORT_HEIGHT, "viewportHeight"),
    rules: normalizeRules(raw.rules, menuEsc),
    exclusions: validateExclusions(raw.exclusions),
    reducedMotion: raw.reducedMotion ?? true,
    includeDisabled: raw.includeDisabled ?? false,
    tapTarget: {
      minSize: positiveInteger(tap.minSize, TAP_MIN_SIZE, "tapTarget.minSize"),
      maxWidth: positiveInteger(tap.maxWidth, TAP_MAX_WIDTH, "tapTarget.maxWidth"),
    },
    minFontSize: {
      min: positiveInteger(font.min, MIN_FONT_PX, "minFontSize.min"),
      ignoreSelectors: [...(font.ignoreSelectors ?? [])],
    },
    focus: { maxStops: positiveInteger(focus.maxStops, DEFAULT_MAX_TAB_STOPS, "focus.maxStops") },
    menuEsc,
    readySelector: typeof raw.readySelector === "string" && raw.readySelector.trim() !== "" ? raw.readySelector.trim() : null,
    timeoutMs: positiveInteger(raw.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
    browser: { channel: typeof raw.browser?.channel === "string" ? raw.browser.channel : undefined },
  };
}

/**
 * 違反を 1 行の文字列にする（CLI の表示・テストの期待値に使う）。
 * @param {{ page: string, width: number, rule: string, selector: string, value: string, message: string }} v
 */
export function formatViolation(v) {
  return `[${v.page} ${v.width}px] ${v.rule}  ${v.selector}  （${v.value}）  ${v.message}`;
}
