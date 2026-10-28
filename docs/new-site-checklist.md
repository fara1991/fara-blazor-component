# 新しいサイトを作るときのチェックリスト

kit を使う新しいサイト（Blazor WebAssembly + MudBlazor を Cloudflare Workers の静的アセットで公開）を、ゼロから立ち上げる手順。`fara-vrc-photo-album`（Fara Album）の M0 で **実際に踏んだ順序** を元にしている。部品ごとの詳しい使い方は `docs/usage.md`、メンテナンス表示は `docs/maintenance-cli.md`。参照の実装は、avatar（`deploy.yml`・`verify-site.mjs`・`require-maintenance.mjs`）と vrc-photo-album（上の 3 つに加え `tools/site.mjs`・`tests/js/wrangler-config.test.mjs`・`.github/scripts/deploy-workflow.test.mjs`）。

## 0. 先に決めること

- リポジトリ名・公開範囲（人名などを含むなら private。**private + 無料プランではブランチ保護（branch protection）が設定できない**（API が 403。avatar・portfolio も同じ。kit は public で ruleset がある）。Environments のブランチ制限は private でも使えている（avatar・portfolio で確認）。取り違えは deploy.yml の中の照合と、下の関門で防ぐ）
- ホスト名（本番 `xxx.fara-labs.com`・確認用 `xxx-dev.fara-labs.com`）と Worker 名（`fara-xxx`・`fara-xxx-dev`）
- .NET: kit は net10.0。`global.json` は kit と同じ（SDK 10.0.100、`rollForward: latestFeature`）。MudBlazor は kit と同じ版（9.11.0）にそろえる（ずれると二重になる）
- 保存のキー（`<サイト>.settings`・`<サイト>.sidebar-hidden`）。**C# の `SiteOptions`・index.html の `theme-init.js` の `data-*`・既定テーマの JS の 3 か所を同じ値にする**

## 1. リポジトリ（Claude / 開発者）

1. `gh repo create <名前> --private`、空の初期コミットで `master`、そこから `develop` を作る
2. 作業ブランチは `develop` から。PR は develop 向け。`master` へは develop からだけ（マージはユーザー）
3. ルートに `global.json`・`Directory.Build.props`（pokemon のもの。Windows と WSL で obj/bin を分ける）・`.editorconfig`・`.gitattributes`（`* text=auto eol=lf`）・`.gitignore`（`bin/ obj/ bin.unix/ obj.unix/ node_modules/ dist/ publish/ site-*/ .wrangler/`）
4. `git submodule add https://github.com/fara1991/fara-blazor-component.git external/fara-blazor-component` → `cd external/fara-blazor-component && git checkout vX.Y.Z`（タグに固定する。develop を追わない）
5. **注意**: ルートに `Directory.Packages.props`（中央パッケージ管理）を置かない。MSBuild が上のフォルダへたどって kit の csproj にも効き、`Version=` 付きの PackageReference が NU1008 で壊れる
6. 新規ファイルは LF（`core.autocrlf false`）。`dotnet sln add` は kit の csproj も sln に入れるが問題ない

## 2. プロジェクトの構成（目安）

- `Shared`（モデル・規則。ブラウザとビルドで共用）／`Content`（ビルド時のみ）／`Pages`（Razor クラスライブラリ。Web と Build の `HtmlRenderer` で共用するページ部品）／`Web`（Blazor WASM）／`Build`（CLI）と、それぞれの Tests
- `Pages` の部品は素の HTML だけにする（MudBlazor を入れると Build 側にも MudBlazor のサービス登録が要る）。リンクは相対パス（`<base href="/">` の下で解決）
- `Web` の csproj: `Microsoft.AspNetCore.Components.WebAssembly` と `MudBlazor` の版、`FaraBlazorComponent.Core`・`FaraBlazorComponent.Razor` の ProjectReference、`CompressionEnabled=false`（Cloudflare が配信時に圧縮する）、`InvariantGlobalization=true`（日付は自前で書式化）
- `Program.cs`: `AddFaraBlazorComponent(...)`・`MaintenanceInfo.LoadAsync`（`/api/maintenance`。2 秒で打ち切り）・`HeadOutlet`。**最初の描画の前に、データ（JSON）の読み込みと同時にメンテナンスの状態を読む**（静的な本文を空の画面に置き換えないため）。データが読めないときは起動せず、`#blazor-error-ui` を出す（静的 HTML が残る）。`MaintenanceInfo` が On のときは `MaintenanceScreen` だけを `#app` に置く
- `SiteLayout`: ヘッダーの名前を画像にするなら `Brand` に `<a class="fbc-brand" href="./" title="ホームへ"><img alt="サイト名" width height></a>`（kit の変更は不要）
- **`Router` の同じ画面に 2 つの `@page`（`"/"` と `"/page/{n:int}"`）を付けると、`"/"` で int の値が 0 になる**。ページごとにコンポーネントを分けて、共通の部品を呼ぶ
- 既定のテーマをダークにするなら、`theme-init.js` の**直後**に読む外部 JS（保存が無いときだけ `data-bs-theme=dark`）と、C# の起動後（`SiteThemeState.SetAsync(Dark)`）の両方が要る。片方だけだと `ThemeSwitch` の表示と `html` がずれる

