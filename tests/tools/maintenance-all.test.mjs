// tools/maintenance-all.mjs と .github/workflows/set-maintenance-all.yml のテスト。実 gh・実 API は叩かない。  node --test tests/tools/maintenance-all.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planFromEnv, runAll, STAGES, ALLOWED_RUN_REF } from "../../tools/maintenance-all.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TIP = "a".repeat(40);
const OK = "inputs: maintenance_mode maintenance_message";
const REPOS = { pokemon: "fara1991/fara-pokemon-battle-assistant", avatar: "fara1991/fara-avatar-modding-guide", bot: "fara1991/fara-bot-moderator", portfolio: "fara1991/fara-portfolio-site", album: "fara1991/fara-vrc-photo-album" };
const base = { RUN_REF: "refs/heads/master", TARGET_DEVELOP: "true", TARGET_MASTER: "false", MAINTENANCE_MODE_INPUT: "notice", MAINTENANCE_MESSAGE_INPUT: "" };

/**
 * gh の模擬。contents: "repo@ref" → ワークフローの中身(文字列)または 404 / 403(ref ごとに指定。無ければ入力つきの版)。
 * failDispatch: その repo の workflow run が失敗。noTip: コミットの取得が 403。
 */
function fakeGh({ contents = {}, failDispatch = {}, noTip = false } = {}) {
  const calls = [];
  const runs = new Map();
  let next = 500;
  const gh = async (args) => {
    calls.push(args);
    const repo = args[args.indexOf("--repo") + 1];
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "fara1991\n", stderr: "" };
    if (args[0] === "api" && args[1].includes("/contents/")) {
      assert.match(args[1], /^repos\/[^/]+\/[^/]+\/contents\/\.github\/workflows\/[^/?]+\?ref=/, `ワークフローのパスは .github/workflows/ 以下: ${args[1]}`);
      const [path, query] = args[1].split("?ref=");
      const key = `${path.split("/").slice(1, 3).join("/")}@${decodeURIComponent(query)}`;
      const c = contents[key] ?? OK;
      if (c === 404) return { code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      if (c === 403) return { code: 1, stdout: "", stderr: "gh: Resource not accessible (HTTP 403)" };
      return { code: 0, stdout: c, stderr: "" };
    }
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
  const dispatches = () => calls.filter((a) => a[0] === "workflow").map((a) => ({ repo: a[a.indexOf("--repo") + 1], ref: a[a.indexOf("--ref") + 1], args: a }));
  return { gh, calls, dispatches };
}

async function go(envExtra, ghOpts, opts) {
  const g = fakeGh(ghOpts);
  const dir = mkdtempSync(join(tmpdir(), "mall-"));
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const out = [];
  const code = await runAll({ ...base, GH_TOKEN: "tok_x_12345", GITHUB_STEP_SUMMARY: summary, ...envExtra }, { gh: g.gh, sleep: async () => {}, log: (t) => out.push(t), error: (t) => out.push(t) }, opts);
  return { code, g, out: out.join("\n"), summary: readFileSync(summary, "utf8") };
}

const master = { TARGET_MASTER: "true", MAINTENANCE_MODE_INPUT: "true" };

// ---- 入力の検査と段階の組み立て ----

test("チェックボックスと環境の対応: develop = dev、master = production(dev が先、本番は最後)", () => {
  assert.deepEqual(STAGES.map((s) => [s.input, s.branch, s.envName]), [["TARGET_DEVELOP", "develop", "dev"], ["TARGET_MASTER", "master", "production"]]);
  const p = planFromEnv({ ...base, TARGET_MASTER: "true", MAINTENANCE_MODE_INPUT: "true", MAINTENANCE_MESSAGE_INPUT: "文面" });
  assert.deepEqual(p.stages.map((s) => s.envName), ["dev", "production"]);
  assert.deepEqual(p.stages[0].base, ["set", "--env", "dev", "--mode", "true", "--message", "文面", "--allow-empty"]);
  assert.deepEqual(p.stages[0].sites, ["pokemon", "avatar", "bot", "portfolio", "album"], "サイトは常に 5 つすべて");
  assert.equal(p.stages[1].confirm, "production avatar,bot,pokemon,portfolio");
  assert.equal(p.stages[0].confirm, undefined);
  assert.deepEqual(planFromEnv(base).stages.map((s) => s.envName), ["dev"], "既定は develop だけ");
});

test("入力の検査(注入防止): 不正な値は拒否する。master の実行元以外も拒否", () => {
  assert.equal(ALLOWED_RUN_REF, "refs/heads/master");
  const bad = [
    { RUN_REF: "refs/heads/develop" }, { RUN_REF: "refs/heads/feature/x" }, { RUN_REF: "refs/tags/v1" }, { RUN_REF: "master" }, { RUN_REF: "" }, { RUN_REF: undefined },
    { TARGET_DEVELOP: "false" }, // どれも選ばない
    { TARGET_DEVELOP: "yes" }, { TARGET_DEVELOP: "" }, { TARGET_MASTER: "TRUE" },
    { MAINTENANCE_MODE_INPUT: "maintenance" }, { MAINTENANCE_MODE_INPUT: "true;" }, { MAINTENANCE_MODE_INPUT: "TRUE" },
    { MAINTENANCE_MESSAGE_INPUT: "a\nb" }, { MAINTENANCE_MESSAGE_INPUT: "a\u0007" }, { MAINTENANCE_MESSAGE_INPUT: "あ".repeat(201) },
    { MAINTENANCE_MODE_INPUT: "", MAINTENANCE_MESSAGE_INPUT: "" },
    { TARGET_MASTER: "true", MAINTENANCE_MODE_INPUT: "", MAINTENANCE_MESSAGE_INPUT: "x" }, // 本番は mode 必須
  ];
  for (const extra of bad) assert.throws(() => planFromEnv({ ...base, ...extra }), /./, JSON.stringify(extra));
  const tricky = `$(id) "q" ; 'a' \`b\``;
  assert.equal(planFromEnv({ ...base, MAINTENANCE_MESSAGE_INPUT: tricky }).stages[0].base.at(-2), tricky);
});

// ---- 実行 ----

test("develop: 5 サイトの dev のワークフローを develop で起動し、入力を渡す。サマリーに run の URL が出る", async () => {
  const r = await go({ MAINTENANCE_MESSAGE_INPUT: "20:00 ごろ `更新`" });
  assert.equal(r.code, 0, r.out);
  const d = r.g.dispatches();
  assert.deepEqual(d.map((x) => x.repo).sort(), Object.values(REPOS).sort());
  assert.ok(d.every((x) => x.ref === "develop" && x.args.includes("maintenance_mode=notice") && x.args.includes("maintenance_message=20:00 ごろ `更新`")), "文面はそのまま 1 引数");
  assert.match(r.summary, /メンテナンス表示を一括で切り替え \(成功\)/);
  for (const repo of Object.values(REPOS)) assert.match(r.summary, new RegExp(`https://github.com/${repo}/actions/runs/\\d+`));
  assert.doesNotMatch(r.summary, /`更新`/, "サマリーの Markdown を壊さない(backtick を無害化)");
  assert.doesNotMatch(r.summary + r.out, /tok_x_12345/);
});

test("develop と master の両方: dev を全部起動・成功してから本番を 1 サイトずつ。本番の再入力は選んだサイト名", async () => {
  const r = await go({ ...master });
  assert.equal(r.code, 0, r.out);
  const d = r.g.dispatches();
  assert.deepEqual(d.map((x) => x.ref), ["develop", "develop", "develop", "develop", "develop", "master", "master", "master", "master"]);
  const idx = (pred) => r.g.calls.findIndex(pred);
  const lastDevWatch = r.g.calls.map((a, i) => (a[1] === "watch" ? i : -1)).filter((i) => i >= 0)[3];
  const firstMaster = idx((a) => a[0] === "workflow" && a.includes("master"));
  assert.ok(lastDevWatch < firstMaster, "dev の結果を待ってから本番");
});

test("master だけ: 各サイトの本番のワークフローを master で起動する(mode 必須)", async () => {
  const r = await go({ TARGET_DEVELOP: "false", ...master, MAINTENANCE_MODE_INPUT: "false" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.g.dispatches().map((x) => x.ref), ["master", "master", "master", "master"]);
  assert.deepEqual(r.g.dispatches().map((x) => x.args[2]).sort(), ["deploy.yml", "deploy.yml", "deploy.yml", "site.yml"]);
  assert.ok(r.g.dispatches().every((x) => !x.args.some((a) => a.startsWith("maintenance_message"))));
});

// ---- 事前確認(飛ばす) ----

test("対象ブランチのワークフローが入力を受け取れない版のサイトは、dispatch せずに飛ばし、サマリーに理由を出す", async () => {
  const r = await go({}, { contents: { [`${REPOS.avatar}@develop`]: "name: Deploy\non: push\n" } });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.g.dispatches().map((x) => x.repo).sort(), [REPOS.album, REPOS.bot, REPOS.pokemon, REPOS.portfolio].sort());
  assert.match(r.summary, /飛ばしたサイト\(警告\)/);
  assert.match(r.summary, /- avatar \/ dev: .*fara-avatar-modding-guide の develop の deploy\.yml に、入力 maintenance_mode がまだ無い/);
});

test("すべて飛ばされたら失敗(何も反映されない)。dispatch は 1 つも起動しない", async () => {
  const old = Object.fromEntries(Object.values(REPOS).map((repo) => [`${repo}@develop`, "old"]));
  const r = await go({}, { contents: old });
  assert.equal(r.code, 1);
  assert.match(r.out, /実行できる対象が 1 つもありません/);
  assert.equal(r.g.dispatches().length, 0);
  assert.match(r.summary, /失敗・中断/);
});

test("ワークフローのファイルが無い(404)は飛ばす。権限が無く確かめられない(403)ときは、従来どおり dispatch する", async () => {
  const r = await go({}, { contents: { [`${REPOS.avatar}@develop`]: 404 } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.g.dispatches().length, 4, "avatar だけ飛ばす");
  const g = await go({}, { contents: Object.fromEntries(Object.values(REPOS).map((repo) => [`${repo}@develop`, 403])) });
  assert.equal(g.code, 0, g.out);
  assert.equal(g.g.dispatches().length, 5);
});

test("段階 dev: 本番(master)を選んでいても、本番は起動せず、本番で飛ばすサイトが計画としてサマリーに出る(承認画面より前)", async () => {
  const prodOld = { [`${REPOS.pokemon}@master`]: "old", [`${REPOS.avatar}@master`]: "old" };
  const r = await go({ ...master }, { contents: prodOld }, { phase: "dev" });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.g.dispatches().every((x) => x.ref === "develop"), "本番は dev の段階では起動しない");
  assert.match(r.summary, /計画と dev 系/);
  assert.match(r.summary, /- pokemon \/ production: /);
  assert.match(r.summary, /- avatar \/ production: /);
  assert.doesNotMatch(r.summary, /- bot \/ production/);
});

test("段階 dev: master だけを選んでも、計画のために動く(何も起動せず、本番ですべて飛ばされるなら失敗)", async () => {
  const prodOld = Object.fromEntries(Object.values(REPOS).map((repo) => [`${repo}@master`, "old"]));
  const r = await go({ TARGET_DEVELOP: "false", ...master }, { contents: prodOld }, { phase: "dev" });
  assert.equal(r.code, 1);
  assert.equal(r.g.dispatches().length, 0);
  const ok = await go({ TARGET_DEVELOP: "false", ...master }, {}, { phase: "dev" });
  assert.equal(ok.code, 0);
  assert.equal(ok.g.dispatches().length, 0, "本番は production の段階で起動する");
});

test("段階 production: 本番だけを起動する。飛ばすサイトは本番側でも除かれる", async () => {
  const r = await go({ ...master }, { contents: { [`${REPOS.pokemon}@master`]: "old" } }, { phase: "production" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.g.dispatches().map((x) => x.ref), ["master", "master", "master"]);
  assert.ok(!r.g.dispatches().some((x) => x.repo === REPOS.pokemon));
  assert.match(r.summary, /本番\(master\)/);
  assert.match(r.summary, /- pokemon \/ production: /);
});

// ---- 失敗・その他 ----

test("事前確認の URL は .github/workflows/ 以下(ファイル名だけだと 404 になる)", async () => {
  const r = await go({});
  assert.equal(r.code, 0, r.out);
  const urls = r.g.calls.filter((a) => a[0] === "api" && a[1].includes("/contents/")).map((a) => a[1]);
  assert.equal(urls.length, 10, "dev の 5 サイトを、plan と実行で 1 回ずつ");
  assert.ok(urls.every((u) => u.includes("/contents/.github/workflows/")), urls.join("\n"));
  assert.ok(urls.includes("repos/fara1991/fara-pokemon-battle-assistant/contents/.github/workflows/deploy-develop.yml?ref=develop"));
  assert.ok(urls.includes("repos/fara1991/fara-bot-moderator/contents/.github/workflows/site.yml?ref=develop"));
});

const noPreflight = (ref) => Object.fromEntries(Object.values(REPOS).map((repo) => [`${repo}@${ref}`, 403]));
const unexpected = "could not create workflow dispatch event: HTTP 422: Unexpected inputs provided: [\"maintenance_message\",\"maintenance_mode\"]";

test("事前確認できず(403)dispatch が 422 Unexpected inputs で返ったサイトは、失敗にせず飛ばして続行する。サマリーに明記", async () => {
  const r = await go({}, { contents: noPreflight("develop"), failDispatch: { [REPOS.avatar]: unexpected } });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.g.dispatches().map((x) => x.repo).sort(), Object.values(REPOS).sort(), "avatar も dispatch は試みる");
  assert.match(r.out, /\[警告\] 飛ばす: \[avatar\/dev\] .*HTTP 422 Unexpected inputs/);
  assert.match(r.summary, /飛ばしたサイト\(警告\)/);
  assert.match(r.summary, /- avatar \/ dev: .*Unexpected inputs/);
  assert.equal(r.g.calls.filter((a) => a[1] === "watch").length, 4, "ほかの 4 サイトは続行して結果を待つ");
});

test("422 以外のエラー(認証・ワークフロー不在・その他)は従来どおり失敗で中断し、本番は起動しない", async () => {
  for (const stderr of ["HTTP 401: Bad credentials", "HTTP 404: Not Found", "could not find any workflows named deploy.yml", "HTTP 500: Server Error", "HTTP 422: Workflow does not have 'workflow_dispatch' trigger"]) {
    const r = await go({ ...master }, { contents: noPreflight("develop"), failDispatch: { [REPOS.avatar]: stderr } });
    assert.equal(r.code, 1, stderr);
    assert.match(r.out, /\[avatar\/dev\] gh workflow run が失敗しました/, stderr);
    assert.ok(r.g.dispatches().every((x) => x.ref === "develop"), "本番は起動しない");
  }
});

test("422 で飛ばすのは本番でも同じ。飛ばした事実はサマリーに出て、残りの本番は続行する", async () => {
  const r = await go({ TARGET_DEVELOP: "false", ...master }, { contents: noPreflight("master"), failDispatch: { [REPOS.pokemon]: unexpected } }, { phase: "production" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.summary, /- pokemon \/ production: /);
  assert.equal(r.g.calls.filter((a) => a[1] === "watch").length, 3);
});

test("422 ですべて飛ばされたら失敗(何も反映されない)。dev の段階では、あとで本番が実行できるなら失敗にしない", async () => {
  const all422 = Object.fromEntries(Object.values(REPOS).map((repo) => [repo, unexpected]));
  const r = await go({}, { contents: noPreflight("develop"), failDispatch: all422 });
  assert.equal(r.code, 1);
  assert.match(r.out, /実行できた対象が 1 つもありません|実行できる対象が/);
  assert.match(r.summary, /失敗・中断/);
  // dev の段階: dev はすべて 422 で飛ばされるが、本番(master)は実行できる → 失敗にしない
  const devPhase = await go({ ...master }, { contents: { ...noPreflight("develop") }, failDispatch: Object.fromEntries(Object.values(REPOS).map((repo) => [repo, unexpected])) }, { phase: "dev" });
  assert.equal(devPhase.code, 0, devPhase.out);
  // 本番の段階: すべて飛ばされたら失敗
  const prod = await go({ TARGET_DEVELOP: "false", ...master }, { contents: noPreflight("master"), failDispatch: all422 }, { phase: "production" });
  assert.equal(prod.code, 1);
});

test("トークン(GH_TOKEN)が無いと、gh を呼ぶ前に失敗する。入力が不正なら終了コード 2", async () => {
  const g = fakeGh();
  const out = [];
  const code = await runAll({ ...base }, { gh: g.gh, log: (t) => out.push(t), error: (t) => out.push(t) });
  assert.equal(code, 1);
  assert.match(out.join("\n"), /SITES_DISPATCH_TOKEN/);
  assert.equal(g.calls.length, 0);
  const bad = await go({ MAINTENANCE_MODE_INPUT: "x" });
  assert.equal(bad.code, 2);
  assert.equal(bad.g.calls.length, 0);
  assert.equal((await go({ RUN_REF: "refs/heads/develop" })).code, 2);
});

test("コミットを読む権限が無くても、ほかの条件で run を特定して進む", async () => {
  const r = await go({}, { noTip: true });
  assert.equal(r.code, 0, r.out);
});

test("検査だけ(--validate-only)は、gh もトークンも要らず、成功時 0", async () => {
  const quiet = { log: () => {}, error: () => {} };
  assert.equal(await runAll({ ...base, ...master }, quiet, { phase: "validate" }), 0);
  assert.equal(await runAll({ ...base, MAINTENANCE_MODE_INPUT: "x" }, quiet, { phase: "validate" }), 2);
});

// ---- ワークフローの構造(公開リポジトリで、シークレットが漏れない・承認が効く形) ----

const yml = readFileSync(join(root, ".github", "workflows", "set-maintenance-all.yml"), "utf8");
const jobBlock = (name) => {
  const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, "m").exec(yml.slice(yml.indexOf("\njobs:")));
  assert.ok(m, `${name} の job`);
  return m[1];
};

test("ワークフロー: トリガは workflow_dispatch だけ。入力は 2 つのチェックボックス(develop 既定 true)・mode・message。target_branch と sites は無い", () => {
  const on = /\non:\n([\s\S]*?)\npermissions:/.exec(yml)[1];
  assert.deepEqual([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]), ["workflow_dispatch"]);
  assert.doesNotMatch(yml, /pull_request|issue_comment|issues:|push:|workflow_run|schedule/);
  assert.match(yml, /permissions:\n {2}contents: read\n/);
  const inputs = [...on.matchAll(/^ {6}([a-z_]+):\n((?: {8}.*\n)+)/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(inputs.map(([k]) => k), ["develop", "master", "maintenance_mode", "maintenance_message"]);
  const get = (k) => inputs.find(([n]) => n === k)[1];
  for (const [k, def] of [["develop", "true"], ["master", "false"]]) {
    assert.match(get(k), /type: boolean\n/);
    assert.match(get(k), new RegExp(`default: ${def}\\n`));
  }
  assert.match(get("maintenance_mode"), /type: choice\n/);
  assert.doesNotMatch(yml, /target_branch|sites:|SITES_INPUT/);
});

test("ワークフロー: Environment は dev = develop-maintenance、本番 = production-maintenance。validate には付けない。待機は dev と本番で別の枠(cancel しない)", () => {
  assert.match(jobBlock("production"), /environment: production-maintenance\n/);
  assert.match(jobBlock("dev"), /environment: develop-maintenance\n/);
  assert.doesNotMatch(jobBlock("validate"), /environment:/);
  assert.doesNotMatch(yml.slice(0, yml.indexOf("\njobs:")), /concurrency:/);
  assert.match(jobBlock("dev"), /concurrency:\n {6}group: set-maintenance-dev\n {6}cancel-in-progress: false/);
  assert.match(jobBlock("production"), /concurrency:\n {6}group: set-maintenance-production\n {6}cancel-in-progress: false/);
});

test("ワークフロー: dev job は常に動き(計画のため)、本番 job は master を選んだときだけ・dev の成功後。validate を待つ", () => {
  assert.doesNotMatch(jobBlock("dev"), /\n {4}if:/);
  assert.match(jobBlock("dev"), /needs: validate\n/);
  assert.match(jobBlock("production"), /needs: dev\n/);
  assert.match(jobBlock("production"), /if: \$\{\{ inputs\.master \}\}\n/);
  assert.match(jobBlock("dev"), /node tools\/maintenance-all\.mjs --phase dev\n/);
  assert.match(jobBlock("production"), /node tools\/maintenance-all\.mjs --phase production\n/);
});

test("ワークフロー: SITES_DISPATCH_TOKEN は dev・production の job の最後の step にだけ渡す(validate には渡さない)。入力は env 経由", () => {
  assert.equal((yml.match(/secrets\.SITES_DISPATCH_TOKEN/g) ?? []).length, 2);
  assert.doesNotMatch(jobBlock("validate"), /secrets\./);
  for (const name of ["dev", "production"]) {
    const steps = jobBlock(name).split("\n      - ").slice(1);
    assert.ok(steps.length >= 2);
    steps.forEach((st, i) => assert.equal(st.includes("secrets.SITES_DISPATCH_TOKEN"), i === steps.length - 1, `${name} の step ${i}`));
    assert.match(steps.at(-1), /run: node tools\/maintenance-all\.mjs /);
  }
  for (const line of yml.split("\n")) if (/^\s+run:/.test(line)) assert.doesNotMatch(line, /\$\{\{/, line);
});

test("ワークフロー: validate は master 以外の ref で止まり、RUN_REF とチェックボックスを渡して検査する。実行 job にも RUN_REF を渡す", () => {
  const v = jobBlock("validate");
  assert.match(v, /- name: Require master\n {8}if: \$\{\{ github\.ref != 'refs\/heads\/master' \}\}\n {8}run: \|\n[\s\S]*?exit 1/);
  assert.match(v, /node tools\/maintenance-all\.mjs --validate-only\n {8}env:\n {10}RUN_REF: \$\{\{ github\.ref \}\}/);
  assert.ok(v.indexOf("name: Require master") < v.indexOf("name: Validate inputs"), "ref の確認が先");
  for (const name of ["validate", "dev", "production"]) {
    const b = jobBlock(name);
    assert.match(b, /RUN_REF: \$\{\{ github\.ref \}\}/, name);
    assert.match(b, /TARGET_DEVELOP: \$\{\{ inputs\.develop \}\}/, name);
    assert.match(b, /TARGET_MASTER: \$\{\{ inputs\.master \}\}/, name);
  }
});
