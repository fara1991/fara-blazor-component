// レイアウトの自動計測（kit 共通）。各サイトは、設定（layout-check.config.mjs）と、配信中のサイトの URL を渡して使う。
//   import { runLayoutCheck } from "../external/fara-site-kit/tools/layout-check/index.mjs";
// 依存は playwright-core のみ（各サイトの devDependency）。読み込みは実行のときだけ行うので、判定の関数（rules.mjs）は依存なしで使える。
// 使い方と設定の例は docs/layout-check.md。

import { LayoutCheckRunError, normalizeConfig } from "./rules.mjs";
import { checkPageAtWidth } from "./browser.mjs";

export * from "./rules.mjs";

async function loadChromium() {
  try {
    const playwright = await import("playwright-core");
    return playwright.chromium;
  } catch {
    throw new LayoutCheckRunError("playwright-core が入っていない。サイトの devDependency に入れる（npm install -D playwright-core）");
  }
}

/**
 * 設定どおりに計測する。違反は配列で返す（違反が無ければ空）。
 * 設定の誤りは LayoutCheckConfigError、ブラウザ・ページの失敗は LayoutCheckRunError を投げる。
 * @param {unknown} rawConfig 設定（default export のオブジェクト）
 * @returns {Promise<{ violations: object[], runs: number, config: object }>}
 */
export async function runLayoutCheck(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const chromium = await loadChromium();

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: config.browser.channel });
  } catch (error) {
    const first = String(error?.message ?? error).split("\n")[0];
    throw new LayoutCheckRunError(
      `ブラウザを起動できなかった（${first}）。CI・初回は「npx playwright-core install --with-deps chromium」。` +
        "ローカルで入れたくないときは browser.channel に \"msedge\" を書く（Edge が入っている必要がある）",
    );
  }

  const violations = [];
  let runs = 0;
  try {
    for (const width of config.viewports) {
      // reducedMotion 既定 true: prefers-reduced-motion の CSS（アニメーション・スムーススクロールの停止）を効かせて測る
      const context = await browser.newContext({
        viewport: { width, height: config.viewportHeight },
        reducedMotion: config.reducedMotion ? "reduce" : "no-preference",
      });
      try {
        for (const pageInfo of config.pages) {
          violations.push(...(await checkPageAtWidth({ context, config, pageInfo, width })));
          runs += 1;
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { violations, runs, config };
}
