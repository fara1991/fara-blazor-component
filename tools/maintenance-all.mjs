#!/usr/bin/env node
// kit のリポジトリの Actions「Set maintenance (all sites)」(.github/workflows/set-maintenance-all.yml) から呼ぶ。
// 4 サイトの deploy ワークフローを、tools/maintenance.mjs の set で一括して起動する(dev 系を先に全部・全成功後に本番、失敗で中断、起動 run の特定、本番の確認は set のもの)。
//
// 反映先は、対象ブランチのチェックボックス(boolean 入力)で選ぶ。サイトは常に 4 つすべて。
//   develop        → 各サイトの dev(develop ブランチ)
//   master         → 各サイトの本番(master ブランチ)
//
// 入力は環境変数だけで受ける(ワークフローの inputs をシェルに埋め込まない):
//   RUN_REF                   このワークフローを実行した kit の ref(github.ref)。refs/heads/master だけ許可
//   TARGET_DEVELOP / TARGET_MASTER   "true" か "false"(チェックボックス)。1 つ以上 true
//   MAINTENANCE_MODE_INPUT    空 / true / notice / false(master を選ぶときは必須)
//   MAINTENANCE_MESSAGE_INPUT 文面(200 文字まで・制御文字なし。空 = 変更しない)
//   GH_TOKEN                  gh の認証(SITES_DISPATCH_TOKEN。ここでは読まない。gh が使う)
//   GITHUB_STEP_SUMMARY       あれば、結果(各サイトの run の URL と結果、飛ばしたサイトと理由)を追記する
// 段階(--phase): validate = 入力の検査だけ / dev = 計画(事前確認)を全対象について表示してから、dev(develop)を実行 /
//                production = 本番(master)を実行 / all(既定)= dev → production。
// 事前確認で入力を受け取れない版と分かったサイトは、dispatch せず警告つきで飛ばす。計画の時点で、実行できる対象が 1 つも無ければ失敗。
// 終了コード: 0 = 成功、1 = 失敗・中断、2 = 入力の誤り。

import { appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, loadSites, selectTargets, validateMessage, UsageError } from "./maintenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** チェックボックスの入力と set の --env の対応(この順 = dev 系を先に、本番は最後)。 */
export const STAGES = [
  { input: "TARGET_DEVELOP", branch: "develop", envName: "dev" },
  { input: "TARGET_MASTER", branch: "master", envName: "production" },
];
/** 実行してよい kit の ref。master だけ(develop などの上のワークフローは、PAT を使う Environment の Deployment branches でも使えない想定)。 */
export const ALLOWED_RUN_REF = "refs/heads/master";
const MODES = ["true", "notice", "false"];

/**
 * 入力を検査して、段階ごとの set の引数を作る(検査に通らなければ UsageError)。
 * @returns {{ stages: {envName: string, branch: string, sites: string[], base: string[], confirm?: string}[], summary: {mode: string, message: string} }}
 */
export function planFromEnv(env, sitesPath = join(here, "maintenance-sites.json")) {
  const runRef = String(env.RUN_REF ?? "");
  if (runRef !== ALLOWED_RUN_REF) throw new UsageError(`このワークフローは master から実行してください(Use workflow from: master。実行した ref: ${JSON.stringify(runRef.slice(0, 80))})`);

  const picked = [];
  for (const st of STAGES) {
    const v = String(env[st.input] ?? "");
    if (v !== "true" && v !== "false") throw new UsageError(`${st.branch} のチェックボックスの値が不正です(${JSON.stringify(v.slice(0, 20))})`);
    if (v === "true") picked.push(st);
  }
  if (picked.length === 0) throw new UsageError("反映先のブランチ(develop / master)を 1 つ以上選んでください");

  const mode = String(env.MAINTENANCE_MODE_INPUT ?? "");
  if (mode !== "" && !MODES.includes(mode)) throw new UsageError(`maintenance_mode は 空 / ${MODES.join(" / ")} のどれかです`);
  const message = String(env.MAINTENANCE_MESSAGE_INPUT ?? "");
  if (message !== "") validateMessage(message);
  if (mode === "" && message === "") throw new UsageError("maintenance_mode か maintenance_message のどちらかを入れてください(両方が空だと、変えるものがありません)");
  if (picked.some((st) => st.envName === "production") && mode === "") throw new UsageError("master(本番)を選ぶときは maintenance_mode が必須です(message だけの変更は develop だけ)");

  const sitesList = loadSites(sitesPath);
  const stages = picked.map((st) => {
    const targets = selectTargets(sitesList, { env: st.envName, sites: [] }, { needWorkflow: true });
    const sites = [...new Set(targets.map((t) => t.site))];
    const base = ["set", "--env", st.envName];
    if (mode !== "") base.push("--mode", mode);
    if (message !== "") base.push("--message", message);
    base.push("--allow-empty");
    // 本番の確認は、このワークフローでは GitHub の Environment の承認(必須レビュワー)が担う。set が求める再入力は、選んだ対象のサイト名から作る
    return { envName: st.envName, branch: st.branch, sites, base, confirm: st.envName === "production" ? `production ${[...sites].sort().join(",")}` : undefined };
  });
  return { stages, summary: { mode, message } };
}

const fence = (text) => text.replaceAll("`", "'");

