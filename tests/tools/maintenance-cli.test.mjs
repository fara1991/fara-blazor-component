// tools/maintenance.mjs のテスト。実 gh・実 API は叩かない（gh と fetch を差し替える）。  node --test tests/tools/maintenance-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, parseArgs, validateMessage, displayCommand, dispatchArgs, INPUT_MODE, INPUT_MESSAGE } from "../../tools/maintenance.mjs";

const TOKEN = "tok_SECRET_VALUE_12345";
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc123" };
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const dir = mkdtempSync(join(tmpdir(), "mcli-"));
const sitesPath = join(dir, "sites.json");
const wf = (file, ref) => ({ file, ref });
writeFileSync(sitesPath, JSON.stringify({
  sites: [
    { name: "pokemon", repo: "o/pk", workflows: { dev: wf("deploy-develop.yml", "develop"), production: wf("deploy.yml", "master") }, workers: { production: "w-pk", dev: "w-pk-dev" } },
    { name: "portfolio", repo: "o/pf", workflows: { dev: wf("deploy-develop.yml", "develop"), production: wf("deploy.yml", "master") }, workers: { production: "w-pf", dev: "w-pf-dev" } },
    { name: "devonly", repo: "o/do", workflows: { dev: wf("wasm.yml", "migration/wasm") }, workers: { dev: "w-do-dev" } },
  ],
}));

/**
 * gh の模擬。run list（起動済みの run）・workflow run（run を増やす）・run watch（成功/失敗）を再現し、呼び出しを記録する。
 * failWatch: その repo の run watch を失敗させる。failDispatch: その repo の workflow run を失敗させる。noRun: 起動しても run が一覧に出ない。
 */
function fakeGh({ failWatch = [], failDispatch = [], noRun = [], extraRun = [], wrongSha = [] } = {}) {
  const calls = [];
  const runs = new Map(); // repo -> [{databaseId, url}]
  let next = 100;
  const repoOf = (a) => a[a.indexOf("--repo") + 1];
  const gh = async (args) => {
    calls.push(args);
    const repo = repoOf(args);
    if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: "fara1991\n", stderr: "" };
    if (args[0] === "api" && args[1].startsWith("repos/")) return { code: 0, stdout: `${TIP}\n`, stderr: "" };
    if (args[0] === "run" && args[1] === "list") {
      assert.equal(args[args.indexOf("--user") + 1], "fara1991", "自分が起動した run だけに絞る");
      assert.equal(args[args.indexOf("--event") + 1], "workflow_dispatch");
      return { code: 0, stdout: JSON.stringify(runs.get(repo) ?? []), stderr: "" };
    }
    if (args[0] === "workflow" && args[1] === "run") {
      if (failDispatch.includes(repo)) return { code: 1, stdout: "", stderr: "HTTP 422: Workflow does not have 'workflow_dispatch' trigger" };
      if (!noRun.includes(repo)) {
        const mk = () => {
          const id = next++;
          return { databaseId: id, url: `https://github.com/${repo}/actions/runs/${id}`, createdAt: new Date().toISOString(), headBranch: args[args.indexOf("--ref") + 1], headSha: wrongSha.includes(repo) ? "b".repeat(40) : TIP };
        };
        runs.set(repo, [mk(), ...(extraRun.includes(repo) ? [mk()] : []), ...(runs.get(repo) ?? [])]);
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "run" && args[1] === "watch") return failWatch.includes(repo) ? { code: 1, stdout: "", stderr: "failed" } : { code: 0, stdout: "", stderr: "" };
    throw new Error(`想定外の gh 呼び出し: ${args.join(" ")}`);
  };
  return { gh, calls, dispatches: () => calls.filter((a) => a[0] === "workflow"), watches: () => calls.filter((a) => a[1] === "watch") };
}

const TIP = "a".repeat(40);
const noFetch = async () => { throw new Error("set では Cloudflare の API を呼ばない"); };
const noGh = async () => { throw new Error("status では gh を呼ばない"); };

