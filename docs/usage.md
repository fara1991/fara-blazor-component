# 利用方法（各サイトへの組み込み）

## 1. サブモジュールとして取り込む

```bash
git submodule add https://github.com/fara1991/fara-site-kit.git external/fara-site-kit
git submodule update --init --recursive
```

- 固定するコミット（タグ）は、各サイトのリポジトリで決める。kit の develop の最新を追わない。
- CI のチェックアウトは `submodules: true` にする（`actions/checkout@v4`）。worker や kit を使わない CI は不要。

## 2. Worker の共有 JS を使う

`worker/index.js` の import を、kit の中の同じファイルに向ける。

```js
import { handleReport } from "../external/fara-site-kit/worker/report.js";
import { getMaintenance, maintenanceResponse } from "../external/fara-site-kit/worker/maintenance.js";
```

- wrangler は、サブモジュールの中のファイルもバンドルする（`wrangler deploy --dry-run` で確認する）。
- サイトの `package.json` のテストは、kit のテストファイルを指す（例: `node --test external/fara-site-kit/worker/report.test.mjs`）。

## 3. C# の共通コードを使う（`src/FaraSiteKit.Core`）

```xml
<ProjectReference Include="..\..\external\fara-site-kit\src\FaraSiteKit.Core\FaraSiteKit.Core.csproj" />
```

- 対象は net10.0（.NET 8 のサイトからは参照できない）。`IsPackable` は false（NuGet では配らない）。
- 名前空間は `FaraSiteKit.Core`（`SiteLinks`・`MaintenanceInfo`・`MaintenanceState`・`ReportForm`）。利用するサイトは `using FaraSiteKit.Core;` を書く。
- 起動時に `SiteLinks.DevelopHost` へ、そのサイトの確認用ホスト名（例: `pokemon-dev.fara-labs.com`）を設定する。空のままなら、リンクは切り替えない。
- サブモジュールの中の csproj を参照するため、CI のチェックアウトは `submodules: true`（ネストした submodule がある場合は `--recursive`）。

## 4. 確認

- サイトの `wrangler deploy --dry-run`（本番と確認用の両方）
- サイトの Worker のテスト（`/api/report`・`/api/maintenance` の挙動）
- 確認用サイトで表示を確かめてから、本番へ（サイトの運用どおり）

## 5. サブモジュールを上げる（kit の変更を取り込む）

1. kit で変更を PR → develop にマージ → タグ（`vX.Y.Z`）
2. 各サイトで、サブモジュールをそのタグのコミットに上げる PR（develop 向け）
   - `cd external/fara-site-kit && git fetch --tags && git checkout vX.Y.Z && cd ../.. && git add external/fara-site-kit`
3. 確認用サイトで確認 → master への反映はユーザーが判断

## 6. 静的ファイルを作る（`build/`）

`dotnet publish` などが出したテンプレート（`index.html`）に、ページごとの head（title・description・canonical・OGP・Twitter カード・robots）と本文を差し込み、`robots.txt`・`sitemap.xml`・`404.html`・`_headers`・`_redirects` を書き出す。本文の HTML は呼び出し側（サイトの C# など）が作る。このツールは本文を作らない。

```bash
node external/fara-site-kit/build/build-pages.mjs \
  --site site.json --pages pages.json --template publish/wwwroot/index.html \
  --out publish/wwwroot --env production
```

- `--env production|develop`（確認用は `develop`）。`--site` `--pages` `--template` `--out` は必須。
- モジュールとしても使える: `import { buildPages, writeFiles } from "../external/fara-site-kit/build/build-pages.mjs";`。`buildPages({ site, pages, redirects, template, env })` は、ファイル名 → 内容 の Map を返す（書き込みはしない）。

### テンプレート