## 3. 静的ファイル（build-pages）

- `index.html`（`dotnet publish` の出力がテンプレートになる）に `<!-- SEO-HEAD:START/END -->` と、`<div id="app">` の直下に `<!-- SEO-BODY:START/END -->`（中は空）。インラインの `<script>` は CSP で止まるので外部ファイルにする
- `tools/site.json`: `name`・`origin`・`devOrigin`・`bodyRootClass: "entry-static"`・`csp`（`cacheRules` を含む）。**`bodyHtml` はすべて（404 以外）先頭の要素に `class="entry-static"` が要る**（`<main class="entry-static">`）
- Build が `pages.json`（`{ pages, redirects }`）を作り、`node external/fara-blazor-component/build/build-pages.mjs --site … --pages … --template publish/wwwroot/index.html --out site-<env> --env production|develop` を呼ぶ。**`--out` はテンプレートと別のフォルダ**（`publish/wwwroot` をコピーして使う）
- `HtmlRenderer` の既定の `HtmlEncoder` は日本語を `&#x30B5;` にする。`HtmlEncoder.Create(UnicodeRanges.All)` をサービスに登録すると読める HTML になる。`data/*.json` も `UnsafeRelaxedJsonEscaping` で `\u` を避ける（fetch で読む JSON は HTML に埋め込まないので安全）
- CSP の外部画像ドメインなどは、設定値（例: `ImageBaseUrl`）から Build が `csp.imgSrc` に足す（二重管理しない）。kit の `_headers` は `/*` と cacheRules の規則だけ。サイト固有の追加（例: 検索に載せないパスの `X-Robots-Tag`）は Build が後から追記する（規則は 100 個まで）
- `/page/1` → `/` のような **リダイレクトを 1 件以上** 入れると `_redirects` が出る（検査で必須にしているなら）

## 4. wrangler.jsonc と Worker

- 本番はトップレベル、確認用は `env.develop`。`keep_vars: true` は **トップレベルだけ**（env の中に書くと wrangler が警告する）。`workers_dev: false`・`preview_urls: false`（Access・WAF をすり抜けないため）。wrangler の版は `package.json` で固定
- `worker/index.js` は portfolio のもの（`../external/fara-blazor-component/worker/{maintenance,report}.js` を import）。テストは kit の `worker/*.test.mjs` と自前の `worker/index.test.mjs`
- `run_worker_first`: `true`（全リクエストが Worker。無料枠 1 日 10 万）か、**`["/*", "!/_framework/*", "!/_content/*", …]` の配列**（`wrangler dev` で除外が効くことを確認済み）。**`"/*.html"` のような拡張子の指定は、拡張子なしの URL（`/posts/foo`）に一致しない**ので、メンテナンスの 503 が HTML に効かなくなる。データ（`/data/*`）は除外しない（メンテナンス中も止める）
- 手元の確認: `wrangler dev --var MAINTENANCE_MODE:true` で、`/`・`/xxx/yyy`・`/data/…` が 503、`/_framework/…` が 200 かを見る。HTML（Worker 経由）と `_framework`（直接）の**両方**に `Content-Security-Policy` ヘッダーがあることも確認する（無いと CSP 違反の検査が何も見ていない）

## 5. 公開の関門と GitHub Actions