function run(argv, extra = {}) {
  const out = [];
  const err = [];
  return main(argv, { env: ENV, fetchImpl: noFetch, gh: noGh, sleep: async () => {}, sitesPath, log: (t) => out.push(String(t)), error: (t) => err.push(String(t)), prompt: async () => null, ...extra })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n"), all: `${out.join("\n")}\n${err.join("\n")}` }));
}

test("set の既定はドライラン: 実行する gh のコマンドを順に表示し、gh も API も呼ばない", async () => {
  const r = await run(["set", "--env", "all", "--site", "pokemon", "--mode", "notice", "--message", "10月25日 20:00 ごろ更新します"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /ドライラン/);
  assert.match(r.out, /gh workflow run deploy-develop\.yml --repo o\/pk --ref develop -f maintenance_mode=notice -f "maintenance_message=10月25日 20:00 ごろ更新します"/);
  assert.match(r.out, /gh workflow run deploy\.yml --repo o\/pk --ref master -f maintenance_mode=notice/);
  assert.ok(r.out.indexOf("deploy-develop.yml") < r.out.indexOf("--ref master"), "dev が先");
  assert.match(r.out, /--apply/);
});

test("ドライランでは、本番でも確認を求めない", async () => {
  const r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "false"], { prompt: async () => { throw new Error("求めない"); } });
  assert.equal(r.code, 0);
});

test("--apply (dev): ワークフローに入力が渡り、run の URL が表示される。Cloudflare の API は呼ばない", async () => {
  const g = fakeGh();
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "notice", "--message", "更新します", "--apply"], { gh: g.gh });
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(g.dispatches(), [["workflow", "run", "deploy-develop.yml", "--repo", "o/pk", "--ref", "develop", "-f", `${INPUT_MODE}=notice`, "-f", `${INPUT_MESSAGE}=更新します`]]);
  assert.equal(g.watches().length, 1);
  assert.deepEqual(g.watches()[0].slice(0, 4), ["run", "watch", "100", "--repo"]);
  assert.ok(g.watches()[0].includes("--exit-status"));
  assert.match(r.out, /起動しました https:\/\/github\.com\/o\/pk\/actions\/runs\/100/);
  assert.match(r.out, /成功しました https:\/\/github\.com\/o\/pk\/actions\/runs\/100/);
});

test("--mode だけ・--message だけのときは、指定した入力だけを渡す", async () => {
  const g = fakeGh();
  await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "false", "--apply"], { gh: g.gh });
  assert.deepEqual(g.dispatches()[0].slice(7), ["-f", "maintenance_mode=false"]);
  const g2 = fakeGh();
  await run(["set", "--env", "dev", "--site", "pokemon", "--message", "x", "--apply"], { gh: g2.gh });
  assert.deepEqual(g2.dispatches()[0].slice(7), ["-f", "maintenance_message=x"]);
});

test("順序: dev をすべて起動 → dev の結果を待つ → production（起動 → 待つ）", async () => {
  const g = fakeGh();
  const r = await run(["set", "--env", "all", "--site", "pokemon,portfolio", "--mode", "true", "--apply", "--confirm", "production pokemon,portfolio"], { gh: g.gh });
  assert.equal(r.code, 0, r.all);
  const seq = g.calls.filter((a) => a[0] === "workflow" || a[1] === "watch").map((a) => (a[0] === "workflow" ? `run:${a[a.indexOf("--repo") + 1]}:${a[a.indexOf("--ref") + 1]}` : `watch:${a[a.indexOf("--repo") + 1]}`));
  assert.deepEqual(seq, [
    "run:o/pk:develop", "run:o/pf:develop", // dev をすべて起動
    "watch:o/pk", "watch:o/pf",             // dev の結果
    "run:o/pk:master", "watch:o/pk",        // production（1 サイトずつ）
    "run:o/pf:master", "watch:o/pf",
  ]);
});