- 区切りは `<!-- SEO-HEAD:START -->`・`<!-- SEO-HEAD:END -->`（`<head>` の中）と `<!-- SEO-BODY:START -->`・`<!-- SEO-BODY:END -->`。各 1 つだけ。SEO-BODY は `<div id="app">` の直下（最初の `</div>` より前）に置く。区切りの外（読み込み表示など）は変えない。
- SEO-BODY の中は空にしておく。本文が入った HTML（生成済みの `index.html` など）を `--template` に渡すとエラーになる（404 や SPA のフォールバックに本文が残るのを防ぐ）。`dotnet publish` の出力を使う。
- 本文（`bodyHtml`）は `SEO-BODY` の中に入る。Blazor が起動すると `#app` の中身ごと置き換わる。`bodyHtml` に区切りの文字列を入れるとエラーになる。

### サイト設定（`site.json`）

| 項目 | 必須 | 中身 |
| --- | --- | --- |
| `name` | ○ | サイト名（`og:site_name`・既定の 404 の title・`spaFallback` の title） |
| `origin` | ○ | 本番のホスト（`https://example.com`。末尾の / なし） |
| `devOrigin` | ○ | 確認用のホスト（canonical・sitemap に使う。develop のとき） |
| `lang` | ○ | `<html lang>` の既定（`ja` など）。ページの `lang` で上書きできる |
| `locale` | ○ | `og:locale`（`ja_JP` など） |
| `homeFile` | | `/` のファイル名。既定 `index.html`（avatar の形）。pokemon は `home.html` |
| `urlStyle` | | `html`（既定。`<path>.html`。Cloudflare が拡張子を外す）か `directory`（`<path>/index.html`） |
| `spaFallback` | | `{}` で、汎用の title だけの `index.html` を作る（存在しない URL の SPA フォールバック用）。`homeFile` を `index.html` 以外にする |
| `notFoundPage` | | 既定は `404.html`（noindex・読み込み表示だけの汎用）。`false` で作らない。`{ title, bodyHtml }` で中身を変えられる |
| `robotsDisallow` | | production の robots.txt の Disallow（例: `["/my-", "/api/my/"]`） |
| `developRobots` | | develop の robots.txt。既定 `disallow`（全部 Disallow）。`allow` で `Allow: /` |
| `maxDescription` | | description の最大文字数（既定 160） |
| `csp` | | あれば `_headers` を作る（下の「CSP」）。develop は `X-Robots-Tag: noindex` を付ける |

- 知らない項目は、綴りの間違いとしてエラーにする。
- `developRobots` を既定の `disallow` にすると、クローラーは確認用の `X-Robots-Tag: noindex` を見られない。すでに検索に出ている確認用の URL が消えないことがある。確認用の URL が検索に出ても問題ないサイトは `allow` にする（pokemon は `allow`）。

### ページ一覧（`pages.json`）

配列、または `{ "pages": [...], "redirects": [...] }`。

| 項目 | 必須 | 中身 |
| --- | --- | --- |
| `path` | ○ | `/`（ホーム）か、小文字・数字・ハイフンのパス（`/battle-terms`、`/learn/intro`）。末尾の / は付けない |
| `title` | ○ | `<title>` と `og:title`（エスケープする） |
| `description` | ○ | `meta description` と `og:description`（`maxDescription` を超えるとエラー） |
| `bodyHtml` | ○ | 本文の HTML（そのまま入れる。呼び出し側が安全な HTML にする） |
| `canonical` | | 省略時は `origin` + `path`。`https://` の URL か `/` のパス（同じホストだけ） |
| `noindex` | | `true` で `<meta name="robots" content="noindex">` を付け、sitemap に入れない |
| `ogImage` | | `https://…` か `/` のパス。付けると `og:image` と `summary_large_image` |
| `ogType` | | 既定 `website` |
| `lang` | | このページの `<html lang>` |
| `lastmod` | | `YYYY-MM-DD`（実在する日付）。sitemap の `<lastmod>` |
| `changefreq` / `priority` | | sitemap の `<changefreq>`（`daily` など）・`<priority>`（0 から 1） |
| `jsonLd` | | JSON-LD のオブジェクト。`<script type="application/ld+json">` を、`<` などを \u の形にして出す |

