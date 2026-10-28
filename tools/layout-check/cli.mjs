#!/usr/bin/env node
// レイアウトの自動計測の CLI。  node tools/layout-check/cli.mjs --config layout-check.config.mjs
// 終了コード: 0 = 違反なし / 1 = 違反あり / 2 = 設定・ブラウザ・ページの失敗（計測できなかった）。
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LayoutCheckConfigError, LayoutCheckRunError, formatViolation, runLayoutCheck, RULE_NAMES } from "./index.mjs";

const USAGE = `使い方: node tools/layout-check/cli.mjs --config <設定ファイル>
  設定ファイル（ESM）の default export に、baseURL・pages などを書く（docs/layout-check.md）。
  終了コード: 0 違反なし / 1 違反あり / 2 計測できなかった（設定・ブラウザ・ページ）。`;

function parseArgs(argv) {
  const args = { config: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--config") {
      args.config = argv[i + 1] ?? null;
      i += 1;
    } else throw new LayoutCheckConfigError(`未知の引数: ${arg}`);
  }
  return args;
}

async function loadConfig(configPath) {
  const absolute = resolve(process.cwd(), configPath);
  try {
    const mod = await import(pathToFileURL(absolute).href);
    return mod.default;
  } catch (error) {
    throw new LayoutCheckConfigError(`設定ファイルを読めない: ${absolute}（${error.message.split("\n")[0]}）`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.config) throw new LayoutCheckConfigError("--config で設定ファイルを指定する");

  const rawConfig = await loadConfig(args.config);
  const { violations, runs, config } = await runLayoutCheck(rawConfig);
  const enabled = RULE_NAMES.filter((name) => config.rules[name]);
  console.log(`レイアウト計測: ${config.pages.length} ページ × ${config.viewports.length} 幅（${config.viewports.join(", ")}px）= ${runs} 回`);
  console.log(`ルール: ${enabled.join(", ")}`);
  if (violations.length === 0) {
    console.log("違反なし");
    return 0;
  }
  for (const v of violations) console.log(formatViolation(v));
  console.log(`違反 ${violations.length} 件`);
  return 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof LayoutCheckConfigError || error instanceof LayoutCheckRunError) {
    console.error(`エラー: ${error.message}`);
  } else {
    console.error(`予期しないエラー: ${error?.stack ?? error}`);
  }
  console.error(USAGE);
  process.exitCode = 2;
}