test("dev が 1 つ失敗したら中断: production は起動しない。終了コード 1", async () => {
  const g = fakeGh({ failWatch: ["o/pf"] });
  const r = await run(["set", "--env", "all", "--site", "pokemon,portfolio", "--mode", "true", "--apply", "--confirm", "production pokemon,portfolio"], { gh: g.gh });
  assert.equal(r.code, 1);
  assert.equal(g.dispatches().filter((a) => a.includes("master")).length, 0, "production を起動しない");
  assert.match(r.err, /実行が失敗しました: https:\/\/github\.com\/o\/pf\/actions\/runs\//);
  assert.match(r.err, /中断/);
});

test("production の 1 つ目が失敗したら、2 つ目は起動しない", async () => {
  const g = fakeGh({ failWatch: ["o/pk"] });
  // dev を含めず production だけ。pokemon が失敗 → portfolio は起動しない
  const r = await run(["set", "--env", "production", "--site", "pokemon,portfolio", "--mode", "true", "--apply", "--confirm", "production pokemon,portfolio"], { gh: g.gh });
  assert.equal(r.code, 1);
  assert.equal(g.dispatches().length, 1);
});

test("gh workflow run の失敗（入力が未定義など）は中断。理由とヒントを出す", async () => {
  const g = fakeGh({ failDispatch: ["o/pk"] });
  const r = await run(["set", "--env", "dev", "--mode", "true", "--apply"], { gh: g.gh });
  assert.equal(r.code, 1);
  assert.match(r.err, /gh workflow run が失敗しました.*workflow_dispatch/);
  assert.match(r.err, /maintenance_mode/);
  assert.equal(g.dispatches().length, 1, "失敗したら後続を起動しない");
});

test("起動した run が 2 つ以上見つかったら、取り違えを避けて中断する。コミットが先頭と違う run も中断する", async () => {
  const many = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply"], { gh: fakeGh({ extraRun: ["o/pk"] }).gh });
  assert.equal(many.code, 1);
  assert.match(many.err, /2 件見つかりました.*取り違え/);
  const g = fakeGh({ wrongSha: ["o/pk"] });
  const sha = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply"], { gh: g.gh });
  assert.equal(sha.code, 1);
  assert.match(sha.err, /先頭/);
  assert.equal(g.watches().length, 0, "待たない");
});

test("古い run（起動の 5 分より前に作られたもの）は、新しい run と見なさない", async () => {
  const g = fakeGh();
  const now = Date.now() + 60 * 60 * 1000; // 時計が 1 時間進んでいるとして、gh 側の createdAt は古い
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply"], { gh: g.gh, now: () => now });
  assert.equal(r.code, 1);
  assert.match(r.err, /見つかりませんでした/);
});

test("production を含む set は --mode が必須（--message だけは dev だけ）。ドライランでも同じ", async () => {
  const g = fakeGh();
  for (const argv of [["set", "--env", "production", "--site", "pokemon", "--message", "x"], ["set", "--env", "all", "--site", "pokemon", "--message", "x", "--apply", "--confirm", "production pokemon"]]) {
    const r = await run(argv, { gh: g.gh });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /--mode が必要/);
  }
  assert.equal(g.calls.length, 0);
  assert.equal((await run(["set", "--env", "dev", "--site", "pokemon", "--message", "x", "--apply"], { gh: g.gh })).code, 0);
});

test("本番の実行前の確認文言と表示に、master の最新が公開されることを出す", async () => {
  let asked = "";
  await run(["set", "--env", "production", "--site", "pokemon", "--mode", "false", "--apply"], { gh: fakeGh().gh, prompt: async (q) => { asked = q; return "production pokemon"; } });
  assert.match(asked, /master の最新が wrangler deploy で公開/);
  assert.match((await run(["set", "--env", "production", "--site", "pokemon", "--mode", "false"])).out, /master の最新のコードが wrangler deploy で公開/);
});

test("起動した run が一覧に出ないときは、待ち直したうえで失敗にする", async () => {
  const g = fakeGh({ noRun: ["o/pk"] });
  let slept = 0;
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply"], { gh: g.gh, sleep: async () => { slept++; } });
  assert.equal(r.code, 1);
  assert.equal(slept, 10);
  assert.match(r.err, /見つかりませんでした/);
});

test("本番: --confirm が無い（対話もできない）と、何も実行しない", async () => {
  const g = fakeGh();
  const r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "true", "--apply"], { gh: g.gh });
  assert.equal(r.code, 1);
  assert.match(r.err, /--confirm "production pokemon"/);
  assert.equal(g.calls.length, 0);
});

