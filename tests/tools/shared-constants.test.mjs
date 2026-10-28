// 重複を避けた定数と、ワークフローの入力の読み取りの確認。  node --test tests/tools/shared-constants.test.mjs
// worker/ は tools/ を import しない（各サイトの Worker にバンドルされるため）ので、同じ値は、ソースの文字列を比べて一致を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODES, dispatchInputNames } from "../../tools/maintenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

test("MAX_MESSAGE（200 文字）は worker/maintenance.js と tools/maintenance.mjs で同じ", () => {
    const worker = /const MAX_MESSAGE = (\d+);/.exec(read("worker/maintenance.js"));
    const tools = /export const MAX_MESSAGE = (\d+);/.exec(read("tools/maintenance.mjs"));
    assert.ok(worker && tools);
    assert.equal(worker[1], tools[1]);
});

test("MODES は tools/maintenance.mjs の 1 か所だけ（maintenance-all.mjs は import する）", () => {
    assert.deepEqual(MODES, ["true", "notice", "false"]);
    assert.doesNotMatch(read("tools/maintenance-all.mjs"), /const MODES = /);
    assert.match(read("tools/maintenance-all.mjs"), /\bMODES\b.*from "\.\/maintenance\.mjs"/);
});

test("dispatchInputNames: on.workflow_dispatch.inputs の直下のキーだけを数える", () => {
    const yaml = [
        "name: x",
        "on:",
        "  push:",
        "    branches: [master]",
        "  workflow_dispatch:",
        "    inputs:",
        "      maintenance_mode:",
        '        description: "x"',
        "        type: choice",
        "      maintenance_message:",
        "        type: string",
        "jobs:",
        "  deploy:",
        "    steps:",
        "      - run: echo maintenance_mode",
        "        # maintenance_message: コメント",
        "        with:",
        "          x: maintenance_mode",
        "",
    ].join("\n");
    assert.deepEqual(dispatchInputNames(yaml), ["maintenance_mode", "maintenance_message"]);
});

test("dispatchInputNames: 入力が無いワークフローは空（run の中の文字列で「ある」と判定しない）", () => {
    const yaml = "name: x\non: push\njobs:\n  a:\n    steps:\n      - run: echo maintenance_mode\n";
    assert.deepEqual(dispatchInputNames(yaml), []);
});
