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

test("dispatchInputNames: ブロックスカラー（run: |）の中の maintenance_mode: は入力と判定しない", () => {
    const yaml = [
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      maintenance_message:",
        "        type: string",
        "jobs:",
        "  deploy:",
        "    steps:",
        "      - name: x",
        "        run: |",
        "          maintenance_mode: \"true\"",
        "          maintenance_message:",
        "      - run: |",
        "          echo ok",
        "",
    ].join("\n");
    assert.deepEqual(dispatchInputNames(yaml), ["maintenance_message"]);
});

test("dispatchInputNames: inputs の値がブロックスカラーなら、その中のキーは入力と数えない", () => {
    const yaml = [
        "on:",
        "  workflow_dispatch:",
        "    inputs: |",
        "      maintenance_mode:",
        "        type: choice",
        "jobs: {}",
        "",
    ].join("\n");
    assert.deepEqual(dispatchInputNames(yaml), []);
});

test("dispatchInputNames: 複数行の文字列の続き行は、キーと数えない（入力の description の中）", () => {
    const yaml = [
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      maintenance_mode:",
        '        description: "一行目',
        "          maintenance_message: 続き",
        '          二行目"',
        "        type: choice",
        "      maintenance_message:",
        "        type: string",
        "",
    ].join("\n");
    assert.deepEqual(dispatchInputNames(yaml), ["maintenance_mode", "maintenance_message"]);
});

test("dispatchInputNames: インデントの違う（2 空白・4 空白）書き方でも、同じ入力名を数える", () => {
    const yaml = [
        "on:",
        "    workflow_dispatch:",
        "        inputs:",
        "            maintenance_mode:",
        "                type: choice",
        "",
    ].join("\n");
    assert.deepEqual(dispatchInputNames(yaml), ["maintenance_mode"]);
});

test("ALLOW_MISSING_WORKER の説明（docs）は、1 と true（大文字小文字を区別しない）で書く", () => {
    for (const file of ["docs/maintenance-cli.md", "docs/new-site-checklist.md"]) {
        const lines = read(file).split("\n").filter((line) => line.includes("ALLOW_MISSING_WORKER"));
        assert.ok(lines.length > 0, `${file} に ALLOW_MISSING_WORKER の説明がある`);
        for (const line of lines) {
            assert.match(line, /`1`/, `${file}: 1 と書く`);
            assert.match(line, /`true`/, `${file}: true と書く`);
            assert.match(line, /大文字小文字を区別しない/, `${file}: 大文字小文字の扱いを書く`);
        }
    }
});
