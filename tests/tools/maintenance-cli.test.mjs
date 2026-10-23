// tools/maintenance.mjs のテスト。実 API は叩かない（fetch を差し替える）。  node --test tests/tools/maintenance-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, buildBindings, verifyAfter, parseArgs, validateMessage } from "../../tools/maintenance.mjs";

const TOKEN = "tok_SECRET_VALUE_12345";
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc123" };

const dir = mkdtempSync(join(tmpdir(), "mcli-"));
const sitesPath = join(dir, "sites.json");
writeFileSync(sitesPath, JSON.stringify({
  sites: [
    { name: "pokemon", workers: { production: "w-pk", dev: "w-pk-dev" } },
    { name: "portfolio", workers: { production: "w-pf", dev: "w-pf-dev" } },
  ],
}));

const baseBindings = () => [
  { type: "plain_text", name: "MAINTENANCE_MODE", text: "false" },
  { type: "plain_text", name: "MAINTENANCE_MESSAGE", text: "旧い文面" },
  { type: "plain_text", name: "OTHER_VAR", text: "keep" },
  { type: "secret_text", name: "SECRET_A" },
  { type: "durable_object_namespace", name: "ROSTER", class_name: "RosterSlot", namespace_id: "ns1" },
  { type: "assets", name: "ASSETS" },
];

/**
 * Cloudflare の settings API のごく簡単な模擬。
 * PATCH は bindings を「置き換え」、inherit は直前の同名バインディングを引き継ぐ（秘密の値は保持）。
 * ignoreInherit: inherit を無視して落とす（壊れたサーバーの想定。書き込み後の検査が失敗を見つけること）。
 */
function fakeCloudflare(workers, { ignoreInherit = false, failPatchFor = [] } = {}) {
  const calls = [];
  const secrets = new Map(); // worker -> { name: value }（GET には出ない）
  for (const name of Object.keys(workers)) secrets.set(name, { SECRET_A: "s3cret-value" });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const m = /accounts\/([^/]+)\/workers\/scripts\/([^/]+)\/settings$/.exec(url);
    calls.push({ method, url, headers: init.headers, body: init.body });
    assert.ok(m, `想定外の URL: ${url}`);
    assert.equal(m[1], "acc123");
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    const worker = decodeURIComponent(m[2]);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (!(worker in workers)) return json(404, { success: false, errors: [{ code: 10007, message: "not found" }] });
    if (method === "GET") return json(200, { success: true, result: { bindings: structuredClone(workers[worker]) } });
    assert.equal(method, "PATCH");
    assert.ok(init.body instanceof FormData, "multipart/form-data で送る");
    if (failPatchFor.includes(worker)) return json(500, { success: false, errors: [{ code: 1, message: "boom" }] });
    const sent = JSON.parse(init.body.get("settings")).bindings;
    const old = workers[worker];
    workers[worker] = sent.flatMap((b) => {
      if (b.type !== "inherit") return [b];
      if (ignoreInherit) return [];
      const prev = old.find((o) => o.name === b.name);
      return prev ? [prev] : [];
    });
    return json(200, { success: true, result: {} });
  };
  return { fetchImpl, calls, workers };
}

function run(argv, cf, extra = {}) {
  const out = [];
  const err = [];
  return main(argv, { env: ENV, fetchImpl: cf.fetchImpl, sitesPath, log: (t) => out.push(String(t)), error: (t) => err.push(String(t)), prompt: async () => null, ...extra })
    .then((code) => ({ code, out: out.join("\n"), err: err.join("\n"), all: `${out.join("\n")}\n${err.join("\n")}` }));
}

const world = () => ({ "w-pk": baseBindings(), "w-pk-dev": baseBindings(), "w-pf": baseBindings(), "w-pf-dev": baseBindings() });
const patches = (cf) => cf.calls.filter((c) => c.method === "PATCH");
const backupArgs = () => ["--backup-dir", mkdtempSync(join(dir, "bk-"))];