test("本番: --confirm が違うと、何も実行しない（dev も実行しない）", async () => {
  for (const wrong of ["production", "production pokemon", "pokemon,portfolio", "production portfolio,pokemon", "PRODUCTION pokemon,portfolio"]) {
    const g = fakeGh();
    const r = await run(["set", "--env", "all", "--site", "pokemon,portfolio", "--mode", "true", "--apply", "--confirm", wrong], { gh: g.gh });
    assert.equal(r.code, 1, wrong);
    assert.equal(g.calls.length, 0, wrong);
  }
});

test("本番: 対象のサイト名の再入力（アルファベット順・カンマ区切り）で実行できる。対話の入力でもよい", async () => {
  const g = fakeGh();
  assert.equal((await run(["set", "--env", "production", "--site", "portfolio,pokemon", "--mode", "false", "--apply", "--confirm", " production pokemon,portfolio "], { gh: g.gh })).code, 0);
  assert.equal(g.dispatches().length, 2);
  const g2 = fakeGh();
  let asked = "";
  const r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "false", "--apply"], { gh: g2.gh, prompt: async (q) => { asked = q; return "production pokemon"; } });
  assert.equal(r.code, 0);
  assert.match(asked, /production pokemon/);
});

test("dev だけなら確認は要らない", async () => {
  const g = fakeGh();
  const r = await run(["set", "--env", "dev", "--mode", "false", "--apply"], { gh: g.gh });
  assert.equal(r.code, 0);
});

test("dev だけのサイト（production のワークフローが無い）は、--env all では dev だけ、--env production では使い方の誤り", async () => {
  const g = fakeGh();
  const all = await run(["set", "--env", "all", "--site", "devonly", "--mode", "true", "--apply"], { gh: g.gh });
  assert.equal(all.code, 0, all.all);
  assert.deepEqual(g.dispatches().map((a) => a[a.indexOf("--ref") + 1]), ["migration/wasm"]);
  const prod = await run(["set", "--env", "production", "--site", "devonly", "--mode", "true"]);
  assert.equal(prod.code, 2);
});

test("文面は 1 つの引数としてそのまま渡る（シェルを通さない）。表示は制御文字を外して引用する", async () => {
  const message = `a b "c" $(x) ; 'd' &`;
  const g = fakeGh();
  await run(["set", "--env", "dev", "--site", "pokemon", "--message", message, "--apply"], { gh: g.gh });
  assert.equal(g.dispatches()[0].at(-1), `maintenance_message=${message}`);
  const shown = displayCommand(["workflow", "run", "-f", `maintenance_message=${message}`]);
  assert.match(shown, /^gh workflow run -f "maintenance_message=a b \\"c\\" \$\(x\) ; 'd' &"$/);
});

test("使い方の誤りは終了コード 2（gh も API も呼ばない）", async () => {
  const bad = [
    ["set", "--mode", "true"],
    ["set", "--env", "dev"],
    ["set", "--env", "dev", "--mode", "maintenance"],
    ["set", "--env", "staging", "--mode", "true"],
    ["set", "--env", "dev", "--site", "nope", "--mode", "true"],
    ["set", "--env", "dev", "--message", "a\nb"],
    ["set", "--env", "dev", "--message", ""],
    ["set", "--env", "dev", "--message", "あ".repeat(201)],
    ["set", "--env", "dev", "--mode", "true", "--wat"],
    ["set", "--env", "dev", "--mode"],
    ["status", "--mode", "true"],
    ["status", "--apply"],
    [],
    ["bogus"],
    // 廃止したサブコマンドは、通常の「不明」と同じ扱い
    ["rename", "--env", "dev"],
  ];
  for (const argv of bad) {
    const r = await run(argv);
    assert.equal(r.code, 2, JSON.stringify(argv));
  }
  const r = await run(["rename", "--env", "dev"]);
  assert.doesNotMatch(r.err, /廃止|rename/);
  assert.equal((await run(["set", "--env", "dev", "--mode", "true"], { env: {} })).code, 0, "set は Cloudflare のトークンが無くてもドライランできる");
});

