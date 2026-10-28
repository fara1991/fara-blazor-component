#!/usr/bin/env node
// 複数サイトのメンテナンス表示（Worker の変数 MAINTENANCE_MODE / MAINTENANCE_MESSAGE）を、まとめて見る・切り替える CLI。依存なし（Node 22 の fetch と、GitHub CLI の gh）。
// 使い方は docs/maintenance-cli.md。
//
//   node tools/maintenance.mjs status [--env dev|production|all] [--site 名前]...
//   node tools/maintenance.mjs set --env dev|production|all [--site 名前]... [--mode true|notice|false] [--message "文面"] [--apply] [--confirm "production サイト名,..."]
//
// status: Cloudflare API の GET だけ（書き込みはしない）。CLOUDFLARE_API_TOKEN（Workers Scripts の Read 権限）と CLOUDFLARE_ACCOUNT_ID が要る。
// set   : Cloudflare API には書き込まない。各サイトのリポジトリの deploy ワークフローを gh workflow run で手動実行（workflow_dispatch）し、
//         入力 maintenance_mode / maintenance_message を渡す。ワークフローが wrangler deploy --var MAINTENANCE_MODE:... で反映する（雛形は docs/maintenance-cli.md）。
//         Cloudflare のトークンは使わない（gh のログインだけ）。
//         既定はドライラン（実行する gh のコマンドを表示するだけ）。--apply で実行。--plan は、事前確認だけ(読み取り)をして計画を表示する。
//         事前確認: ワークフローのファイルが ref の上で入力 maintenance_mode(と maintenance_message)を受け取れる版かを、GET contents で見て、受け取れないサイトは警告つきで飛ばす
//         (PAT の Contents: read が無く確かめられないときは、従来どおり dispatch して、失敗したら案内する)。すべて飛ばされたら失敗(--allow-empty なら成功)。
//         順序: dev をすべて起動 → それぞれの結果を待って表示 → 全部成功したら production（サイトごとに起動して結果を待つ）。1 つでも失敗したら、そこで中断する。
//         production を含む --apply は、--mode が必須で、--confirm に「production サイト名（アルファベット順・カンマ区切り）」の再入力が必須（master の最新が wrangler deploy で公開される）。
// 終了コード: 0 = 成功（ドライランを含む）、1 = 失敗・中断・確認の不一致、2 = 使い方の誤り。

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MODE_VAR = "MAINTENANCE_MODE";
export const MESSAGE_VAR = "MAINTENANCE_MESSAGE";
export const LEGACY_VAR = "MAINTENANCE";
/** ワークフロー（workflow_dispatch）の入力名。docs/maintenance-cli.md の雛形と合わせる。 */
export const INPUT_MODE = "maintenance_mode";
export const INPUT_MESSAGE = "maintenance_message";
export const MAX_MESSAGE = 200;
export const MODES = ["true", "notice", "false"];
const API = "https://api.cloudflare.com/client/v4";
/** Cloudflare API の 1 回の待ち時間。 */
const API_TIMEOUT_MS = 20000;
/** 起動した実行を探すとき、起動の時刻から見る余裕（時計のずれ）。 */
const RUN_CLOCK_SLACK_MS = 5 * 60 * 1000;
/** 起動した実行を探す回数と間隔（GitHub の一覧に出るまでの待ち）。 */
const RUN_LOOKUP_TRIES = 10;
const RUN_LOOKUP_INTERVAL_MS = 3000;
const here = dirname(fileURLToPath(import.meta.url));

export class UsageError extends Error {}
/** そのサイトのその ref のワークフローが、渡す入力を受け取れない版だった(dispatch が HTTP 422 Unexpected inputs)。失敗にせず、警告つきで飛ばす。 */
export class SkipSite extends Error {}

/** 環境。dev = develop 用、production = 本番(master)。 */
export const ENVS = ["dev", "production"];

// ---- 引数 ----