test("既定はドライラン: 差分を表示し、PATCH しない", async () => {
  const cf = fakeCloudflare(world());
  const r = await run(["set", "--env", "dev", "--mode", "notice", "--message", "新しい文面"], cf);
  assert.equal(r.code, 0);
  assert.equal(patches(cf).length, 0);
  assert.match(r.out, /ドライラン/);
  assert.match(r.out, /MAINTENANCE_MODE: "false" -> "notice"/);
  assert.match(r.out, /MAINTENANCE_MESSAGE: "旧い文面" -> "新しい文面"/);
  assert.match(r.out, /--apply/);
});

test("set --apply (dev): 対象の変数だけ変わり、ほかのバインディングは残る", async () => {
  const cf = fakeCloudflare(world());
  const r = await run(["set", "--env", "dev", "--mode", "true", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 0, r.all);
  assert.equal(patches(cf).length, 2);
  for (const w of ["w-pk-dev", "w-pf-dev"]) {
    const b = cf.workers[w];
    assert.equal(b.find((x) => x.name === "MAINTENANCE_MODE").text, "true");
    assert.equal(b.find((x) => x.name === "MAINTENANCE_MESSAGE").text, "旧い文面");
    assert.equal(b.find((x) => x.name === "OTHER_VAR").text, "keep");
    assert.deepEqual(b.find((x) => x.name === "SECRET_A"), { type: "secret_text", name: "SECRET_A" });
    assert.equal(b.find((x) => x.name === "ROSTER").class_name, "RosterSlot");
    assert.ok(b.find((x) => x.name === "ASSETS"));
    assert.equal(b.length, 6);
  }
  // production は触らない
  assert.equal(cf.workers["w-pk"].find((x) => x.name === "MAINTENANCE_MODE").text, "false");
});

test("送る bindings: 変数以外は inherit で、秘密の値・DO・assets は消さない", () => {
  const sent = buildBindings(baseBindings(), { MAINTENANCE_MODE: "notice" });
  assert.deepEqual(sent.filter((b) => b.type === "inherit").map((b) => b.name).sort(), ["ASSETS", "ROSTER", "SECRET_A"]);
  assert.ok(sent.some((b) => b.name === "OTHER_VAR" && b.type === "plain_text" && b.text === "keep"));
  assert.ok(sent.some((b) => b.name === "MAINTENANCE_MESSAGE" && b.text === "旧い文面"));
  assert.deepEqual(sent.filter((b) => b.name === "MAINTENANCE_MODE"), [{ type: "plain_text", name: "MAINTENANCE_MODE", text: "notice" }]);
  assert.equal(sent.length, 6);
  assert.ok(!JSON.stringify(sent).includes("s3cret"));
});

test("変数がまだ無い Worker には追加する", async () => {
  const w = world();
  w["w-pk-dev"] = w["w-pk-dev"].filter((b) => !b.name.startsWith("MAINTENANCE"));
  const cf = fakeCloudflare(w);
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "notice", "--message", "追加", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 0, r.all);
  assert.equal(patches(cf).length, 1);
  assert.equal(cf.workers["w-pk-dev"].find((x) => x.name === "MAINTENANCE_MODE").text, "notice");
  assert.equal(cf.workers["w-pk-dev"].find((x) => x.name === "MAINTENANCE_MESSAGE").text, "追加");
  assert.ok(cf.workers["w-pk-dev"].find((x) => x.name === "SECRET_A"));
});