test("--message は 200 文字ちょうどまで。parseArgs / validateMessage の基本", () => {
  assert.doesNotThrow(() => validateMessage("あ".repeat(200)));
  assert.doesNotThrow(() => validateMessage("😀".repeat(200)));
  assert.throws(() => validateMessage("😀".repeat(201)));
  const o = parseArgs(["set", "--env", "dev", "--site", "a,b", "--site", "c", "--mode", "true", "--apply", "--confirm", "x"]);
  assert.deepEqual([o.env, o.sites, o.mode, o.apply, o.confirm], ["dev", ["a", "b", "c"], "true", true, "x"]);
  assert.deepEqual(dispatchArgs({ workflow: wf("a.yml", "develop"), repo: "o/r" }, { mode: "true" }), ["workflow", "run", "a.yml", "--repo", "o/r", "--ref", "develop", "-f", "maintenance_mode=true"]);
});

// ---- status ----

const bindings = (extra = []) => [
  { type: "plain_text", name: "MAINTENANCE_MODE", text: "notice" },
  { type: "plain_text", name: "MAINTENANCE_MESSAGE", text: "10月25日に更新\n行2" },
  { type: "secret_text", name: "SECRET_A" },
  { type: "durable_object_namespace", name: "ROSTER", class_name: "RosterSlot" },
  ...extra,
];

function fakeCloudflare(workers, { status = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const m = /accounts\/([^/]+)\/workers\/scripts\/([^/]+)\/settings$/.exec(url);
    assert.ok(m, `想定外の URL: ${url}`);
    assert.equal(m[1], "acc123");
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    const worker = decodeURIComponent(m[2]);
    const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
    if (status[worker]) return json(status[worker], { success: false, errors: [{ code: 10000, message: `bad token ${TOKEN}` }] });
    if (!(worker in workers)) return json(404, { success: false, errors: [{ code: 10007, message: "not found" }] });
    return json(200, { success: true, result: { bindings: workers[worker] } });
  };
  return { fetchImpl, calls };
}

test("status: 読み取り（GET）だけ。表に MAINTENANCE_MODE と MAINTENANCE_MESSAGE を出す。シークレットは種類だけ", async () => {
  const cf = fakeCloudflare({ "w-pk": bindings(), "w-pk-dev": bindings([{ type: "plain_text", name: "MAINTENANCE", text: "true" }]), "w-pf": bindings(), "w-pf-dev": bindings() });
  const r = await run(["status", "--site", "pokemon"], { fetchImpl: cf.fetchImpl });
  assert.equal(r.code, 0, r.all);
  assert.ok(cf.calls.length === 2 && cf.calls.every((c) => c.method === "GET" && c.body === undefined), "GET だけ");
  assert.match(r.out, /pokemon\s+dev\s+w-pk-dev\s+"notice"\s+"10月25日に更新 行2"\s+旧 MAINTENANCE が残っています/);
  assert.match(r.out, /pokemon\s+production\s+w-pk\s+"notice"/);
  assert.doesNotMatch(r.out, /SECRET_A|RosterSlot/);
  const sec = fakeCloudflare({ "w-pk": [{ type: "secret_text", name: "MAINTENANCE_MODE" }], "w-pk-dev": [] });
  const r2 = await run(["status", "--site", "pokemon"], { fetchImpl: sec.fetchImpl });
  assert.match(r2.out, /\(secret_text\)/);
  assert.match(r2.out, /pokemon\s+dev\s+w-pk-dev\s+\(未設定\)\s+\(未設定\)/);
  assert.equal(r2.code, 0);
});

test("status: Worker が見つからない・権限エラーは備考に出して終了コード 1。取得できた行は表に出る。トークンは伏せる", async () => {
  const cf = fakeCloudflare({ "w-pk": bindings(), "w-pf": bindings() }, { status: { "w-pf-dev": 403 } });
  const r = await run(["status"], { fetchImpl: cf.fetchImpl });
  assert.equal(r.code, 1);
  assert.match(r.out, /w-pk-dev\s+-\s+-\s+Worker が見つかりません/);
  assert.match(r.out, /w-pf-dev\s+-\s+-\s+失敗: .*HTTP 403.*Read/);
  assert.match(r.out, /pokemon\s+production\s+w-pk\s+"notice"/);
  assert.ok(!r.all.includes(TOKEN), "トークンは出力に出ない");
  assert.match(r.out, /\*\*\*/);
});

