// kit 自身の JS に共通設定を当てる。共通の中身は tools/lint/eslint.config.shared.mjs（各サイトも同じものを読む）。
import shared, { createSharedConfig } from "./tools/lint/eslint.config.shared.mjs";

export default [
  ...shared,
  // Worker（worker/）は Node の環境に、Cloudflare の実行環境だけのグローバルを足す。
  // HTMLRewriter は Cloudflare Workers にだけある（Node には無い）。HTML を書き換える worker/maintenance.js が使う。
  ...createSharedConfig({
    files: ["worker/**/*.js"],
    environments: ["node"],
    extraGlobals: { HTMLRewriter: "readonly" },
  }),
  // 画面の JS（HTML の <script> で読む古い形の script。import も module もしない）。ブラウザのグローバルを使う。
  ...createSharedConfig({
    files: ["src/FaraSiteKit.Razor/wwwroot/js/**/*.js"],
    environments: ["browser"],
    sourceType: "script",
  }),
  // レイアウト計測の browser.mjs は、Node の中で page.evaluate に渡す関数（ブラウザで動く）を書く。そこだけ document・window を使える。
  ...createSharedConfig({
    files: ["tools/layout-check/browser.mjs"],
    environments: ["node", "browser"],
  }),
];