- `noindex` のページに別の `canonical` は指定できない。noindex のページを別のページの canonical にすることもできない（シグナルが矛盾するため）。
- `redirects`: `[{ "from": "/glossary", "to": "/battle-terms", "status": 301 }]`。`from` は既存のページと同じにできない。`status` は 301・302・307・308（既定 301）。`_redirects` に 1 行ずつ書く。

### 出力

| ファイル | 作るとき |
| --- | --- |
| `<path>.html`（`urlStyle` による）・`homeFile` | ページごと |
| `index.html` | `spaFallback` を指定したとき |
| `404.html` | `notFoundPage` が `false` でないとき |
| `robots.txt` | 常に |
| `sitemap.xml` | production のとき（noindex のページは入れない） |
| `_headers` | `csp` を指定したとき |
| `_redirects` | `redirects` が 1 つ以上あるとき |

- 同じ入力は、同じバイト列を出す（決定論的）。
- 入力の問題（path の重複・形・出力ファイル名の重複・区切りの不備など）は、まとめて 1 回のエラーで報告する。エラーのときは何も書き出さない。

### 使い方の例

- **pokemon**（`tools/build-entry-pages.mjs` から移行する予定）: `homeFile: "home.html"`、`spaFallback: {}`、`notFoundPage: false`、`developRobots: "allow"`、`maxDescription: 150`。kit のテスト（`tests/build/pokemon-equivalence.test.mjs`）が、pokemon の現行の出力とバイト単位で同じになることを確かめる。
- **avatar**（C# の Build がページ一覧を作る）: `homeFile` は既定（`index.html`）、`notFoundPage` は既定、`spaFallback` は使わない（`not_found_handling = "404-page"`）。`pages.json` は Markdig で作った本文を `bodyHtml` に入れて C# が書き出し、`dotnet publish` の出力の `index.html` を `--template` に渡す。
- **bot・portfolio**: 同じ。`path` と `bodyHtml` が決まれば、`node` で `buildPages` を呼ぶか、CLI を実行する。

## 7. CSP（`csp/`）

`csp/render-headers.mjs` の `renderHeaders(options)` が `_headers` の本文を作る。テンプレート（`csp/_headers.template`）の形は、pokemon の `_headers` と同じ（テストで同じ CSP になることを確かめている）。

```js
import { renderHeaders } from "../external/fara-site-kit/csp/render-headers.mjs";

renderHeaders({
    scriptSrc: ["https://challenges.cloudflare.com"],
    styleSrc: [],
    fontSrc: ["https://fonts.gstatic.com"],
    imgSrc: [],
    connectSrc: ["https://challenges.cloudflare.com"],
    frameSrc: ["https://challenges.cloudflare.com"],
    noindex: false,
});
```

- 欄: `scriptSrc`・`styleSrc`・`fontSrc`・`imgSrc`・`connectSrc`（`https://` と `wss://`）・`frameSrc`。ホストは使うものだけ書く。`https://ホスト名` の形のみ（`*`・`https:` だけ・パス・`;`・空白は拒否する）。`scriptSrc` と `styleSrc` には `'sha256-…'` のハッシュを書ける（importmap などに使う）。
- 固定の方針（`CLAUDE.md`）: `script-src` に `'unsafe-inline'` と `'unsafe-eval'` は書けない（拒否する）。`'wasm-unsafe-eval'` は固定で入る。`style-src` の `'unsafe-inline'` は MudBlazor のために固定で入る。
- `noindex: true` で `X-Robots-Tag: noindex` を `/*` に付ける。`build-pages` は develop のとき自動で `true` にする。
- `cacheRules`（`[{ "path": "/_framework/*", "value": "public, max-age=31536000, immutable" }]`）は既定では付けない。pokemon の `_headers` にはキャッシュの規則が無いため。`immutable` は、ファイル名にハッシュが付いていないファイルには使わない（デプロイ後に古いファイルが残るため）。
- `build-pages` の `site.json` の `csp` にこの引数を書けば、`_headers` も一緒に作られる。Worker の `/api/*` には付かない（Cloudflare の静的アセットだけ）。