test("本番: 確認が無い・違うと書き込まない。サイト名の入力で書き込む", async () => {
  let cf = fakeCloudflare(world());
  let r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "notice", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);
  assert.match(r.err, /--confirm "production pokemon"/);

  cf = fakeCloudflare(world());
  r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "notice", "--apply", ...backupArgs()], cf, { prompt: async () => "pokemon" });
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);

  cf = fakeCloudflare(world());
  r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "notice", "--apply", "--confirm", "production portfolio", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);

  cf = fakeCloudflare(world());
  r = await run(["set", "--env", "production", "--site", "pokemon", "--mode", "notice", "--apply", ...backupArgs()], cf, { prompt: async (q) => { assert.match(q, /production pokemon/); return "production pokemon"; } });
  assert.equal(r.code, 0, r.all);
  assert.equal(patches(cf).length, 1);
  assert.equal(cf.workers["w-pk"].find((x) => x.name === "MAINTENANCE_MODE").text, "notice");
  assert.equal(cf.workers["w-pf"].find((x) => x.name === "MAINTENANCE_MODE").text, "false");
});

test("本番の確認はドライランでは求めない。dev だけなら確認なし", async () => {
  const cf = fakeCloudflare(world());
  const r = await run(["set", "--env", "all", "--mode", "notice"], cf, { prompt: async () => { throw new Error("聞かない"); } });
  assert.equal(r.code, 0);
  assert.equal(patches(cf).length, 0);
});

test("--env all の本番を含む複数サイトは、サイト名の並びを入力する", async () => {
  const cf = fakeCloudflare(world());
  const r = await run(["set", "--env", "all", "--mode", "notice", "--apply", "--confirm", "production pokemon,portfolio", ...backupArgs()], cf);
  assert.equal(r.code, 0, r.all);
  assert.equal(patches(cf).length, 4);
});

test("変更なしの Worker には書き込まない", async () => {
  const cf = fakeCloudflare(world());
  const r = await run(["set", "--env", "dev", "--mode", "false", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 0);
  assert.equal(patches(cf).length, 0);
  assert.match(r.out, /変更なし/);
});

test("書き込み後の検査: サーバーがバインディングを落としたら失敗（終了コード 1）", async () => {
  const cf = fakeCloudflare(world(), { ignoreInherit: true });
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.match(r.err, /書き込み後の検査に失敗/);
  assert.match(r.err, /SECRET_A/);
});

test("API エラー: 一部の Worker が失敗しても続けて、終了コード 1。トークンは出力に出ない", async () => {
  const cf = fakeCloudflare(world(), { failPatchFor: ["w-pk-dev"] });
  const r = await run(["set", "--env", "dev", "--mode", "true", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.match(r.err, /w-pk-dev.*HTTP 500.*boom/);
  assert.equal(cf.workers["w-pf-dev"].find((x) => x.name === "MAINTENANCE_MODE").text, "true");
  assert.ok(!r.all.includes(TOKEN));
});

test("トークンが API のエラー文に含まれても、出力では伏せる", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ success: false, errors: [{ code: 9109, message: `Invalid token ${TOKEN}` }] }), { status: 403 });
  const r = await run(["status"], { fetchImpl });
  assert.equal(r.code, 1);
  assert.ok(!r.all.includes(TOKEN));
  assert.match(r.all, /HTTP 403/);
  assert.match(r.all, /\*\*\*/);
});

test("取得に失敗した Worker があるときは、--apply でも何も書き込まない", async () => {
  const w = world();
  delete w["w-pf-dev"];
  const cf = fakeCloudflare(w);
  const r = await run(["set", "--env", "dev", "--mode", "true", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);
  assert.match(r.err, /Worker がありません/);
});

test("MAINTENANCE_MODE が secret のときは変更しない", async () => {
  const w = world();
  w["w-pk-dev"] = w["w-pk-dev"].map((b) => (b.name === "MAINTENANCE_MODE" ? { type: "secret_text", name: "MAINTENANCE_MODE" } : b));
  const cf = fakeCloudflare(w);
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);
  assert.match(r.err, /secret_text/);
});

