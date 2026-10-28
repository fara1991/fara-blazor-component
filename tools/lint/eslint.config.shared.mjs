// Fara のサイト共通の ESLint 設定（flat config）。kit の tools/lint/ にあり、各サイトが submodule 越しに読む。
//
// 使い方（各サイトのルートの eslint.config.mjs）:
//   import shared, { createSharedConfig } from "./external/fara-site-kit/tools/lint/eslint.config.shared.mjs";
//   export default [
//     ...shared,                                   // Node の JS（**/*.{js,mjs,cjs}）
//     ...createSharedConfig({                      // ブラウザの JS を足す場合
//       files: ["wwwroot/js/**/*.js"],
//       environments: ["browser"],
//       sourceType: "script",
//     }),
//   ];
//
// ルールは全サイトで同じ（sharedRules）。サイト固有の例外は、サイトの設定の overrides に理由つきで書く（eslint-disable では書かない）。
// 依存: eslint と globals（kit の devDependency。各サイトも自分の devDependency に入れる）。

import globals from "globals";

/** 全サイトで同じルール。変えるときは kit で変えて、各サイトが submodule を上げる。 */
export const sharedRules = {
  // 空の catch・空のブロックは、コメントを 1 行でも書けば許す（ESLint は、コメントだけのブロックを空と数えない）。
  "no-empty": ["error", { allowEmptyCatch: false }],
  "no-unused-vars": [
    "error",
    { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" },
  ],
  "no-undef": "error",
  eqeqeq: ["error", "always"],
  "no-constant-condition": ["error", { checkLoops: "allExceptWhileTrue" }],
  "no-fallthrough": "error",
  "no-prototype-builtins": "error",
  "no-useless-catch": "error",
};

const ENVIRONMENTS = {
  node: globals.node,
  browser: globals.browser,
};

/** 全体の無視（依存・生成物・ビルドの出力）。 */
export const sharedIgnores = {
  ignores: ["**/node_modules/**", "**/bin/**", "**/obj/**", "**/publish/**", "**/artifacts/**", ".wrangler/**"],
};

/**
 * 指定したファイルに、共通のルールと環境（グローバル）を当てた設定を返す。
 * @param {object} options
 * @param {string[]} [options.files] 対象の glob
 * @param {("node"|"browser")[]} [options.environments] 使うグローバル（node か browser）
 * @param {"module"|"script"} [options.sourceType] ES モジュールか、古い形の script（HTML の <script> で読む JS）
 * @param {Record<string, "readonly"|"writable"|"off">} [options.extraGlobals] 環境に無い実行環境のグローバル（例: Cloudflare Workers の HTMLRewriter）。理由をサイトの設定に書く
 */
export function createSharedConfig({
  files = ["**/*.{js,mjs,cjs}"],
  environments = ["node"],
  sourceType = "module",
  extraGlobals = {},
} = {}) {
  const globalsForEnvironment = { ...extraGlobals };
  for (const name of environments) {
    if (!ENVIRONMENTS[name]) throw new Error(`eslint 共通設定: 未知の環境 "${name}"（node か browser）`);
    Object.assign(globalsForEnvironment, ENVIRONMENTS[name]);
  }
  return [
    {
      files,
      languageOptions: { ecmaVersion: "latest", sourceType, globals: globalsForEnvironment },
      rules: sharedRules,
    },
  ];
}

/** 既定: Node の JS（tools・worker・build・tests など）。 */
export default [sharedIgnores, ...createSharedConfig({ files: ["**/*.{js,mjs,cjs}"], environments: ["node"] })];
