// pokemon の入口ページの出力と、kit の build（build/build-pages.mjs）の出力が同じであることの確認。
// 基準は tests/fixtures/pokemon/ の pokemon のツール（コミット d3ef26e）。毎回、そのツールを一時フォルダで実行して、出力を比べる。
// 本文（bodyHtml）は、C# が作る役（呼び出し側）を、pokemon の buildBody() で代わりに作って渡す。
//   node --test tests/build/pokemon-equivalence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPages } from "../../build/build-pages.mjs";
import { renderHeaders } from "../../csp/render-headers.mjs";
import * as pokemon from "../fixtures/pokemon/build-entry-pages.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pokemon");
const entries = JSON.parse(readFileSync(join(fixtures, "entry-pages.json"), "utf8"));
const template = readFileSync(join(fixtures, "index.html"), "utf8");

/** pokemon のサイト設定（kit の入力）。pokemon 固有の値はここに集める。 */
const POKEMON_SITE = {
    name: "Pokémon Battle Assistant",
    origin: "https://pokemon.fara-labs.com",
    devOrigin: "https://pokemon-dev.fara-labs.com",
    lang: "ja",
    locale: "ja_JP",
    homeFile: "home.html",
    spaFallback: {},
    notFoundPage: false,
    robotsDisallow: ["/my-", "/data-share", "/api/my/"],
    developRobots: "allow",
    maxDescription: 150,
    bodyRootClass: "entry-static",
};

/** ページ一覧（kit の入力）。bodyHtml は pokemon の buildBody() の出力（C# が作る本文の代わり）。 */
const pages = entries.map((entry) => ({
    path: entry.route === "" ? "/" : `/${entry.route}`,
    title: entry.title,
    description: entry.description,
    bodyHtml: pokemon.buildBody(entry, entries),
}));

/** pokemon のツールを一時フォルダで実行し、出力の名前 → 中身 を返す。 */
function runPokemon(env) {
    const dir = mkdtempSync(join(tmpdir(), "kit-pokemon-equivalence-"));
    writeFileSync(join(dir, "index.html"), template);
    pokemon.run({ dir, env, pagesFile: join(fixtures, "entry-pages.json") });
    return new Map(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

for (const env of ["production", "develop"]) {
    test(`${env}: pokemon の出力と、ファイルの一覧と中身（バイト単位）が同じ`, () => {
        const expected = runPokemon(env);
        const actual = buildPages({ site: POKEMON_SITE, pages, template, env });
        assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
        for (const [name, content] of expected) {
            assert.equal(actual.get(name), content, `${name} が pokemon の出力と違います`);
        }
    });
}

test("_headers: pokemon のホストを渡すと、pokemon の _headers の CSP と同じ行になる（コメントと空行を除く）", () => {
    const pokemonHeaders = readFileSync(join(fixtures, "_headers.pokemon"), "utf8");
    const ours = renderHeaders({
        scriptSrc: ["https://static.cloudflareinsights.com", "https://challenges.cloudflare.com"],
        styleSrc: ["https://fonts.googleapis.com"],
        fontSrc: ["https://fonts.gstatic.com"],
        imgSrc: ["https://raw.githubusercontent.com"],
        connectSrc: ["https://cloudflareinsights.com", "https://challenges.cloudflare.com"],
        frameSrc: ["https://challenges.cloudflare.com"],
    });
    const headerLines = (text) => text.split("\n").filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
    assert.deepEqual(headerLines(ours), headerLines(pokemonHeaders));
});
