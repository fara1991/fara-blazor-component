// 共通の ESLint 設定（tools/lint/eslint.config.shared.mjs）の確認。ファイルは作らず、Linter に文字列とファイル名を渡して検査する。
//   node --test tests/lint/shared-config.test.mjs
// 注意: files の glob は cwd を基準に照合される。npm test（リポジトリのルートで実行）から使う。
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Linter } from "eslint";
import shared, { createSharedConfig } from "../../tools/lint/eslint.config.shared.mjs";

const ROOT = process.cwd();
const linter = new Linter({ configType: "flat" });

/** 指定のファイル名（cwd の下の相対パス）で検査し、メッセージを返す。 */
function lint(code, relativePath, config = shared) {
  return linter.verify(code, config, { filename: join(ROOT, relativePath) });
}

/** no-undef（宣言の無い変数）のメッセージの、変数名の一覧。 */
function undefinedNames(messages) {
  return messages
    .filter((m) => m.ruleId === "no-undef")
    .map((m) => m.message.match(/'([^']+)'/)[1])
    .sort();
}

test("画面の JS（wwwroot/js）は Node のグローバル（process・require）を当てず、検出される", () => {
  const messages = lint('process.env.X;\nrequire("fs");\n', "site/wwwroot/js/x.js");
  assert.deepEqual(undefinedNames(messages), ["process", "require"]);
});

test("画面の JS（wwwroot/js）でブラウザのグローバル（document・window）は通る", () => {
  const messages = lint('document.title = "x";\nwindow.addEventListener("load", () => {});\n', "site/wwwroot/js/x.js");
  assert.deepEqual(undefinedNames(messages), []);
});

test("画面の JS（wwwroot/js）の import は、構文エラーにならない（既定は module）", () => {
  const messages = lint('import { a } from "./b.js";\nexport const c = a;\n', "site/wwwroot/js/x.js");
  assert.deepEqual(
    messages.filter((m) => m.fatal),
    [],
  );
});

test("Node の JS（worker・tools など）は、Node のグローバル（process・require）を通す", () => {
  for (const path of ["worker/x.js", "tools/x.mjs", "tests/x.mjs"]) {
    const messages = lint('console.log(process.env.X, require("fs"));\n', path);
    assert.deepEqual(undefinedNames(messages), [], path);
  }
});

test("Node の JS でも、宣言の無い変数は検出される（no-undef は有効）", () => {
  const messages = lint("missingName + 1;\n", "tools/x.mjs");
  assert.deepEqual(undefinedNames(messages), ["missingName"]);
});

test("createSharedConfig: ignores を渡したときだけ、その設定に ignores が付く", () => {
  const without = createSharedConfig({ files: ["a/**/*.js"], environments: ["node"] });
  assert.equal("ignores" in without[0], false);
  const withIgnores = createSharedConfig({ files: ["a/**/*.js"], ignores: ["a/skip/**"], environments: ["node"] });
  assert.deepEqual(withIgnores[0].ignores, ["a/skip/**"]);
});
