#!/usr/bin/env node
// 複数サイトの Worker の MAINTENANCE_MODE / MAINTENANCE_MESSAGE を、Cloudflare の API でまとめて変える CLI（依存なし。Node 22 の fetch のみ）。
// 使い方は docs/maintenance-cli.md。既定はドライラン（変更内容を表示するだけ）。--apply を付けたときだけ書き込む。
//
//   node tools/maintenance.mjs status [--env dev|production|all] [--site 名前]...
//   node tools/maintenance.mjs set --env dev|production|all [--site 名前]... [--mode true|notice|false] [--message "文面"] [--apply] [--confirm "文"]
//   node tools/maintenance.mjs rename --env ... [--site ...] [--overwrite] [--apply] [--confirm "文"]   （旧 MAINTENANCE → MAINTENANCE_MODE。移行用の一度きり）
//
// 環境変数: CLOUDFLARE_API_TOKEN（Workers Scripts の Edit 権限）、CLOUDFLARE_ACCOUNT_ID。トークンは出力に出さない。
// 終了コード: 0 = 成功（ドライラン・変更なしを含む）、1 = どれかの Worker で失敗・確認の不一致、2 = 使い方の誤り。
//
// バインディングの保全: PATCH /settings の bindings は「全部の置き換え」なので、現在の設定を取得し、
//   - 変える plain_text の変数だけ、新しい値で送る
//   - ほかの plain_text は、取得した値のまま送る
//   - それ以外（secret_text・Durable Object・assets・KV など。値が取れないものを含む）は { type: "inherit", name } で、いまの設定を引き継ぐ
// 書き込みのあと、もう一度取得して、変えるつもりのないバインディングが 1 つも減っていないこと・値が狙いどおりであることを確かめる。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MODE_VAR = "MAINTENANCE_MODE";
export const MESSAGE_VAR = "MAINTENANCE_MESSAGE";
export const LEGACY_VAR = "MAINTENANCE";
export const MAX_MESSAGE = 200;
const MODES = ["true", "notice", "false"];
const API = "https://api.cloudflare.com/client/v4";
const here = dirname(fileURLToPath(import.meta.url));

export class UsageError extends Error {}

// ---- 引数 ----

const FLAGS_WITH_VALUE = new Set(["--env", "--site", "--mode", "--message", "--confirm", "--sites-file", "--backup-dir"]);
const FLAGS_BOOL = new Set(["--apply", "--overwrite", "--no-backup"]);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, env: undefined, sites: [], mode: undefined, message: undefined, confirm: undefined, apply: false, overwrite: false, sitesFile: undefined, backupDir: undefined, backup: true };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (FLAGS_BOOL.has(flag)) {
      if (flag === "--apply") opts.apply = true;
      else if (flag === "--overwrite") opts.overwrite = true;
      else opts.backup = false;
      continue;
    }
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
      case "--backup-dir": opts.backupDir = value; break;
    }
  }
  return opts;
}

export function validateMessage(message) {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(message)) throw new UsageError("--message に制御文字（改行を含む）は使えません");
  if (Array.from(message).length > MAX_MESSAGE) throw new UsageError(`--message は ${MAX_MESSAGE} 文字までです（Worker が切り捨てるため）`);
}

// ---- 対象の選択 ----

export function loadSites(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data?.sites)) throw new UsageError(`${path}: sites の配列がありません`);
  for (const s of data.sites) {
    if (!s?.name || typeof s.workers !== "object" || s.workers === null) throw new UsageError(`${path}: name と workers が必要です`);
    for (const [env, w] of Object.entries(s.workers)) {
      if (!["production", "dev"].includes(env) || typeof w !== "string" || !w) throw new UsageError(`${path}: ${s.name} の workers が不正です（production / dev の Worker 名）`);
    }
  }
  return data.sites;
}

/** @returns {{site: string, env: "production"|"dev", worker: string}[]} */
export function selectTargets(sites, { env, sites: names }) {
  if (!["dev", "production", "all"].includes(env)) throw new UsageError("--env は dev・production・all のどれかです");
  const known = new Set(sites.map((s) => s.name));
  for (const n of names) if (!known.has(n)) throw new UsageError(`不明なサイトです: ${n}（${[...known].join("・")}）`);
  const envs = env === "all" ? ["dev", "production"] : [env];
  const targets = [];
  for (const s of sites) {
    if (names.length > 0 && !names.includes(s.name)) continue;
    for (const e of envs) if (s.workers[e]) targets.push({ site: s.name, env: e, worker: s.workers[e] });
  }
  if (targets.length === 0) throw new UsageError("対象の Worker がありません");
  return targets;
}

