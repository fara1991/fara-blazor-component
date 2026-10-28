// レイアウトの自動計測のブラウザ部分。ページを開いて値を測り、判定は rules.mjs の関数に任せる。
// page.evaluate に渡す関数は、ブラウザで単独に動く（この file の import は使えない）。共通の補助は addInitScript で window.__layoutCheck に入れる。

import {
  DEFAULT_TIMEOUT_MS,
  LayoutCheckRunError,
  exclusionsFor,
  fontSizeOk,
  h1Problem,
  hasHorizontalOverflow,
  isFocusVisible,
  isInlineLink,
  isOffscreen,
  tapHalfOffset,
  tapTargetOk,
} from "./rules.mjs";

/** ブラウザで共通に使う補助（addInitScript で入れる）。 */
function installHelpers() {
  const ids = new WeakMap();
  let next = 1;
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = typeof el.className === "string"
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join("")
      : "";
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 20);
    return text ? `${tag}${id}${classes} "${text}"` : `${tag}${id}${classes}`;
  };
  const measureFocus = (el) => {
    const cs = getComputedStyle(el);
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth) || 0,
      boxShadow: cs.boxShadow,
      borderColors: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
    };
  };
  const hasText = (node) => {
    if (!node) return false;
    if (node.nodeType === 3) return node.textContent.trim() !== "";
    if (node.nodeType === 1) return getComputedStyle(node).display === "inline" && (node.textContent || "").trim() !== "";
    return false;
  };
  window.__layoutCheck = {
    keyOf(el) {
      if (!ids.has(el)) ids.set(el, next++);
      return ids.get(el);
    },
    describe,
    measureFocus,
    hasOwnText: (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() !== ""),
    hasTextBefore: (el) => hasText(el.previousSibling),
    hasTextAfter: (el) => hasText(el.nextSibling),
  };
}

/** 見える h1 の数（.sr-only の h1 も数える。描画の箱が無いものだけ外す）。 */
function countVisibleH1() {
  return Array.from(document.querySelectorAll("h1")).filter((el) => el.getClientRects().length > 0).length;
}

/** ページ全体の横スクロールと、はみ出している要素（rect.right > innerWidth）。除外の要素は数えない。 */
function measureHorizontal(excluded) {
  const offenders = [];
  let excludedCount = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= window.innerWidth + 0.5) continue;
    if (excluded.some((s) => el.matches(s))) {
      excludedCount += 1;
      continue;
    }
    if (offenders.length < 10) offenders.push({ selector: window.__layoutCheck.describe(el), right: Math.round(r.right) });
  }
  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders,
    excludedCount,
  };
}

/** 見えるテキストを持つ要素の文字の大きさ（px）。ignore・除外の要素は外す。 */
function measureFonts({ ignore, excluded }) {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!window.__layoutCheck.hasOwnText(el)) continue;
    if (el.getClientRects().length === 0) continue;
    if (ignore.some((s) => el.matches(s)) || excluded.some((s) => el.matches(s))) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    out.push({ selector: window.__layoutCheck.describe(el), px: parseFloat(cs.fontSize) });
  }
  return out;
}

/**
 * 押せる範囲。要素の中心と、上下左右の点（中心から half px）が、自分（または子）に当たるかを測る。
 * 画面の外の点は測らない（tested: false）。画面の外にしか無い要素（閉じたドロワーの中）は、すべての点が測れないので数えない。
 */
function measureTaps({ selector, half, excluded }) {
  const out = [];
  // 画面の端の外（elementFromPoint が null を返す点）は測らない。ページの末尾で要素を中央に寄せられないときに起きる。
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const inViewport = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  for (const el of document.querySelectorAll(selector)) {
    if (el.getClientRects().length === 0) continue;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const points = [[cx, cy], [cx - half, cy], [cx + half, cy], [cx, cy - half], [cx, cy + half]].map(([x, y]) => {
      const at = inViewport(x, y) ? document.elementFromPoint(x, y) : null;
      return { tested: at !== null, hit: at !== null && el.contains(at) };
    });
    out.push({
      selector: window.__layoutCheck.describe(el),
      width: Math.round(r.width),
      height: Math.round(r.height),
      display: getComputedStyle(el).display,
      hasTextBefore: window.__layoutCheck.hasTextBefore(el),
      hasTextAfter: window.__layoutCheck.hasTextAfter(el),
      points,
      excluded: excluded.some((s) => el.matches(s)),
    });
  }
  return out;
}

