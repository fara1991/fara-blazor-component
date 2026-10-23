// tools/maintenance-all.mjs と .github/workflows/set-maintenance-all.yml のテスト。実 gh・実 API は叩かない。  node --test tests/tools/maintenance-all.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planFromEnv, runAll, ENV_FOR_BRANCH, ALLOWED_TARGETS } from "../../tools/maintenance-all.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TIP = "a".repeat(40);
const base = { RUN_REF: "refs/heads/master", TARGET_BRANCH: "develop", MAINTENANCE_MODE_INPUT: "notice", MAINTENANCE_MESSAGE_INPUT: "", SITES_INPUT: "all" };

/** gh の模擬(repo ごとに run を管理)。failDispatch: その repo の workflow run が失敗。noTip: コミットの取得が 403。 */
function fakeGh({ failDispatch = {}, noTip = false } = {}) {
  const calls = [];
  const runs = new Map();
  let next = 500;
  const gh = async (args) => {
    calls.push(args);
    const repo = args[args.indexOf("--repo") + 1];
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "fara1991\n", stderr: "" };
    if (args[0] === "api") return noTip ? { code: 1, stdout: "", stderr: "HTTP 403" } : { code: 0, stdout: `${TIP}\n`, stderr: "" };
    if (args[0] === "run" && args[1] === "list") return { code: 0, stdout: JSON.stringify(runs.get(repo) ?? []), stderr: "" };
    if (args[0] === "workflow") {
      if (failDispatch[repo]) return { code: 1, stdout: "", stderr: failDispatch[repo] };
      const id = next++;
      runs.set(repo, [{ databaseId: id, url: `https://github.com/${repo}/actions/runs/${id}`, createdAt: new Date().toISOString(), headBranch: args[args.indexOf("--ref") + 1], headSha: TIP }]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "run" && args[1] === "watch") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`想定外の gh: ${args.join(" ")}`);
  };
  return { gh, calls, dispatches: () => calls.filter((a) => a[0] === "workflow") };
}

async function go(envExtra, ghOpts) {
  const g = fakeGh(ghOpts);
  const dir = mkdtempSync(join(tmpdir(), "mall-"));
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const out = [];
  const code = await runAll({ ...base, GH_TOKEN: "tok_x_12345", GITHUB_STEP_SUMMARY: summary, ...envExtra }, { gh: g.gh, sleep: async () => {}, log: (t) => out.push(t), error: (t) => out.push(t) });
  return { code, g, out: out.join("\n"), summary: readFileSync(summary, "utf8") };
}

test("target_branch と環境の対応: develop = dev、master = production、migration/wasm = wasm-dev(avatar だけ)", () => {
  assert.deepEqual(ENV_FOR_BRANCH, { develop: "dev", master: "production", "migration/wasm": "wasm-dev" });
  assert.deepEqual(planFromEnv(base).argv, ["set", "--env", "dev", "--mode", "notice", "--apply"]);
  const prod = planFromEnv({ ...base, TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "true" });
  assert.deepEqual(prod.argv, ["set", "--env", "production", "--mode", "true", "--apply", "--confirm", "production avatar,bot,pokemon,portfolio"]);
  const wasm = planFromEnv({ ...base, TARGET_BRANCH: "migration/wasm" });
  assert.deepEqual(wasm.sites, ["avatar"]);
  assert.equal(wasm.argv.includes("--confirm"), false);
});

test("sites の絞り込み: カンマ区切り・空白・重複。本番の再入力は対象のサイト名から作る", () => {
  const p = planFromEnv({ ...base, TARGET_BRANCH: "master", SITES_INPUT: " portfolio , pokemon,pokemon ", MAINTENANCE_MESSAGE_INPUT: "文面" });
  assert.deepEqual(p.argv, ["set", "--env", "production", "--site", "portfolio,pokemon", "--mode", "notice", "--message", "文面", "--apply", "--confirm", "production pokemon,portfolio"]);
  assert.deepEqual(planFromEnv({ ...base, SITES_INPUT: "" }).sites, ["pokemon", "avatar", "bot", "portfolio"], "空は all");
});