const FLAGS_BOOL = new Set(["--apply", "--plan", "--allow-empty"]);
const FLAGS_WITH_VALUE = new Set(["--env", "--site", "--mode", "--message", "--confirm", "--sites-file"]);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, env: undefined, sites: [], mode: undefined, message: undefined, confirm: undefined, apply: false, plan: false, allowEmpty: false, sitesFile: undefined };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (FLAGS_BOOL.has(flag)) { if (flag === "--apply") opts.apply = true; else if (flag === "--plan") opts.plan = true; else opts.allowEmpty = true; continue; }
    if (!FLAGS_WITH_VALUE.has(flag)) throw new UsageError(`不明なオプションです: ${flag}`);
    const value = rest[++i];
    if (value === undefined) throw new UsageError(`${flag} に値がありません`);
    switch (flag) {
      case "--env": opts.env = value; break;
      case "--site": opts.sites.push(...value.split(",").map((s) => s.trim()).filter(Boolean)); break;
      case "--mode": opts.mode = value; break;
      case "--message": opts.message = value; break;
      case "--confirm": opts.confirm = value; break;
      case "--sites-file": opts.sitesFile = value; break;
    }
  }
  return opts;
}

export function validateMessage(message) {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(message)) throw new UsageError("--message に制御文字（改行を含む）は使えません");
  if (message.length === 0) throw new UsageError("--message が空です（空の文面は渡せません。文面を変えないなら指定しない）");
  if (Array.from(message).length > MAX_MESSAGE) throw new UsageError(`--message は ${MAX_MESSAGE} 文字までです（Worker が切り捨てるため）`);
}

// ---- 対象の選択 ----

const SAFE = /^[\w.\-/]+$/;

export function loadSites(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data?.sites)) throw new UsageError(`${path}: sites の配列がありません`);
  for (const s of data.sites) {
    if (!s?.name || typeof s.workers !== "object" || s.workers === null) throw new UsageError(`${path}: name と workers が必要です`);
    for (const [env, w] of Object.entries(s.workers)) {
      if (!ENVS.includes(env) || typeof w !== "string" || !w) throw new UsageError(`${path}: ${s.name} の workers が不正です（production / dev の Worker 名）`);
    }
    for (const [env, wf] of Object.entries(s.workflows ?? {})) {
      if (!ENVS.includes(env) || !SAFE.test(wf?.file ?? "") || !SAFE.test(wf?.ref ?? "")) throw new UsageError(`${path}: ${s.name} の workflows.${env} が不正です（file と ref）`);
    }
    if (s.workflows && !/^[\w.-]+\/[\w.-]+$/.test(s.repo ?? "")) throw new UsageError(`${path}: ${s.name} の repo は owner/name の形で書いてください`);
  }
  return data.sites;
}

/** @returns {{site: string, env: "production"|"dev", worker: string, repo?: string, workflow?: {file: string, ref: string}}[]} */
export function selectTargets(sites, { env, sites: names }, { needWorkflow = false } = {}) {
  if (![...ENVS, "all"].includes(env)) throw new UsageError("--env は dev・production・all のどれかです");
  const known = new Set(sites.map((s) => s.name));
  for (const n of names) if (!known.has(n)) throw new UsageError(`不明なサイトです: ${n}（${[...known].join("・")}）`);
  const envs = env === "all" ? ["dev", "production"] : [env];
  const targets = [];
  for (const s of sites) {
    if (names.length > 0 && !names.includes(s.name)) continue;
    for (const e of envs) {
      if (needWorkflow) {
        if (!s.workflows?.[e]) {
          // サイトを名指ししたのに無いときは誤り。名指ししていない(全サイト)ときは、そのサイトを飛ばす
          if (env !== "all" && names.includes(s.name)) throw new UsageError(`${s.name} の ${e} のワークフローが maintenance-sites.json にありません`);
          continue;
        }
        targets.push({ site: s.name, env: e, worker: s.workers[e], repo: s.repo, workflow: s.workflows[e] });
      } else if (s.workers[e]) {
        targets.push({ site: s.name, env: e, worker: s.workers[e] });
      }
    }
  }
  if (targets.length === 0) throw new UsageError("対象がありません");
  return targets;
}

// ---- 表示用 ----

/** 端末の制御シーケンスの注入を避けるため、制御文字を外して JSON 文字列にする。 */
// eslint-disable-next-line no-control-regex
export const printable = (v) => (v === null ? "(未設定)" : JSON.stringify(String(v).replace(/[\u0000-\u001f\u007f]/g, " ")));