/** Tab で止まった要素（フォーカス中）の計測。フォーカスを外した状態も測り、見えるフォーカスの変化を比べる。 */
function measureFocusStop({ focusExcluded, offscreenExcluded }) {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { body: true };
  const helpers = window.__layoutCheck;
  const focused = helpers.measureFocus(el);
  el.blur();
  const unfocused = helpers.measureFocus(el);
  el.focus({ preventScroll: true });
  const r = el.getBoundingClientRect();
  return {
    body: false,
    key: helpers.keyOf(el),
    selector: helpers.describe(el),
    rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    focused,
    unfocused,
    focusExcluded: focusExcluded.some((s) => el.matches(s)),
    offscreenExcluded: offscreenExcluded.some((s) => el.matches(s)),
  };
}

const TAP_SELECTOR = 'a[href], button, [role="button"], input, select, summary';

/**
 * 1 ページ・1 幅の計測。違反の配列を返す（page・path・width は呼び出し側が付ける）。
 * @param {object} args
 * @param {import("playwright-core").BrowserContext} args.context
 * @param {ReturnType<import("./rules.mjs").normalizeConfig>} args.config
 * @param {{ path: string, name: string }} args.pageInfo
 * @param {number} args.width
 */
export async function checkPageAtWidth({ context, config, pageInfo, width }) {
  const violations = [];
  const push = (rule, selector, value, message) => {
    violations.push({ page: pageInfo.name, path: pageInfo.path, width, rule, selector, value, message });
  };
  const exclusions = (rule) => exclusionsFor(config.exclusions, rule, pageInfo.path);
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const enabled = config.rules;

  const page = await context.newPage();
  try {
    await page.addInitScript(installHelpers);
    await load(page, config, pageInfo, timeout);

    if (enabled["single-h1"]) {
      const problem = h1Problem(await page.evaluate(countVisibleH1));
      if (problem) push("single-h1", "html", "h1", problem);
    }

    if (enabled["no-horizontal-scroll"]) {
      const h = await page.evaluate(measureHorizontal, exclusions("no-horizontal-scroll"));
      if (hasHorizontalOverflow(h.scrollWidth, h.clientWidth) && (h.offenders.length > 0 || h.excludedCount === 0)) {
        const list = h.offenders.map((o) => `${o.selector}（右端 ${o.right}px）`).join(" / ");
        push(
          "no-horizontal-scroll",
          h.offenders[0]?.selector ?? "html",
          `scrollWidth ${h.scrollWidth}px > ${h.clientWidth}px`,
          list ? `はみ出している要素: ${list}` : "はみ出している要素を特定できず（画面の外に広がる要素を探す）",
        );
      }
    }

    if (enabled["min-font-size"]) {
      const fonts = await page.evaluate(measureFonts, {
        ignore: config.minFontSize.ignoreSelectors,
        excluded: exclusions("min-font-size"),
      });
      for (const f of fonts) {
        if (!fontSizeOk(f.px, config.minFontSize.min)) {
          push("min-font-size", f.selector, `${f.px}px`, `${config.minFontSize.min}px 未満の文字（装飾だけなら ignoreSelectors か除外に理由つきで書く）`);
        }
      }
    }

    if (enabled["tap-target"] && width < config.tapTarget.maxWidth) {
      const half = tapHalfOffset(config.tapTarget.minSize);
      const taps = await page.evaluate(measureTaps, { selector: TAP_SELECTOR, half, excluded: exclusions("tap-target") });
      for (const t of taps) {
        if (t.excluded) continue;
        if (isInlineLink({ display: t.display, hasTextBefore: t.hasTextBefore, hasTextAfter: t.hasTextAfter })) continue;
        if (!tapTargetOk(t.points)) {
          const min = config.tapTarget.minSize;
          push("tap-target", t.selector, `${t.width}x${t.height}px`, `押せる範囲が ${min}×${min}px 未満（中心から上下左右 ${half}px が自分に当たらない）`);
        }
      }
    }

    if (enabled["focus-visible"] || enabled["no-offscreen-focus"]) {
      await walkTabStops(page, config, pageInfo, push, enabled);
    }
  } finally {
    await page.close();
  }

  if (enabled["menu-esc"] && config.menuEsc && width < config.menuEsc.breakpoint) {
    const menuPage = await context.newPage();
    try {
      await menuPage.addInitScript(installHelpers);
      await load(menuPage, config, pageInfo, timeout);
      await checkMenuEsc(menuPage, config, push);
    } finally {
      await menuPage.close();
    }
  }
  return violations;
}