test("入力の検査(注入防止): 不正な値は拒否する", () => {
  const bad = [
    { TARGET_BRANCH: "main" }, { TARGET_BRANCH: "" }, { TARGET_BRANCH: "develop; rm -rf /" },
    { MAINTENANCE_MODE_INPUT: "maintenance" }, { MAINTENANCE_MODE_INPUT: "true;" }, { MAINTENANCE_MODE_INPUT: "TRUE" },
    { MAINTENANCE_MESSAGE_INPUT: "a\nb" }, { MAINTENANCE_MESSAGE_INPUT: "a\u0007" }, { MAINTENANCE_MESSAGE_INPUT: "あ".repeat(201) },
    { SITES_INPUT: "pokemon;ls" }, { SITES_INPUT: "pokemon,nope" }, { SITES_INPUT: "$(id)" }, { SITES_INPUT: "pokemon avatar" },
    { MAINTENANCE_MODE_INPUT: "", MAINTENANCE_MESSAGE_INPUT: "" },
    { TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "", MAINTENANCE_MESSAGE_INPUT: "x" },
    { TARGET_BRANCH: "migration/wasm", SITES_INPUT: "pokemon" },
  ];
  for (const extra of bad) assert.throws(() => planFromEnv({ ...base, ...extra }), /./, JSON.stringify(extra));
  // 記号を含む文面でも、引数の 1 要素のまま(シェルを通さない)
  const tricky = `$(id) "q" ; 'a' \`b\``;
  assert.equal(planFromEnv({ ...base, MAINTENANCE_MESSAGE_INPUT: tricky }).argv.at(-2), tricky);
});

test("develop: 4 サイトの dev のワークフローを develop で起動し、入力を渡す。サマリーに run の URL が出る", async () => {
  const r = await go({ MAINTENANCE_MESSAGE_INPUT: "20:00 ごろ `更新`" });
  assert.equal(r.code, 0, r.out);
  const d = r.g.dispatches();
  assert.equal(d.length, 4);
  assert.deepEqual(d.map((a) => a[a.indexOf("--repo") + 1]).sort(), ["fara1991/fara-avatar-modding-guide", "fara1991/fara-bot-moderator", "fara1991/fara-pokemon-battle-assistant", "fara1991/fara-portfolio-site"]);
  assert.ok(d.every((a) => a[a.indexOf("--ref") + 1] === "develop"));
  assert.ok(d.every((a) => a.includes("maintenance_mode=notice") && a.includes("maintenance_message=20:00 ごろ `更新`")), "文面はそのまま 1 引数");
  assert.match(r.summary, /メンテナンス表示を一括で切り替え \(成功\)/);
  for (const repo of ["fara-pokemon-battle-assistant", "fara-avatar-modding-guide", "fara-bot-moderator", "fara-portfolio-site"]) assert.match(r.summary, new RegExp(`https://github.com/fara1991/${repo}/actions/runs/\\d+`));
  assert.doesNotMatch(r.summary, /`更新`/, "サマリーの Markdown を壊さない(backtick を無害化)");
  assert.doesNotMatch(r.summary + r.out, /tok_x_12345/);
});

test("master: 各サイトの本番のワークフローを master で、1 サイトずつ起動する", async () => {
  const r = await go({ TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "false", SITES_INPUT: "pokemon,portfolio" });
  assert.equal(r.code, 0, r.out);
  const d = r.g.dispatches();
  assert.deepEqual(d.map((a) => [a[2], a[a.indexOf("--ref") + 1]]), [["deploy.yml", "master"], ["deploy.yml", "master"]]);
  assert.ok(d.every((a) => !a.some((x) => x.startsWith("maintenance_message"))));
});