function makeIo({ env, log, error }) {
  const secrets = [env.CLOUDFLARE_API_TOKEN].filter((s) => typeof s === "string" && s.length >= 4);
  const redact = (text) => secrets.reduce((t, s) => t.split(s).join("***"), String(text));
  return { log: (t = "") => log(redact(t)), error: (t = "") => error(redact(t)) };
}

// ---- status（Cloudflare API の GET だけ） ----

function makeApi({ token, accountId, fetchImpl }) {
  const url = (worker) => `${API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/settings`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  return {
    /** @returns {Promise<{missing: boolean, bindings: object[]}>} */
    async getSettings(worker) {
      const res = await fetchImpl(url(worker), { method: "GET", headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (res.status === 404) return { missing: true, bindings: [] };
      if (!res.ok) {
        let detail = "";
        try { detail = ((await res.json())?.errors ?? []).map((e) => `${e?.code ?? ""} ${e?.message ?? ""}`.trim()).join("; "); } catch { /* 本文なし */ }
        const hint = res.status === 401 || res.status === 403 ? "（API トークンの権限（Workers Scripts の Read）・有効期限・アカウント ID を確かめてください）" : "";
        throw new Error(`設定を取得できませんでした: HTTP ${res.status}${detail ? ` ${detail}` : ""}${hint}`);
      }
      const body = await res.json();
      if (body?.success === false || !Array.isArray(body?.result?.bindings)) throw new Error("設定を取得できませんでした: 想定しない応答です");
      return { missing: false, bindings: body.result.bindings };
    },
  };
}

/** 表示用: 変数の値。plain_text は text、それ以外は (種類)、無いときは null。 */
export function describeVar(bindings, name) {
  const b = bindings.find((x) => x?.name === name);
  if (!b) return null;
  if (b.type === "plain_text") return typeof b.text === "string" ? b.text : "";
  return `(${b.type})`;
}

async function runStatus(targets, api, io) {
  let failed = 0;
  const rows = [["サイト", "環境", "Worker", MODE_VAR, MESSAGE_VAR, "備考"]];
  for (const t of targets) {
    try {
      const s = await api.getSettings(t.worker);
      if (s.missing) {
        rows.push([t.site, t.env, t.worker, "-", "-", "Worker が見つかりません（名前かアカウントを確かめる）"]);
        failed++;
        continue;
      }
      const legacy = describeVar(s.bindings, LEGACY_VAR) !== null;
      rows.push([t.site, t.env, t.worker, printable(describeVar(s.bindings, MODE_VAR)), printable(describeVar(s.bindings, MESSAGE_VAR)), legacy ? `旧 ${LEGACY_VAR} が残っています（読まれないので無害。不要ならダッシュボードで削除）` : ""]);
    } catch (e) {
      rows.push([t.site, t.env, t.worker, "-", "-", `失敗: ${e.message}`]);
      failed++;
    }
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => Array.from(r[i]).length)));
  for (const r of rows) io.log(r.map((c, i) => c + " ".repeat(widths[i] - Array.from(c).length)).join("  ").trimEnd());
  // 1 件でも値を取得できなかった（Worker が無い・通信や権限の失敗）ときは終了コード 1。取得できた行は表に出す
  return failed > 0 ? 1 : 0;
}

// ---- set（gh workflow run） ----