test("status: トークンまたはアカウント ID が無いと使い方の誤り（2）", async () => {
  assert.equal((await run(["status"], { env: { CLOUDFLARE_ACCOUNT_ID: "a" } })).code, 2);
  assert.equal((await run(["status"], { env: { CLOUDFLARE_API_TOKEN: TOKEN } })).code, 2);
});

test("status: 想定外の応答は失敗として扱う", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
  const r = await run(["status", "--site", "pokemon", "--env", "dev"], { fetchImpl });
  assert.equal(r.code, 1);
  assert.match(r.out, /想定しない応答/);
});

// ---- 同梱ファイル・ドキュメント ----

test("同梱の maintenance-sites.json は読め、4 サイトの dev・production のワークフローと Worker がそろっている", async () => {
  const sites = JSON.parse(readFileSync(join(root, "tools", "maintenance-sites.json"), "utf8")).sites;
  assert.deepEqual(sites.map((s) => s.name), ["pokemon", "avatar", "bot", "portfolio"]);
  for (const s of sites) {
    assert.match(s.repo, /^fara1991\//);
    assert.equal(s.workflows.dev.ref, "develop");
    assert.equal(s.workflows.production.ref, "master");
    assert.ok(s.workers.dev.endsWith("-dev") && !s.workers.production.endsWith("-dev"));
  }
  const r = await new Promise((resolve) => {
    const out = [];
    main(["set", "--env", "all", "--mode", "false"], { env: {}, log: (t) => out.push(t), error: (t) => out.push(t) }).then((code) => resolve({ code, out: out.join("\n") }));
  });
  assert.equal(r.code, 0);
  assert.equal((r.out.match(/gh workflow run/g) ?? []).length, 8);
});

test("docs/maintenance-cli.md の雛形は、CLI が渡す入力名と合い、新しい変数名 MAINTENANCE_MODE だけを --var で渡す", () => {
  const md = readFileSync(join(root, "docs", "maintenance-cli.md"), "utf8");
  const yaml = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  assert.ok(yaml.includes(`${INPUT_MODE}:`) && yaml.includes(`${INPUT_MESSAGE}:`), "入力名");
  assert.ok(yaml.includes("${{ inputs.maintenance_mode }}") && yaml.includes("${{ inputs.maintenance_message }}"));
  assert.match(yaml, /--var "MAINTENANCE_MODE:\$MAINTENANCE_MODE_INPUT"/);
  assert.match(yaml, /--var "MAINTENANCE_MESSAGE:\$MAINTENANCE_MESSAGE_INPUT"/);
  assert.doesNotMatch(yaml, /--var "?MAINTENANCE:/, "旧名は渡さない");
  assert.doesNotMatch(yaml, /\$\{\{\s*inputs\.maintenance_(mode|message)\s*\}\}[^\n]*\n\s*(run|npx)/, "入力をシェルに直接埋め込まない");
  assert.match(yaml, /if \[ -n "\$MAINTENANCE_MESSAGE_INPUT" \]/, "空なら --var を付けない");
  assert.doesNotMatch(md, /全部の置き換え|inherit|rename/);
});

// ---- 雛形の分岐（docs の YAML の run を、bash で実際に動かして固定する） ----

/** docs の ```yaml ブロックから、名前が stepName のステップの run（| ブロック）を取り出す。 */
function templateRun(md, stepName) {
  const lines = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].flatMap((m) => m[1].split("\n"));
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.ok(at >= 0, `${stepName} のステップが見つからない`);
  const runAt = lines.findIndex((l, i) => i > at && l.trim() === "run: |");
  assert.ok(runAt > at, "run が見つからない");
  const body = [];
  for (let i = runAt + 1; i < lines.length && (lines[i].trim() === "" || /^ {10}/.test(lines[i])); i++) body.push(lines[i].slice(10));
  return body.join("\n");
}

/** npx を、引数を 1 行ずつ出す関数に差し替えて bash で動かす。 */
function runTemplate(script, env) {
  const full = `npx() { printf '%s\n' "$@"; }
${script}`;
  const out = execFileSync(BASH, ["-c", full], { env: { PATH: process.env.PATH, MAINTENANCE_MODE_INPUT: "", MAINTENANCE_MESSAGE_INPUT: "", SKIP_MAINTENANCE_CHECK: "", ...env }, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

// Windows では PATH 上の bash が WSL のこともあるので、Git for Windows の bash を優先する
const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";
const BASH = process.platform === "win32" && existsSync(GIT_BASH) ? GIT_BASH : "bash";
const mdText = () => readFileSync(join(root, "docs", "maintenance-cli.md"), "utf8");

test("雛形(production): push と何も指定しない手動実行だけ MAINTENANCE_MODE:true。message だけでは true にしない", () => {
  const sh = templateRun(mdText(), "Deploy to Cloudflare Workers");
  // wrangler deploy --env="" の引数
  const head = ["wrangler", "deploy", "--env="];
  assert.deepEqual(runTemplate(sh, {}), [...head, "--var", "MAINTENANCE_MODE:true"], "push / 何も指定しない手動実行");
  assert.deepEqual(runTemplate(sh, { SKIP_MAINTENANCE_CHECK: "true" }), head, "skip_maintenance_check では変数を付けない");
  assert.deepEqual(runTemplate(sh, { MAINTENANCE_MODE_INPUT: "notice" }), [...head, "--var", "MAINTENANCE_MODE:notice"]);
  assert.deepEqual(runTemplate(sh, { MAINTENANCE_MODE_INPUT: "false", MAINTENANCE_MESSAGE_INPUT: "20:00 ごろ: 更新" }), [...head, "--var", "MAINTENANCE_MODE:false", "--var", "MAINTENANCE_MESSAGE:20:00 ごろ: 更新"]);
  assert.deepEqual(runTemplate(sh, { MAINTENANCE_MODE_INPUT: "true", SKIP_MAINTENANCE_CHECK: "true" }), [...head, "--var", "MAINTENANCE_MODE:true"], "mode を指定したら skip は関係ない");
  // message だけ: MAINTENANCE_MODE は渡さない（現在の値を保持）。本番を 503 にしない
  const only = runTemplate(sh, { MAINTENANCE_MESSAGE_INPUT: "文面だけ" });
  assert.deepEqual(only, [...head, "--var", "MAINTENANCE_MESSAGE:文面だけ"]);
  assert.ok(!only.some((a) => a.startsWith("MAINTENANCE_MODE")));
  // 記号を含む文面もそのまま 1 つの引数
  assert.deepEqual(runTemplate(sh, { MAINTENANCE_MODE_INPUT: "notice", MAINTENANCE_MESSAGE_INPUT: `$(echo x) "q" ; 'a'` }).at(-1), `MAINTENANCE_MESSAGE:$(echo x) "q" ; 'a'`);
});

test("雛形(dev): 入力が空なら --var を付けない。指定したものだけ付ける", () => {
  const sh = templateRun(mdText(), "Deploy to Cloudflare Workers (develop)");
  assert.deepEqual(runTemplate(sh, {}), ["wrangler", "deploy", "--env", "develop"]);
  assert.deepEqual(runTemplate(sh, { MAINTENANCE_MESSAGE_INPUT: "m" }), ["wrangler", "deploy", "--env", "develop", "--var", "MAINTENANCE_MESSAGE:m"]);
  assert.deepEqual(runTemplate(sh, { MAINTENANCE_MODE_INPUT: "notice", MAINTENANCE_MESSAGE_INPUT: "m" }), ["wrangler", "deploy", "--env", "develop", "--var", "MAINTENANCE_MODE:notice", "--var", "MAINTENANCE_MESSAGE:m"]);
});

test("雛形: ゲートは mode に true / notice / false のどれかが指定されたときだけ飛ばす（明示的な条件）", () => {
  const md = mdText();
  assert.ok(md.includes(`if: \${{ !contains(fromJSON('["true","notice","false"]'), inputs.maintenance_mode) }}`));
  assert.doesNotMatch(md, /inputs\.maintenance_mode == ''/);
});