test("migration/wasm: avatar の確認用だけを起動する", async () => {
  const r = await go({ TARGET_BRANCH: "migration/wasm" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.g.dispatches().map((a) => [a[a.indexOf("--repo") + 1], a[a.indexOf("--ref") + 1]]), [["fara1991/fara-avatar-modding-guide", "migration/wasm"]]);
});

test("入力が未対応のサイトで失敗したら、サイト名と理由・対処を出して中断する(後続は起動しない)", async () => {
  const r = await go({ TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "true" }, { failDispatch: { "fara1991/fara-pokemon-battle-assistant": "could not create workflow dispatch event: HTTP 422: Unexpected inputs provided: [\"maintenance_mode\"]" } });
  assert.equal(r.code, 1);
  assert.match(r.out, /\[pokemon\/production\] gh workflow run が失敗しました.*Unexpected inputs/);
  assert.match(r.out, /入力 maintenance_mode \/ maintenance_message を受け取る版がまだ入っていない.*--site で除く/);
  assert.equal(r.g.dispatches().length, 1, "最初の失敗で中断");
  assert.match(r.summary, /失敗・中断/);
});

test("トークン(GH_TOKEN)が無いと、gh を呼ぶ前に失敗する", async () => {
  const g = fakeGh();
  const out = [];
  const code = await runAll({ ...base }, { gh: g.gh, log: (t) => out.push(t), error: (t) => out.push(t) });
  assert.equal(code, 1);
  assert.match(out.join("\n"), /SITES_DISPATCH_TOKEN/);
  assert.equal(g.calls.length, 0);
});

test("入力が不正なら終了コード 2。gh は呼ばない", async () => {
  const r = await go({ SITES_INPUT: "pokemon;ls" });
  assert.equal(r.code, 2);
  assert.equal(r.g.calls.length, 0);
});

test("コミットを読む権限が無くても(PAT が Actions だけ)、ほかの条件で run を特定して進む", async () => {
  const r = await go({ SITES_INPUT: "bot" }, { noTip: true });
  assert.equal(r.code, 0, r.out);
});

test("検査だけ(--validate-only 相当)は、gh もトークンも要らず、成功時 0", async () => {
  const code = await runAll({ ...base, TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "true" }, { log: () => {}, error: () => {} }, { validateOnly: true });
  assert.equal(code, 0);
  assert.equal(await runAll({ ...base, MAINTENANCE_MODE_INPUT: "x" }, { log: () => {}, error: () => {} }, { validateOnly: true }), 2);
});

// ---- ワークフローの構造(公開リポジトリで、シークレットが漏れない・承認が効く形) ----

const yml = readFileSync(join(root, ".github", "workflows", "set-maintenance-all.yml"), "utf8");
const jobBlock = (name) => {
  const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, "m").exec(yml.slice(yml.indexOf("\njobs:")));
  assert.ok(m, `${name} の job`);
  return m[1];
};

test("ワークフロー: トリガは workflow_dispatch だけ(PR・issue・コメント・push では動かない)", () => {
  const on = /\non:\n([\s\S]*?)\npermissions:/.exec(yml)[1];
  assert.match(on, /^ {2}workflow_dispatch:/m);
  assert.deepEqual([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]), ["workflow_dispatch"]);
  assert.doesNotMatch(yml, /pull_request|issue_comment|issues:|push:|workflow_run|schedule/);
  assert.match(yml, /permissions:\n {2}contents: read\n/);
});

test("ワークフロー: Environment は dev = develop-maintenance、本番 = production-maintenance。validate には付けない。待機は dev と本番で別の枠(cancel しない)", () => {
  assert.match(jobBlock("production"), /environment: production-maintenance\n/);
  assert.match(jobBlock("dev"), /environment: develop-maintenance\n/);
  assert.doesNotMatch(jobBlock("validate"), /environment:/);
  // 全体の concurrency は置かず、dev と本番の job で別の group にする
  assert.doesNotMatch(yml.slice(0, yml.indexOf("\njobs:")), /concurrency:/);
  assert.match(jobBlock("dev"), /concurrency:\n {6}group: set-maintenance-dev\n {6}cancel-in-progress: false/);
  assert.match(jobBlock("production"), /concurrency:\n {6}group: set-maintenance-production\n {6}cancel-in-progress: false/);
  assert.match(jobBlock("production"), /if: \$\{\{ inputs\.target_branch == 'master' \}\}/);
  assert.match(jobBlock("dev"), /if: \$\{\{ inputs\.target_branch != 'master' \}\}/);
});