// ---- Cloudflare API ----

function makeApi({ token, accountId, fetchImpl }) {
  const url = (worker) => `${API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}/settings`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const fail = async (res, what) => {
    let detail = "";
    try {
      const body = await res.json();
      detail = (body?.errors ?? []).map((e) => `${e?.code ?? ""} ${e?.message ?? ""}`.trim()).join("; ");
    } catch { /* 本文なし */ }
    const hint = res.status === 401 || res.status === 403 ? "（API トークンの権限・有効期限・アカウント ID を確かめてください）" : "";
    return new Error(`${what}: HTTP ${res.status}${detail ? ` ${detail}` : ""}${hint}`);
  };
  return {
    /** @returns {Promise<{missing: boolean, bindings: object[]}>} */
    async getSettings(worker) {
      const res = await fetchImpl(url(worker), { headers, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return { missing: true, bindings: [] };
      if (!res.ok) throw await fail(res, "設定を取得できませんでした");
      const body = await res.json();
      if (body?.success === false || !Array.isArray(body?.result?.bindings)) throw new Error("設定を取得できませんでした: 想定しない応答です");
      return { missing: false, bindings: body.result.bindings };
    },
    async patchBindings(worker, bindings) {
      const form = new FormData();
      form.append("settings", JSON.stringify({ bindings }));
      const res = await fetchImpl(url(worker), { method: "PATCH", headers, body: form, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw await fail(res, "設定を更新できませんでした");
      const body = await res.json().catch(() => ({}));
      if (body?.success === false) throw new Error("設定を更新できませんでした: API が失敗を返しました");
    },
  };
}

// ---- 計算（純粋関数） ----

const find = (bindings, name) => bindings.find((b) => b?.name === name);

/** 表示用: 変数の値。plain_text は text、それ以外は (種類)、無いときは null。 */
export function describeVar(bindings, name) {
  const b = find(bindings, name);
  if (!b) return null;
  if (b.type === "plain_text") return typeof b.text === "string" ? b.text : "";
  return `(${b.type})`;
}

/**
 * 現在の bindings と変更（changes: { [name]: string | null }。null = 削除）から、PATCH で送る bindings を作る。
 * 変更しないバインディングは、plain_text なら値のまま、それ以外は inherit で引き継ぐ。
 */
export function buildBindings(current, changes) {
  for (const name of Object.keys(changes)) {
    const b = find(current, name);
    if (b && b.type !== "plain_text") throw new Error(`${name} は ${b.type} で、プレーンテキストの変数ではないため変更しません（ダッシュボードで確認してください）`);
  }
  const out = [];
  for (const b of current) {
    if (!b?.name) continue;
    if (Object.hasOwn(changes, b.name)) continue;
    if (b.type === "plain_text") out.push({ type: "plain_text", name: b.name, text: b.text ?? "" });
    else out.push({ type: "inherit", name: b.name });
  }
  for (const [name, value] of Object.entries(changes)) if (value !== null) out.push({ type: "plain_text", name, text: value });
  return out;
}

/** 書き込みの後の検査。変えるつもりのないバインディングが減っていない・型が変わっていない・狙いの値になっている。 */
export function verifyAfter(before, after, changes) {
  const problems = [];
  for (const b of before) {
    if (!b?.name || Object.hasOwn(changes, b.name)) continue;
    const a = find(after, b.name);
    if (!a) problems.push(`${b.name}（${b.type}）が無くなっています`);
    else if (a.type !== b.type) problems.push(`${b.name} の種類が ${b.type} から ${a.type} に変わっています`);
    else if (b.type === "plain_text" && a.text !== b.text) problems.push(`${b.name} の値が変わっています`);
  }
  for (const [name, value] of Object.entries(changes)) {
    const a = find(after, name);
    if (value === null) { if (a) problems.push(`${name} が残っています`); }
    else if (!a || a.type !== "plain_text" || a.text !== value) problems.push(`${name} が狙いの値になっていません`);
  }
  return problems;
}

/** 表示用に、改行などの制御文字を外す（端末の制御シーケンスの注入を避ける）。 */
// eslint-disable-next-line no-control-regex
export const printable = (v) => (v === null ? "(未設定)" : JSON.stringify(String(v).replace(/[\u0000-\u001f\u007f]/g, " ")));

// ---- 実行 ----

function makeIo({ env, log, error }) {
  const secrets = [env.CLOUDFLARE_API_TOKEN].filter((s) => typeof s === "string" && s.length >= 4);
  const redact = (text) => secrets.reduce((t, s) => t.split(s).join("***"), String(text));
  return { log: (t = "") => log(redact(t)), error: (t = "") => error(redact(t)) };
}

async function defaultPrompt(question) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

function planSet(opts) {
  const changes = {};
  if (opts.mode !== undefined) changes[MODE_VAR] = opts.mode;
  if (opts.message !== undefined) changes[MESSAGE_VAR] = opts.message;
  return changes;
}

function planRename(current, opts) {
  const legacy = find(current, LEGACY_VAR);
  if (!legacy) return {};
  if (legacy.type !== "plain_text") throw new Error(`旧 ${LEGACY_VAR} は ${legacy.type} で、値を読めないため移行できません（ダッシュボードで ${MODE_VAR} を作り直してください）`);
  const modeBinding = find(current, MODE_VAR);
  if (modeBinding && modeBinding.type !== "plain_text") throw new Error(`${MODE_VAR} が ${modeBinding.type} になっています`);
  const changes = { [LEGACY_VAR]: null };
  if (!modeBinding) changes[MODE_VAR] = legacy.text ?? "";
  else if (modeBinding.text !== legacy.text) {
    if (!opts.overwrite) throw new Error(`${MODE_VAR}（${printable(modeBinding.text)}）と旧 ${LEGACY_VAR}（${printable(legacy.text)}）の値が違います。旧の値で上書きして旧変数を消すなら --overwrite を付けてください`);
    changes[MODE_VAR] = legacy.text ?? "";
  }
  return changes;
}

function diffLines(current, changes) {
  return Object.entries(changes).map(([name, value]) => `    ${name}: ${printable(describeVar(current, name))} -> ${value === null ? "(削除)" : printable(value)}`);
}

async function runStatus(targets, api, io) {
  let failed = 0;
  const rows = [["サイト", "環境", "Worker", MODE_VAR, MESSAGE_VAR, "備考"]];
  for (const t of targets) {
    try {
      const s = await api.getSettings(t.worker);
      if (s.missing) { rows.push([t.site, t.env, t.worker, "-", "-", "Worker がありません"]); failed++; continue; }
      const legacy = describeVar(s.bindings, LEGACY_VAR);
      rows.push([t.site, t.env, t.worker, printable(describeVar(s.bindings, MODE_VAR)), printable(describeVar(s.bindings, MESSAGE_VAR)), legacy === null ? "" : `旧 ${LEGACY_VAR} が残っています（rename で移行）`]);
    } catch (e) {
      rows.push([t.site, t.env, t.worker, "-", "-", `失敗: ${e.message}`]);
      failed++;
    }
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => Array.from(r[i]).length)));
  for (const r of rows) io.log(r.map((c, i) => c + " ".repeat(widths[i] - Array.from(c).length)).join("  ").trimEnd());
  return failed > 0 ? 1 : 0;
}

async function runChange(kind, targets, api, io, opts, prompt) {
  const plans = [];
  let failed = 0;
  for (const t of targets) {
    try {
      const s = await api.getSettings(t.worker);
      if (s.missing) throw new Error("Worker がありません");
      const changes = kind === "set" ? planSet(opts) : planRename(s.bindings, opts);
      for (const name of Object.keys(changes)) {
        const b = find(s.bindings, name);
        if (b && b.type !== "plain_text") throw new Error(`${name} は ${b.type} で、変更できません`);
      }
      const effective = Object.fromEntries(Object.entries(changes).filter(([n, v]) => describeVar(s.bindings, n) !== v));
      plans.push({ ...t, current: s.bindings, changes: effective });
    } catch (e) {
      io.error(`[${t.site}/${t.env}] ${t.worker}: 失敗: ${e.message}`);
      failed++;
    }
  }

  io.log(opts.apply ? "変更内容:" : "変更内容（ドライラン。書き込みません）:");
  for (const p of plans) {
    io.log(`  [${p.site}/${p.env}] ${p.worker}`);
    if (Object.keys(p.changes).length === 0) io.log("    変更なし");
    else for (const l of diffLines(p.current, p.changes)) io.log(l);
  }
  const todo = plans.filter((p) => Object.keys(p.changes).length > 0);
  if (!opts.apply) {
    if (todo.length > 0) io.log("実行するには --apply を付けてください");
    return failed > 0 ? 1 : 0;
  }
  if (failed > 0) { io.error("取得に失敗した Worker があるため、何も書き込まずに終了します"); return 1; }
  if (todo.length === 0) return 0;

  const prod = todo.filter((p) => p.env === "production");
  if (prod.length > 0) {
    const phrase = `production ${[...new Set(prod.map((p) => p.site))].sort().join(",")}`;
    const answer = opts.confirm !== undefined ? opts.confirm : await prompt(`本番の Worker ${prod.length} 件を変更します。続けるには「${phrase}」と入力してください: `);
    if (answer === null) { io.error(`本番を変更するには、対話の入力か --confirm "${phrase}" が必要です`); return 1; }
    if (answer.trim() !== phrase) { io.error("確認の入力が一致しないため、何も書き込まずに終了します"); return 1; }
  }

  let backupFile;
  if (opts.backup) {
    const dir = resolve(opts.backupDir ?? "maintenance-backup");
    mkdirSync(dir, { recursive: true });
    backupFile = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    // 取得した内容のまま（secret_text は名前と種類だけ。トークンは含まない）
    writeFileSync(backupFile, JSON.stringify(todo.map((p) => ({ site: p.site, env: p.env, worker: p.worker, bindings: p.current })), null, 2));
    io.log(`変更前のバインディングを保存しました: ${backupFile}`);
  }

  for (const p of todo) {
    try {
      await api.patchBindings(p.worker, buildBindings(p.current, p.changes));
      const after = await api.getSettings(p.worker);
      const problems = after.missing ? ["Worker が見つかりません"] : verifyAfter(p.current, after.bindings, p.changes);
      if (problems.length > 0) throw new Error(`書き込み後の検査に失敗: ${problems.join("、")}${backupFile ? `（変更前: ${backupFile}）` : ""}`);
      io.log(`  [${p.site}/${p.env}] ${p.worker}: 反映しました`);
    } catch (e) {
      io.error(`  [${p.site}/${p.env}] ${p.worker}: 失敗: ${e.message}`);
      failed++;
    }
  }
  return failed > 0 ? 1 : 0;
}

/** 本体。終了コードを返す（process.exit はしない）。 */
export async function main(argv, { env = process.env, fetchImpl = fetch, log = console.log, error = console.error, prompt = defaultPrompt, sitesPath } = {}) {
  const io = makeIo({ env, log, error });
  try {
    const opts = parseArgs(argv);
    if (!["status", "set", "rename"].includes(opts.command)) throw new UsageError("使い方: maintenance.mjs status | set | rename（docs/maintenance-cli.md）");
    if (opts.command === "status" && opts.env === undefined) opts.env = "all";
    if (opts.command === "set") {
      if (opts.env === undefined) throw new UsageError("set には --env dev|production|all が必要です");
      if (opts.mode === undefined && opts.message === undefined) throw new UsageError("set には --mode か --message が必要です");
      if (opts.mode !== undefined && !MODES.includes(opts.mode)) throw new UsageError(`--mode は ${MODES.join("・")} のどれかです`);
      if (opts.message !== undefined) validateMessage(opts.message);
    }
    if (opts.command === "rename" && opts.env === undefined) throw new UsageError("rename には --env dev|production|all が必要です");
    if (opts.command !== "set" && (opts.mode !== undefined || opts.message !== undefined)) throw new UsageError("--mode / --message は set だけで使えます");
    const sites = loadSites(opts.sitesFile ?? sitesPath ?? join(here, "maintenance-sites.json"));
    const targets = selectTargets(sites, opts);
    const token = env.CLOUDFLARE_API_TOKEN;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !accountId) throw new UsageError("環境変数 CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が必要です");
    const api = makeApi({ token, accountId, fetchImpl });
    if (opts.command === "status") return await runStatus(targets, api, io);
    return await runChange(opts.command, targets, api, io, opts, prompt);
  } catch (e) {
    if (e instanceof UsageError) { io.error(e.message); return 2; }
    io.error(`失敗: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
