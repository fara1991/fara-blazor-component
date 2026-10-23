#!/usr/bin/env node
// kit のリポジトリの Actions「Set maintenance (all sites)」(.github/workflows/set-maintenance-all.yml) から呼ぶ。
// 4 サイトの deploy ワークフローを、tools/maintenance.mjs の set で一括して起動する(dev 先行・失敗で中断・起動 run の特定・本番の確認は set のもの)。
//
// 入力は環境変数だけで受ける(ワークフローの inputs をシェルに埋め込まない):
//   TARGET_BRANCH            develop(各サイトの dev) / master(各サイトの本番) / migration/wasm(avatar の WASM 移行用の確認用)
//   MAINTENANCE_MODE_INPUT   空 / true / notice / false
//   MAINTENANCE_MESSAGE_INPUT 文面(200 文字まで・制御文字なし。空 = 変更しない)
//   SITES_INPUT              all または pokemon,avatar,bot,portfolio のカンマ区切り
//   GH_TOKEN                 gh の認証(SITES_DISPATCH_TOKEN。ここでは読まない。gh が使う)
//   GITHUB_STEP_SUMMARY      あれば、結果(各サイトの run の URL と結果)を追記する
// 終了コード: 0 = 成功、1 = 失敗・中断、2 = 入力の誤り。

import { appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, loadSites, selectTargets, validateMessage, UsageError } from "./maintenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** target_branch と set の --env の対応。 */
export const ENV_FOR_BRANCH = { develop: "dev", master: "production", "migration/wasm": "wasm-dev" };
const MODES = ["true", "notice", "false"];

/**
 * 入力を検査して、set に渡す引数を作る(検査に通らなければ UsageError)。
 * @returns {{ argv: string[], envName: string, sites: string[], summary: {branch: string, mode: string, message: string, sites: string} }}
 */
export function planFromEnv(env, sitesPath = join(here, "maintenance-sites.json")) {
  const branch = String(env.TARGET_BRANCH ?? "");
  if (!Object.hasOwn(ENV_FOR_BRANCH, branch)) throw new UsageError(`target_branch は ${Object.keys(ENV_FOR_BRANCH).join(" / ")} のどれかです`);
  const envName = ENV_FOR_BRANCH[branch];

  const mode = String(env.MAINTENANCE_MODE_INPUT ?? "");
  if (mode !== "" && !MODES.includes(mode)) throw new UsageError(`maintenance_mode は 空 / ${MODES.join(" / ")} のどれかです`);
  const message = String(env.MAINTENANCE_MESSAGE_INPUT ?? "");
  if (message !== "") validateMessage(message);
  if (mode === "" && message === "") throw new UsageError("maintenance_mode か maintenance_message のどちらかを入れてください(両方が空だと、変えるものがありません)");
  if (envName === "production" && mode === "") throw new UsageError("本番(target_branch=master)では maintenance_mode が必須です(message だけの変更は develop だけ)");

  const sitesList = loadSites(sitesPath);
  const known = sitesList.map((s) => s.name);
  const raw = String(env.SITES_INPUT ?? "all").trim() || "all";
  let names = [];
  if (raw !== "all") {
    names = raw.split(",").map((s) => s.trim());
    if (names.some((n) => !known.includes(n))) throw new UsageError(`sites は all か、${known.join(",")} のカンマ区切りです(入力: ${JSON.stringify(raw.slice(0, 80))})`);
    names = [...new Set(names)];
  }

  const argv = ["set", "--env", envName];
  if (names.length > 0) argv.push("--site", names.join(","));
  if (mode !== "") argv.push("--mode", mode);
  if (message !== "") argv.push("--message", message);
  argv.push("--apply");
  // 本番の確認は、このワークフローでは GitHub の Environment の承認(必須レビュワー)が担う。set が求める再入力は、承認された対象のサイト名から作る
  const targets = selectTargets(sitesList, { env: envName, sites: names }, { needWorkflow: true });
  if (envName === "production") argv.push("--confirm", `production ${[...new Set(targets.map((t) => t.site))].sort().join(",")}`);
  return { argv, envName, sites: [...new Set(targets.map((t) => t.site))], summary: { branch, mode, message, sites: raw } };
}

const fence = (text) => text.replaceAll("`", "'");

/** @returns {Promise<number>} 終了コード */
export async function runAll(env, deps = {}, { validateOnly = false } = {}) {
  const out = [];
  const log = (t = "") => { out.push(String(t)); (deps.log ?? console.log)(String(t)); };
  const error = (t = "") => { out.push(String(t)); (deps.error ?? console.error)(String(t)); };
  let code;
  let plan;
  try {
    plan = planFromEnv(env, deps.sitesPath);
    if (validateOnly) {
      log(`入力は正しいです: --env ${plan.envName} / サイト ${plan.sites.join(", ")} / mode=${plan.summary.mode || "(変更なし)"}`);
      return 0;
    }
    if (!env.GH_TOKEN) throw new Error("GH_TOKEN がありません。kit のリポジトリの Settings → Secrets and variables → Actions に SITES_DISPATCH_TOKEN を登録してください(docs/maintenance-cli.md)");
    code = await main(plan.argv, { env: {}, ...deps, log, error, prompt: async () => null });
  } catch (e) {
    error(e instanceof UsageError ? `入力の誤り: ${e.message}` : `失敗: ${e.message}`);
    code = e instanceof UsageError ? 2 : 1;
  }
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) {
    const s = plan?.summary;
    const lines = [
      `### メンテナンス表示を一括で切り替え (${code === 0 ? "成功" : "失敗・中断"})`,
      s ? `- 対象: \`${fence(s.branch)}\`(${plan.envName}) / サイト: ${plan.sites.join(", ")}` : "- 入力を検査できませんでした",
      s ? `- 設定した値: MAINTENANCE_MODE=\`${s.mode || "(変更なし)"}\` / MAINTENANCE_MESSAGE=\`${fence(s.message) || "(変更なし)"}\`` : "",
      "",
      "```",
      ...out.map(fence),
      "```",
      "",
    ];
    try { appendFileSync(file, lines.join("\n")); } catch { /* サマリーに書けなくても、結果は標準出力にある */ }
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAll(process.env, {}, { validateOnly: process.argv.includes("--validate-only") }).then((code) => { process.exitCode = code; });
}