test("ワークフロー: SITES_DISPATCH_TOKEN は dev・production の job の最後の step にだけ渡す(validate には渡さない)", () => {
  assert.equal((yml.match(/secrets\.SITES_DISPATCH_TOKEN/g) ?? []).length, 2);
  assert.doesNotMatch(jobBlock("validate"), /secrets\./);
  for (const name of ["dev", "production"]) {
    const steps = jobBlock(name).split("\n      - ").slice(1);
    assert.ok(steps.length >= 2);
    steps.forEach((st, i) => assert.equal(st.includes("secrets.SITES_DISPATCH_TOKEN"), i === steps.length - 1, `${name} の step ${i}`));
    assert.match(steps.at(-1), /run: node tools\/maintenance-all\.mjs\n/);
  }
  // run: の行に ${{ ... }} を直接書かない(env のブロックでだけ使う)
  for (const line of yml.split("\n")) if (/^\s+run:/.test(line)) assert.doesNotMatch(line, /\$\{\{/, line);
});

test("ワークフロー: validate は master・develop 以外の ref で止まり、RUN_REF を渡して組み合わせを検査する。dev・production は validate を待つ", () => {
  const v = jobBlock("validate");
  assert.match(v, /- name: Require master or develop\n {8}if: \$\{\{ github\.ref != 'refs\/heads\/master' && github\.ref != 'refs\/heads\/develop' \}\}\n {8}run: \|\n[\s\S]*?exit 1/);
  assert.match(v, /node tools\/maintenance-all\.mjs --validate-only\n {8}env:\n {10}RUN_REF: \$\{\{ github\.ref \}\}/);
  assert.ok(v.indexOf("name: Require master or develop") < v.indexOf("name: Validate inputs"), "ref の確認が先");
  // 実行する step にも RUN_REF を渡す(validate をすり抜けても、実行側でも検査する)
  for (const name of ["dev", "production"]) assert.match(jobBlock(name), /RUN_REF: \$\{\{ github\.ref \}\}/);
  assert.match(jobBlock("dev"), /needs: validate\n/);
  assert.match(jobBlock("production"), /needs: validate\n/);
});

test("実行 ref と target_branch の組み合わせ: master の ref はすべて可、develop の ref は develop / migration/wasm だけ(master は拒否)", () => {
  assert.deepEqual(ALLOWED_TARGETS, { "refs/heads/master": ["develop", "master", "migration/wasm"], "refs/heads/develop": ["develop", "migration/wasm"] });
  for (const target of ["develop", "master", "migration/wasm"]) {
    const extra = target === "master" ? { MAINTENANCE_MODE_INPUT: "true" } : {};
    assert.doesNotThrow(() => planFromEnv({ ...base, RUN_REF: "refs/heads/master", TARGET_BRANCH: target, ...extra }), `master から ${target}`);
  }
  for (const target of ["develop", "migration/wasm"]) assert.doesNotThrow(() => planFromEnv({ ...base, RUN_REF: "refs/heads/develop", TARGET_BRANCH: target }), `develop から ${target}`);
  assert.throws(() => planFromEnv({ ...base, RUN_REF: "refs/heads/develop", TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "true" }), /develop から実行したワークフローでは、target_branch=master は使えません/);
  for (const ref of ["refs/heads/feature/x", "refs/heads/migration/wasm", "refs/tags/v1", "refs/pull/1/merge", "master", "", undefined]) {
    assert.throws(() => planFromEnv({ ...base, RUN_REF: ref }), /master か develop から実行してください/, String(ref));
  }
});

test("develop の ref から実行すると、dev の job は動き、master への反映は何も起動されない", async () => {
  const dev = await go({ RUN_REF: "refs/heads/develop" });
  assert.equal(dev.code, 0, dev.out);
  assert.equal(dev.g.dispatches().length, 4);
  const prod = await go({ RUN_REF: "refs/heads/develop", TARGET_BRANCH: "master", MAINTENANCE_MODE_INPUT: "true" });
  assert.equal(prod.code, 2);
  assert.equal(prod.g.calls.length, 0, "gh を呼ばない");
  const feat = await go({ RUN_REF: "refs/heads/feature/x" });
  assert.equal(feat.code, 2);
  assert.equal(feat.g.calls.length, 0);
});