/**
 * @param {object} deps main に渡す依存(gh・sleep・now・log・error・sitesPath)
 * @param {{ phase?: "validate" | "dev" | "production" | "all" }} opts
 * @returns {Promise<number>} 終了コード
 */
export async function runAll(env, deps = {}, { phase = "all" } = {}) {
  const out = [];
  const log = (t = "") => { out.push(String(t)); (deps.log ?? console.log)(String(t)); };
  const error = (t = "") => { out.push(String(t)); (deps.error ?? console.error)(String(t)); };
  const skippedAll = [];
  const addSkipped = (list) => { for (const x of list ?? []) if (!skippedAll.some((y) => y.site === x.site && y.env === x.env && y.reason === x.reason)) skippedAll.push(x); };
  const plannedProd = { runnable: 0 };
  let code = 0;
  let plan;
  const call = async (stage, kind) => {
    const report = {};
    const argv = [...stage.base, kind === "plan" ? "--plan" : "--apply", ...(kind === "apply" && stage.confirm ? ["--confirm", stage.confirm] : [])];
    const c = await main(argv, { env: {}, ...deps, log, error, prompt: async () => null, report });
    return { c, report };
  };
  try {
    plan = planFromEnv(env, deps.sitesPath);
    if (phase === "validate") {
      log(`入力は正しいです: 反映先 ${plan.stages.map((s) => s.branch).join(" / ")} / mode=${plan.summary.mode || "(変更なし)"}`);
      return 0;
    }
    if (!env.GH_TOKEN) throw new Error("GH_TOKEN がありません。kit のリポジトリの Environment のシークレットに SITES_DISPATCH_TOKEN を登録してください(docs/maintenance-cli.md)");

    const devStages = plan.stages.filter((s) => s.envName !== "production");
    const prodStages = plan.stages.filter((s) => s.envName === "production");
    const doPlan = phase === "dev" || phase === "all";
    const toApply = [...(phase === "dev" || phase === "all" ? devStages : []), ...(phase === "production" || phase === "all" ? prodStages : [])];

    if (doPlan) {
      // 計画: 選んだすべての対象(本番を含む)を事前確認して、飛ばすサイトを先に見せる(本番の承認画面より前)
      log("== 計画(事前確認。まだ何も実行していません) ==");
      let runnable = 0;
      for (const stage of plan.stages) {
        const { c, report } = await call(stage, "plan");
        if (c !== 0) { code = c; break; }
        runnable += report.runnable ?? 0;
        addSkipped(report.skipped);
        if (stage.envName === "production") plannedProd.runnable += report.runnable ?? 0;
      }
      if (code === 0 && runnable === 0) {
        error("実行できる対象が 1 つもありません(すべて飛ばされました)。何も反映されません。各サイトの対象ブランチに、入力 maintenance_mode つきのワークフローが入っているか確かめてください");
        code = 1;
      }
    }
    if (code === 0) {
      log("== 実行 ==");
      let ran = 0;
      for (const stage of toApply) {
        const { c, report } = await call(stage, "apply");
        addSkipped(report.skipped); // 計画で出たものに加えて、dispatch が 422(入力を受け取れない版)で返って飛ばしたものも
        ran += report.ran ?? 0;
        if (c !== 0) { code = c; break; }
      }
      // すべて飛ばされて 1 つも反映されなかったら失敗。dev の段階では、あとで本番が実行できるなら失敗にしない
      const nothingLeft = phase !== "dev" || plannedProd.runnable === 0;
      if (code === 0 && toApply.length > 0 && ran === 0 && nothingLeft) {
        error("実行できた対象が 1 つもありません(すべて飛ばされました)。何も反映されません。各サイトの対象ブランチに、入力 maintenance_mode つきのワークフローが入っているか確かめてください");
        code = 1;
      }
    }
  } catch (e) {
    error(e instanceof UsageError ? `入力の誤り: ${e.message}` : `失敗: ${e.message}`);
    code = e instanceof UsageError ? 2 : 1;
  }
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) {
    const title = phase === "production" ? "本番(master)" : phase === "dev" ? "計画と dev 系" : "";
    const lines = [
      `### メンテナンス表示を一括で切り替え${title ? ` — ${title}` : ""} (${code === 0 ? "成功" : "失敗・中断"})`,
      plan ? `- 反映先: ${plan.stages.map((s) => `\`${s.branch}\`(${s.sites.join(", ")})`).join(" / ")}` : "- 入力を検査できませんでした",
      plan ? `- 設定した値: MAINTENANCE_MODE=\`${plan.summary.mode || "(変更なし)"}\` / MAINTENANCE_MESSAGE=\`${fence(plan.summary.message) || "(変更なし)"}\`` : "",
      ...(skippedAll.length > 0 ? ["", "**飛ばしたサイト(警告)**: 対象ブランチのワークフローが入力を受け取れない版のため、反映されません", ...skippedAll.map((x) => `- ${x.site} / ${x.env}: ${fence(x.reason)}`)] : []),
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
  const i = process.argv.indexOf("--phase");
  const phase = process.argv.includes("--validate-only") ? "validate" : i >= 0 ? process.argv[i + 1] : "all";
  if (!["validate", "dev", "production", "all"].includes(phase)) {
    console.error("--phase は validate / dev / production / all のどれかです");
    process.exitCode = 2;
  } else {
    runAll(process.env, {}, { phase }).then((code) => { process.exitCode = code; });
  }
}