test("status: 表に MAINTENANCE_MODE と MAINTENANCE_MESSAGE を出す。旧変数が残っていれば備考に出す", async () => {
  const w = world();
  w["w-pk"] = [...w["w-pk"], { type: "plain_text", name: "MAINTENANCE", text: "true" }];
  w["w-pf"] = w["w-pf"].map((b) => (b.name === "MAINTENANCE_MESSAGE" ? { ...b, text: "改行\nあり" } : b));
  const cf = fakeCloudflare(w);
  const r = await run(["status"], cf);
  assert.equal(r.code, 0);
  assert.equal(patches(cf).length, 0);
  assert.match(r.out, /w-pk\s+"false"\s+"旧い文面"\s+旧 MAINTENANCE が残っています/);
  assert.match(r.out, /"改行 あり"/);
  assert.equal(r.out.split("\n").length, 5);
});

test("rename: 旧 MAINTENANCE の値を MAINTENANCE_MODE に写して旧変数を消す。ほかは残す", async () => {
  const w = world();
  for (const k of Object.keys(w)) w[k] = w[k].filter((b) => b.name !== "MAINTENANCE_MODE").concat([{ type: "plain_text", name: "MAINTENANCE", text: "notice" }]);
  const cf = fakeCloudflare(w);
  const dry = await run(["rename", "--env", "dev"], cf);
  assert.equal(dry.code, 0);
  assert.equal(patches(cf).length, 0);
  assert.match(dry.out, /MAINTENANCE_MODE: \(未設定\) -> "notice"/);
  assert.match(dry.out, /MAINTENANCE: "notice" -> \(削除\)/);

  const r = await run(["rename", "--env", "dev", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 0, r.all);
  for (const k of ["w-pk-dev", "w-pf-dev"]) {
    const b = cf.workers[k];
    assert.equal(b.find((x) => x.name === "MAINTENANCE_MODE").text, "notice");
    assert.equal(b.find((x) => x.name === "MAINTENANCE"), undefined);
    assert.ok(b.find((x) => x.name === "SECRET_A") && b.find((x) => x.name === "ROSTER") && b.find((x) => x.name === "ASSETS"));
    assert.equal(b.find((x) => x.name === "MAINTENANCE_MESSAGE").text, "旧い文面");
  }
  assert.ok(cf.workers["w-pk"].find((x) => x.name === "MAINTENANCE")); // production は触らない
  // 2 回目は変更なし（冪等）
  const again = await run(["rename", "--env", "dev", "--apply", ...backupArgs()], cf);
  assert.equal(again.code, 0);
  assert.equal(patches(cf).length, 2);
});

test("rename: 新旧の値が違うときは --overwrite が無いと止める", async () => {
  const w = world();
  w["w-pk-dev"] = w["w-pk-dev"].concat([{ type: "plain_text", name: "MAINTENANCE", text: "true" }]);
  const cf = fakeCloudflare(w);
  let r = await run(["rename", "--env", "dev", "--site", "pokemon", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);
  assert.match(r.err, /--overwrite/);
  r = await run(["rename", "--env", "dev", "--site", "pokemon", "--overwrite", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 0, r.all);
  assert.equal(cf.workers["w-pk-dev"].find((x) => x.name === "MAINTENANCE_MODE").text, "true");
  assert.equal(cf.workers["w-pk-dev"].find((x) => x.name === "MAINTENANCE"), undefined);
});

test("rename: 旧変数が secret のときは移行しない", async () => {
  const w = world();
  w["w-pk-dev"] = w["w-pk-dev"].concat([{ type: "secret_text", name: "MAINTENANCE" }]);
  const cf = fakeCloudflare(w);
  const r = await run(["rename", "--env", "dev", "--site", "pokemon", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);
});

test("rename: 本番も確認が要る", async () => {
  const w = world();
  w["w-pk"] = w["w-pk"].concat([{ type: "plain_text", name: "MAINTENANCE", text: "false" }]);
  const cf = fakeCloudflare(w);
  const r = await run(["rename", "--env", "production", "--site", "pokemon", "--apply", ...backupArgs()], cf);
  assert.equal(r.code, 1);
  assert.equal(patches(cf).length, 0);
});

test("変更前のバインディングをバックアップに保存する（トークンは含まない）", async () => {
  const cf = fakeCloudflare(world());
  const bk = mkdtempSync(join(dir, "bk-"));
  const r = await run(["set", "--env", "dev", "--site", "pokemon", "--mode", "true", "--apply", "--backup-dir", bk], cf);
  assert.equal(r.code, 0, r.all);
  const files = readdirSync(bk);
  assert.equal(files.length, 1);
  const text = readFileSync(join(bk, files[0]), "utf8");
  const saved = JSON.parse(text);
  assert.equal(saved[0].worker, "w-pk-dev");
  assert.equal(saved[0].bindings.find((b) => b.name === "MAINTENANCE_MODE").text, "false");
  assert.ok(!text.includes(TOKEN));
});

test("使い方の誤りは終了コード 2（API は呼ばない）", async () => {
  const bad = [
    ["set", "--mode", "true"],
    ["set", "--env", "dev"],
    ["set", "--env", "dev", "--mode", "maybe"],
    ["set", "--env", "staging", "--mode", "true"],
    ["set", "--env", "dev", "--mode", "true", "--site", "nope"],
    ["set", "--env", "dev", "--message", "a".repeat(201)],
    ["set", "--env", "dev", "--message", "a\nb"],
    ["set", "--env", "dev", "--mode", "true", "--bogus"],
    ["status", "--mode", "true"],
    ["rename"],
    ["frobnicate"],
    [],
  ];
  for (const argv of bad) {
    const cf = fakeCloudflare(world());
    const r = await run(argv, cf);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.equal(cf.calls.length, 0, JSON.stringify(argv));
  }
  const cf = fakeCloudflare(world());
  const r = await main(["status"], { env: {}, fetchImpl: cf.fetchImpl, sitesPath, log() {}, error() {} });
  assert.equal(r, 2);
  assert.equal(cf.calls.length, 0);
});

test("同梱の maintenance-sites.json は読め、4 サイトの本番・dev がそろっている", async () => {
  const cf = fakeCloudflare({});
  const out = [];
  const code = await main(["status"], { env: ENV, fetchImpl: cf.fetchImpl, log: (t) => out.push(t), error() {} });
  assert.equal(code, 1); // 模擬には Worker が無い → 404
  const names = cf.calls.map((c) => decodeURIComponent(/scripts\/([^/]+)\//.exec(c.url)[1])).sort();
  assert.deepEqual(names, [
    "fara-avatar", "fara-avatar-dev", "fara-portfolio", "fara-portfolio-dev", "fara-pokemon", "fara-pokemon-dev", "fara-twitch-bot", "fara-twitch-bot-dev",
  ].sort());
});

test("--message は空にもできる。parseArgs / validateMessage の基本", () => {
  assert.equal(parseArgs(["set", "--message", ""]).message, "");
  assert.deepEqual(parseArgs(["set", "--site", "a,b", "--site", "c"]).sites, ["a", "b", "c"]);
  assert.doesNotThrow(() => validateMessage("あ".repeat(200)));
  assert.doesNotThrow(() => validateMessage("😀".repeat(200)));
  assert.throws(() => validateMessage("😀".repeat(201)));
});

test("verifyAfter: 減った・型が変わった・値が狙いと違うを見つける", () => {
  const before = baseBindings();
  const changes = { MAINTENANCE_MODE: "true" };
  const good = buildBindings(before, changes).map((b) => (b.type === "inherit" ? before.find((x) => x.name === b.name) : b));
  assert.deepEqual(verifyAfter(before, good, changes), []);
  assert.equal(verifyAfter(before, good.filter((b) => b.name !== "ROSTER"), changes).length, 1);
  assert.equal(verifyAfter(before, good.map((b) => (b.name === "SECRET_A" ? { type: "plain_text", name: "SECRET_A", text: "" } : b)), changes).length, 1);
  assert.equal(verifyAfter(before, before, changes).length, 1);
});