/** 既定の gh 呼び出し。シェルを通さない（文面を引数としてそのまま渡す）。 */
export function defaultGh(args) {
  return new Promise((done) => {
    execFile("gh", args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.code === "ENOENT") return done({ code: 127, stdout: "", stderr: "gh（GitHub CLI）が見つかりません。インストールして gh auth login してください" });
      done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function defaultPrompt(question) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

/** gh workflow run の引数。入力は maintenance_mode / maintenance_message（指定したものだけ）。 */
export function dispatchArgs(t, opts) {
  const args = ["workflow", "run", t.workflow.file, "--repo", t.repo, "--ref", t.workflow.ref];
  if (opts.mode !== undefined) args.push("-f", `${INPUT_MODE}=${opts.mode}`);
  if (opts.message !== undefined) args.push("-f", `${INPUT_MESSAGE}=${opts.message}`);
  return args;
}

/** 表示用: 実行するコマンドを 1 行にする（空白・引用符を含む引数は " で囲む）。 */
export function displayCommand(args) {
  // eslint-disable-next-line no-control-regex
  return ["gh", ...args].map((a) => (/^[\w./:=@,-]+$/.test(a) ? a : JSON.stringify(a.replace(/[\u0000-\u001f\u007f]/g, " ")))).join(" ");
}

const listArgs = (t, user) => ["run", "list", "--repo", t.repo, "--workflow", t.workflow.file, "--branch", t.workflow.ref, "--event", "workflow_dispatch", "--user", user, "--limit", "20", "--json", "databaseId,url,createdAt,headBranch,headSha"];

async function listRuns(gh, t, user) {
  const r = await gh(listArgs(t, user));
  if (r.code !== 0) throw new Error(`実行の一覧を取得できませんでした: ${r.stderr.trim() || `gh の終了コード ${r.code}`}`);
  try {
    const v = JSON.parse(r.stdout);
    if (Array.isArray(v)) return v;
  } catch { /* 下へ */ }
  throw new Error("実行の一覧を読めませんでした（gh の出力が想定外）");
}

async function ghText(gh, args, what) {
  const r = await gh(args);
  const text = r.stdout.trim();
  if (r.code !== 0 || !text) throw new Error(`${what}を取得できませんでした: ${r.stderr.trim() || `gh の終了コード ${r.code}`}`);
  return text;
}

/**
 * ワークフローを起動し、起動した run（{id, url}）を返す。
 * 特定の条件: 起動前の一覧に無い・自分（gh のログインユーザー）が起動した workflow_dispatch・対象のブランチ・起動の少し前以降の作成・ブランチの先頭のコミット。
 * 条件に合う新しい run が 2 つ以上あるときは、取り違えを避けるために中断する。
 */
async function dispatch(t, opts, { gh, sleep, now }) {
  const user = await ghText(gh, ["api", "user", "--jq", ".login"], "gh のログインユーザー");
  // ブランチの先頭のコミット(Contents の Read 権限が要る)。取得できなければ、この照合だけ飛ばす(ほかの条件では絞る)
  const tipRes = await gh(["api", `repos/${t.repo}/commits/${t.workflow.ref}`, "--jq", ".sha"]);
  const tip = tipRes.code === 0 ? tipRes.stdout.trim() : "";
  const before = new Set((await listRuns(gh, t, user)).map((r) => r.databaseId));
  const startedAt = now();
  const r = await gh(dispatchArgs(t, opts));
  // 事前確認できなかった(403 など)とき、入力を受け取れない版は dispatch が 422 Unexpected inputs で返す。これは失敗ではなく「未対応」なので、飛ばす
  if (r.code !== 0 && /unexpected inputs/i.test(r.stderr)) {
    throw new SkipSite(`${t.repo} の ${t.workflow.ref} の ${t.workflow.file} は、入力 ${INPUT_MODE} / ${INPUT_MESSAGE} を受け取れない版(dispatch が HTTP 422 Unexpected inputs。新しい入力つきのワークフローが、その ref に入っていない)`);
  }
  if (r.code !== 0) {
    const noInput = /workflow_dispatch|could not find any workflow|not found/i.test(r.stderr);
    const hint = noInput
      ? `${t.repo} の ${t.workflow.ref} のワークフロー(${t.workflow.file})に、入力 ${INPUT_MODE} / ${INPUT_MESSAGE} を受け取る版がまだ入っていない可能性があります(新しい入力つきのワークフローが、その ref にマージされているか確かめる。未対応のサイトは --site で除く)`
      : `ワークフローに入力 ${INPUT_MODE} / ${INPUT_MESSAGE} が定義され、ref にそのワークフローがあるか確かめる`;
    throw new Error(`[${t.site}/${t.env}] gh workflow run が失敗しました: ${r.stderr.trim() || `終了コード ${r.code}`}(${hint})`);
  }
  const since = startedAt - RUN_CLOCK_SLACK_MS;
  for (let i = 0; i < RUN_LOOKUP_TRIES; i++) {
    const found = (await listRuns(gh, t, user)).filter((x) => !before.has(x.databaseId) && x.headBranch === t.workflow.ref && Date.parse(x.createdAt) >= since);
    if (found.length > 1) throw new Error(`起動したはずの実行が ${found.length} 件見つかりました（${found.map((x) => x.url).join(" ")}）。取り違えを避けるため中断します。GitHub の Actions で確認してください`);
    if (found.length === 1) {
      if (tip && found[0].headSha !== tip) throw new Error(`起動した実行のコミット（${String(found[0].headSha).slice(0, 7)}）が ${t.workflow.ref} の先頭（${tip.slice(0, 7)}）と違います: ${found[0].url}`);
      return { id: String(found[0].databaseId), url: found[0].url };
    }
    await sleep(RUN_LOOKUP_INTERVAL_MS);
  }
  throw new Error("起動した実行が見つかりませんでした（GitHub の Actions のページで確認してください）");
}

async function watch(t, run, { gh }) {
  const r = await gh(["run", "watch", run.id, "--repo", t.repo, "--exit-status", "--interval", "10"]);
  if (r.code !== 0) throw new Error(`実行が失敗しました: ${run.url}`);
}

/**
 * YAML（ワークフローのファイル）から、on.workflow_dispatch.inputs のキー（入力の名前）を取り出す。
 * 依存を増やさないための小さな行の解析（YAML の全部は読まない）:
 * - インデントで親子を追い、on → workflow_dispatch → inputs の直下のキーだけを数える。リストの項目の「- 」の後ろのキー（- run: ...）も、その桁で数える
 * - 値を同じ行に持つキー（`run: |`・`key: 値` の続き行）の下の、深い行は値の続きなので、キーとして見ない（ブロックスカラーや複数行の文字列の中の「maintenance_mode:」を数えない）
 * - コメントの行と空行は飛ばす
 * @returns {string[]}
 */
export function dispatchInputNames(yamlText) {
  const stack = []; // { indent, key }: いまの位置までの親のキー（indent は、キーの桁）
  const names = [];
  let valueIndent = null; // 値を同じ行に持つキーの桁。この桁より深い行は、その値の続き
  for (const raw of String(yamlText).split(/\r?\n/)) {
    if (/^\s*$/.test(raw)) continue;
    const lead = raw.length - raw.trimStart().length;
    if (valueIndent !== null) {
      if (lead > valueIndent) continue;
      valueIndent = null;
    }
    if (/^\s*#/.test(raw)) continue;
    // 先頭の「- 」（リストの項目。複数段も可）を読み飛ばし、キーの桁は「- 」の後ろ
    const m = /^(\s*)((?:-\s+)*)('[^']*'|"[^"]*"|[^\s#'"-][^:]*?):(?:\s+(.*))?$/.exec(raw);
    if (!m) continue;
    const indent = m[1].length + m[2].length;
    const key = m[3].replace(/^['"]|['"]$/g, "").trim();
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = stack.map((s) => s.key);
    stack.push({ indent, key });
    // 値（コメントだけ・アンカー・タグだけは、子を持つ書き方なので値とは数えない）
    const value = (m[4] ?? "").trim();
    if (value !== "" && !value.startsWith("#") && !/^[&!]\S*$/.test(value)) valueIndent = indent;
    if (path.length === 3 && path[0] === "on" && path[1] === "workflow_dispatch" && path[2] === "inputs") names.push(key);
  }
  return names;
}

/**
 * 事前確認: 対象のワークフローのファイルが、ref の上で、これから渡す入力(maintenance_mode / maintenance_message)を受け取れる版かを、
 * GET /repos/{repo}/contents/.github/workflows/{file}?ref={ref} で見る(PAT の Contents: read が要る)。
 * @returns {Promise<{ supported: boolean | null, reason: string }>} supported: true = 受け取れる、false = 受け取れない(飛ばす)、null = 確かめられなかった(権限なしなど。従来どおり dispatch して、失敗したら案内する)
 */
export async function preflight(t, opts, gh) {
  const need = [opts.mode !== undefined && INPUT_MODE, opts.message !== undefined && INPUT_MESSAGE].filter(Boolean);
  const r = await gh(["api", `repos/${t.repo}/contents/.github/workflows/${t.workflow.file}?ref=${encodeURIComponent(t.workflow.ref)}`, "-H", "Accept: application/vnd.github.raw"]);
  if (r.code === 0) {
    const names = dispatchInputNames(r.stdout);
    const missing = need.filter((n) => !names.includes(n));
    return missing.length === 0 ? { supported: true, reason: "" } : { supported: false, reason: `${t.repo} の ${t.workflow.ref} の ${t.workflow.file} に、入力 ${missing.join(" / ")} がまだ無い(新しい入力つきのワークフローが、その ref に入っていない)` };
  }
  if (/HTTP 404|Not Found/i.test(r.stderr)) return { supported: false, reason: `${t.repo} の ${t.workflow.ref} に ${t.workflow.file} が見つからない` };
  return { supported: null, reason: "事前確認できなかった(Contents の Read 権限が無いなど)" };
}

async function runSet(targets, io, opts, { gh, sleep, now, prompt, report }) {
  const label = (t) => `[${t.site}/${t.env}] ${t.repo} ${t.workflow.file} (${t.workflow.ref})`;
  // 本番へ文面だけを渡す操作は許さない（ワークフローの公開が、意図しない表示の切り替えにならないよう、mode を明示させる）
  if (targets.some((t) => t.env === "production") && opts.mode === undefined) throw new UsageError("production を含むときは --mode が必要です（--message だけの変更は dev だけで使えます）");
  const change = [opts.mode !== undefined && `${MODE_VAR}=${opts.mode}`, opts.message !== undefined && `${MESSAGE_VAR}=${printable(opts.message)}`].filter(Boolean).join(" ");

  // 事前確認(--apply と --plan のとき): 入力を受け取れない版のワークフローは、dispatch して失敗させず、警告つきで飛ばす
  const skipped = [];
  let todo = targets;
  if (opts.apply || opts.plan) {
    todo = [];
    for (const t of targets) {
      let pre;
      try { pre = await preflight(t, opts, gh); } catch (e) { pre = { supported: null, reason: `事前確認できなかった(${e.message})` }; }
      if (pre.supported === false) skipped.push({ t, reason: pre.reason });
      else todo.push(t);
    }
  }
  if (report) { report.skipped = skipped.map((x) => ({ site: x.t.site, env: x.t.env, reason: x.reason })); report.runnable = todo.length; report.ran = 0; }
  const dev = todo.filter((t) => t.env !== "production"); // dev は本番より先
  const prod = todo.filter((t) => t.env === "production");

  io.log(opts.apply ? `実行します（${change}）:` : `${opts.plan ? "計画" : "ドライラン"}（${change}）。次の順に実行します（まだ何も実行していません）:`);
  let n = 1;
  for (const t of [...dev, ...prod]) io.log(`  ${n++}. ${label(t)}
     ${displayCommand(dispatchArgs(t, opts))}`);
  for (const x of skipped) io.log(`  [警告] 飛ばす: [${x.t.site}/${x.t.env}] ${x.reason}`);
  if (prod.length > 0) io.log("  （production は、master の最新のコードが wrangler deploy で公開されます）");
  if (dev.length > 0 && prod.length > 0) io.log("  （dev をすべて起動して結果を待ち、全部成功したら production。1 つでも失敗したら中断）");
  if (todo.length === 0 && (opts.apply || opts.plan)) {
    io.error("実行できる対象がありません（すべて飛ばされました。何も反映されません）");
    return opts.allowEmpty ? 0 : 1;
  }
  if (!opts.apply) {
    io.log(opts.plan ? "（計画のみ。実行はしません）" : "実行するには --apply を付けてください");
    return 0;
  }

  if (prod.length > 0) {
    // 再入力する名前は、選んだ対象(飛ばす前)のサイト名
    const phrase = `production ${[...new Set(targets.filter((t) => t.env === "production").map((t) => t.site))].sort().join(",")}`;
    const answer = opts.confirm !== undefined ? opts.confirm : await prompt(`本番のワークフロー ${prod.length} 件を実行します（master の最新が wrangler deploy で公開されます）。続けるには「${phrase}」と入力してください: `);
    if (answer === null) { io.error(`本番を変更するには、対話の入力か --confirm "${phrase}" が必要です`); return 1; }
    if (answer.trim() !== phrase) { io.error("確認の入力が一致しないため、何も実行せずに終了します"); return 1; }
  }

  const deps = { gh, sleep, now };
  // dispatch が「入力を受け取れない版」(422)で返ったサイトは、警告つきで飛ばして続ける。ほかのエラーは例外のまま(中断)
  const dispatchOrSkip = async (t) => {
    try {
      return await dispatch(t, opts, deps);
    } catch (e) {
      if (!(e instanceof SkipSite)) throw e;
      skipped.push({ t, reason: e.message });
      if (report) { report.skipped.push({ site: t.site, env: t.env, reason: e.message }); report.runnable = Math.max(0, report.runnable - 1); }
      io.log(`  [警告] 飛ばす: [${t.site}/${t.env}] ${e.message}`);
      return null;
    }
  };
  try {
    const started = [];
    for (const t of dev) {
      const run = await dispatchOrSkip(t);
      if (!run) continue;
      io.log(`  ${label(t)}: 起動しました ${run.url}`);
      started.push({ t, run });
    }
    for (const { t, run } of started) {
      await watch(t, run, deps);
      io.log(`  ${label(t)}: 成功しました ${run.url}`);
      if (report) report.ran++;
    }
    for (const t of prod) {
      const run = await dispatchOrSkip(t);
      if (!run) continue;
      io.log(`  ${label(t)}: 起動しました ${run.url}`);
      await watch(t, run, deps);
      io.log(`  ${label(t)}: 成功しました ${run.url}`);
      if (report) report.ran++;
    }
  } catch (e) {
    io.error(`失敗: ${e.message}`);
    io.error("中断しました。これ以降の対象は実行していません（起動済みのものは GitHub の Actions で確認してください）");
    return 1;
  }
  const ranCount = report ? report.ran : todo.length - skipped.filter((x) => todo.includes(x.t)).length;
  if (ranCount === 0) {
    io.error("実行できた対象がありません（すべて飛ばされました。何も反映されません）");
    return opts.allowEmpty ? 0 : 1;
  }
  io.log(`成功しました${skipped.length > 0 ? `（飛ばしたサイトが ${skipped.length} 件あります。上の警告を確認）` : ""}。値は status で確認できます（反映に数十秒かかることがあります）`);
  return 0;
}

/** 本体。終了コードを返す（process.exit はしない）。 */
export async function main(argv, { env = process.env, fetchImpl = fetch, log = console.log, error = console.error, prompt = defaultPrompt, gh = defaultGh, sleep = defaultSleep, now = Date.now, sitesPath, report } = {}) {
  const io = makeIo({ env, log, error });
  try {
    const opts = parseArgs(argv);
    if (!["status", "set"].includes(opts.command)) throw new UsageError("使い方: maintenance.mjs status | set（docs/maintenance-cli.md）");
    if (opts.command === "status" && opts.env === undefined) opts.env = "all";
    if (opts.command === "set") {
      if (opts.env === undefined) throw new UsageError("set には --env dev|production|all が必要です");
      if (opts.mode === undefined && opts.message === undefined) throw new UsageError("set には --mode か --message が必要です");
      if (opts.mode !== undefined && !MODES.includes(opts.mode)) throw new UsageError(`--mode は ${MODES.join("・")} のどれかです`);
      if (opts.message !== undefined) validateMessage(opts.message);
    } else if (opts.mode !== undefined || opts.message !== undefined || opts.apply || opts.plan || opts.allowEmpty || opts.confirm !== undefined) {
      throw new UsageError("--mode / --message / --apply / --plan / --confirm は set だけで使えます");
    }
    const sites = loadSites(opts.sitesFile ?? sitesPath ?? join(here, "maintenance-sites.json"));
    if (opts.command === "set") {
      if (opts.apply && opts.plan) throw new UsageError("--apply と --plan は同時に使えません");
      return await runSet(selectTargets(sites, opts, { needWorkflow: true }), io, opts, { gh, sleep, now, prompt, report: report });
    }
    const targets = selectTargets(sites, opts);
    const token = env.CLOUDFLARE_API_TOKEN;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !accountId) throw new UsageError("status には環境変数 CLOUDFLARE_API_TOKEN（Workers Scripts の Read 権限）と CLOUDFLARE_ACCOUNT_ID が必要です");
    return await runStatus(targets, makeApi({ token, accountId, fetchImpl }), io);
  } catch (e) {
    if (e instanceof UsageError) { io.error(e.message); return 2; }
    io.error(`失敗: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