async function load(page, config, pageInfo, timeout) {
  const url = `${config.baseURL}${pageInfo.path}`;
  const response = await page.goto(url, { waitUntil: "load", timeout });
  if (!response || !response.ok()) {
    throw new LayoutCheckRunError(`ページを開けなかった: ${url}（${response ? `HTTP ${response.status()}` : "応答なし"}）。baseURL と pages を確かめる`);
  }
  if (config.readySelector) {
    await page.waitForSelector(config.readySelector, { state: "attached", timeout });
  }
}

/** Tab で順に止まる要素を、最大 maxStops 回たどる。最初の要素に戻ったら終わる。 */
async function walkTabStops(page, config, pageInfo, push, enabled) {
  const focusExcluded = exclusionsFor(config.exclusions, "focus-visible", pageInfo.path);
  const offscreenExcluded = exclusionsFor(config.exclusions, "no-offscreen-focus", pageInfo.path);
  let firstKey = null;
  for (let i = 0; i < config.focus.maxStops; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(measureFocusStop, { focusExcluded, offscreenExcluded });
    if (stop.body) break;
    if (firstKey === null) firstKey = stop.key;
    else if (stop.key === firstKey) break;

    if (enabled["focus-visible"] && !stop.focusExcluded && !isFocusVisible(stop.focused, stop.unfocused)) {
      push(
        "focus-visible",
        stop.selector,
        `outline ${stop.focused.outlineStyle} ${stop.focused.outlineWidth}px`,
        "フォーカス中に見える表示が無い（outline・box-shadow・枠線の色のどれも変わらない）",
      );
    }
    if (enabled["no-offscreen-focus"] && !stop.offscreenExcluded && isOffscreen(stop.rect, stop.viewportWidth, stop.viewportHeight)) {
      push(
        "no-offscreen-focus",
        stop.selector,
        `left ${Math.round(stop.rect.left)}px`,
        "画面の外にある要素にフォーカスが入る（閉じたドロワーの中の項目など。inert を付けて Tab で止まらないようにする）",
      );
    }
  }
}

/** スマホ幅でメニューを開き、Esc で閉じて、メニューボタンの aria-expanded が false に戻り、フォーカスが戻ることを確かめる。 */
async function checkMenuEsc(page, config, push) {
  const selector = config.menuEsc.buttonSelector;
  const button = page.locator(selector).first();
  if ((await button.count()) === 0 || !(await button.isVisible())) {
    push("menu-esc", selector, "見えない", "スマホ幅でメニューボタンが見えない（menuEsc.buttonSelector を確かめる）");
    return;
  }
  await button.click();
  try {
    await page.waitForFunction((s) => document.querySelector(s)?.getAttribute("aria-expanded") === "true", selector, { timeout: 2000 });
  } catch {
    push("menu-esc", selector, "aria-expanded が true にならない", "メニューが開かない（クリックで aria-expanded が true にならない）");
    return;
  }
  await page.keyboard.press("Escape");
  try {
    await page.waitForFunction((s) => document.querySelector(s)?.getAttribute("aria-expanded") === "false", selector, { timeout: 2000 });
  } catch {
    // 閉じなかった場合は、下で状態を読んで違反にする
  }
  const state = await page.evaluate((s) => {
    const b = document.querySelector(s);
    return { expanded: b?.getAttribute("aria-expanded") ?? null, focused: document.activeElement === b };
  }, selector);
  if (state.expanded !== "false") {
    push("menu-esc", selector, `aria-expanded=${state.expanded}`, "Esc でメニューが閉じない（メニューボタンの aria-expanded が false に戻らない）");
  } else if (!state.focused) {
    push("menu-esc", selector, "focus", "Esc で閉じたあと、フォーカスがメニューボタンに戻らない");
  }
}