- avatar の `deploy.yml` を雛形にする（`on: push [master, develop]`・`pull_request`・`workflow_dispatch`（`skip_maintenance_check`・`maintenance_mode`・`maintenance_message`）、build ジョブと deploy ジョブ）。**kit の一括変更 CLI は、この入力名の workflow を `gh workflow run` で動かす**
- build ジョブ: submodule つきで checkout → setup-dotnet → setup-node → `npm ci` → build/test → Node のテスト → publish → 本番用・確認用の出力を両方作る → **`verify-site.mjs` で両方検査** → wrangler dry-run（両環境）→ artifact。PR ではシークレットを使わない
- deploy ジョブ（master / develop の push のみ）: 公開先の環境の出力だけを取り出して `verify-site` → 本番は `require-maintenance.mjs <Worker 名>`（`MAINTENANCE_MODE=notice` のときだけ公開。Cloudflare API の 404（Worker が無い）は失敗にする。初回の公開だけ、ワークフローの入力 `first_publish`（boolean）を true にして、環境変数 `ALLOW_MISSING_WORKER` を `1` か `true`（大文字小文字を区別しない）にして通す（Worker 名の打ち違い・権限不足を、初回と取り違えないため）→ 公開。**本番の初回は `--var MAINTENANCE_MODE:true` を付けてメンテナンス画面のまま作る**。公開前にブランチと環境の取り違えを `run` の先頭で止める
- `verify-site.mjs` は avatar のものを写すときに 2 点直す: (1) 本番の `_headers` に `/people` など一部のパスの `X-Robots-Tag: noindex` を足すサイトでは、**`/*` のルールの中だけ**を見る（全体を grep すると本番の出力を拒否する）、(2) 必須ファイルをサイトのページに合わせる。`require-maintenance.mjs` は avatar と同一内容にしておく（kit への切り出しの候補）
- deploy.yml の公開ステップの `run` は、テストで実際に bash で動かせる（`npx` を引数を出す関数に差し替える）。`deploy-workflow.test.mjs`（portfolio・vrc-photo-album）が雛形
- **ワークフローのファイルを含む push は SSH で行う**（gh の OAuth token に `workflow` スコープが無い）
- ワークフローを書いたら、`tools/maintenance-sites.json` にサイトを足す（repo・workflows・workers）。**対象のブランチに workflow がまだ無いと、事前確認が 404 で「飛ばす」警告になる**ので、deploy.yml が develop と master に入ってからマージする。`tests/tools/` の「4 サイト」前提のテストも直す。`SITES_DISPATCH_TOKEN` の PAT の対象リポジトリにも追加する（ユーザー作業）。**本番の初回公開をメンテナンス画面のまま作るサイトは、公開準備ができるまで、本番（production）の workflow・Worker を載せない**（本番を含む一括切替の `notice` / `false` が、メンテ画面のままの本番を意図せず公開するため。develop だけ載せ、本番は公開準備ができてから足す。fara-vrc-photo-album がこの扱い）

## 6. Cloudflare・GitHub の手作業（ユーザー）

新サイトの `docs/cloudflare-setup.md` に、優先順の表で書く（vrc-photo-album のものが雛形）。

1. DNS に新ホストの既存レコードが無いこと（あるとカスタムドメインの自動作成が失敗）
2. GitHub: Secrets `CLOUDFLARE_API_TOKEN`、Variables `CLOUDFLARE_ACCOUNT_ID`（既存サイトと同じトークンを使える。Workers Scripts の Edit（Read を含む）が必要。Workers Routes Edit・Zone DNS Edit はカスタムドメインの自動作成用。Account Settings の Read は `require-maintenance` が Worker の設定を読むためと書いてきたが、表記が実態と合うかは未確認）
3. Environments `production`（master のみ）・`develop`（develop のみ）（private でも branch_policy は使える）
4. Cloudflare Access: 確認用ホストを既存の Application に追加
5. Turnstile: 新ホストを追加。Worker に `TURNSTILE_SITE_KEY`・`TURNSTILE_SECRET`・`DISCORD_WEBHOOK_URL`（シークレット）・`MAINTENANCE_MODE`・`MAINTENANCE_MESSAGE`（テキスト）
6. 初回の公開 → 確認用で確認 → master へのマージ（ユーザー）→ メンテナンス画面のまま作られる → Run workflow で `maintenance_mode=false`

## 7. ブラウザの確認（Playwright。CI では動かさない）

`playwright-core` は作業用フォルダに入れる。`wrangler dev` で配信して、PC 1280・スマホ 390 × ダーク・ライトで、(1) JS 無効で静的 HTML に本文がある (2) 起動後に同じ見出しが残り `#boot-indicator` が外れる (3) CSP 違反 0・コンソールのエラー 0（外部の画像は route で止めず 1x1 の画像を返すとコンソールが静か）(4) ヘッダーのロゴ・フォーカス枠 (5) メンテナンス（`/api/maintenance` を差し替え）(6) 404。

- **既知の落とし穴（フォーカス枠）**: MudBlazor の reset により、サイト全体の `a` で `outline-style: none` になり、キーボードのフォーカス枠が出ない。kit の `.fbc-header :focus-visible` は `outline-color` だけを決めていて、ヘッダーのブランドのリンクも同じ（文字でも画像でも）。**kit 側で全リンクに枠を戻すのが本筋**（修正候補）。それまでは、サイトの CSS で本文・ギャラリー・フッター・ブランドのリンクに `:focus-visible { outline: 2px solid … }` を足し、Tab で到達して枠が見えることを Playwright で確かめる（vrc-photo-album の `tools/verify/m0-smoke.mjs`）
- 配信が重いと `requestfailed: …/api/maintenance` が 1 件出ることがある（`MaintenanceInfo` の 2 秒の打ち切り。不具合ではない）。もう一度実行する
- Windows の node には `E:/…` の形でパスを渡す（`/e/…` は解釈されない）。起動した `wrangler dev` は PID を控えて `taskkill /PID <pid> /T /F` で止める
