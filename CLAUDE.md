# CLAUDE.md

Fara のサイト（Pokémon Battle Assistant・Avatar Modding Guide ほか）で共通に使う部品のリポジトリ（fara-site-kit、公開）。移行の計画は fara-avatar-modding-guide リポジトリの `docs/wasm-migration-plan.md`（§10）を参照。使い方は `docs/usage.md`、README は構成の説明。

## ブランチ運用（必ず守る）

- 作業ブランチは `develop` から作成する（`master` から切らない）
- 作業ブランチの PR は `develop` 向けに作る
- `master` へは `develop` からのみマージする。マージはユーザーが行う（Claude は PR の作成までで、マージしない）
- PR を develop にマージする前に独立レビューを通し、指摘を直してから
- 公開のタグ（`vX.Y.Z`）はユーザーが判断して切る

## 目的と使われ方

- 利用するサイトは、このリポジトリを git submodule（`external/fara-site-kit`）として取り込み、必要なファイルを参照する。NuGet では配らない（決定事項）
- C# は ProjectReference で参照する（`src/FaraSiteKit.Core`、net10.0）
- 利用するサイトの例: pokemon（`external/fara-site-kit`）

## C# 共通コードのルール

- 公開の型・メンバーを変えるときは、利用中のサイト（pokemon など）のビルドが通るか確かめてから
- サイト固有の値（ホスト名・サイト名・作者）は kit に入れない。`SiteLinks.DevelopHost` のように、各サイトが起動時に設定する

## 共有ファイルのルール

- `worker/maintenance.js`・`worker/report.js` と、そのテストは、develop 時点で同一内容（pokemon・avatar・bot の site/worker・portfolio。sha256 で確認）。直すときは kit で直し、各サイトは submodule を上げて取り込む。各サイトに同じファイルを残さない
- サイト固有の変更は、サイトのリポジトリに置く（kit に入れない）
- 公開される API（関数名・ファイル名・戻り値の形）を変えるときは、利用中のサイトが壊れないか確認してから。破壊的変更はメジャーを上げる
- 変更のたびにテストを付ける（`npm test`）

## CSP の方針

- 許す: `script-src` に `'wasm-unsafe-eval'`、`style-src` に `'unsafe-inline'`（MudBlazor のため）
- 許さない: `script-src` の `'unsafe-inline'` と `'unsafe-eval'`。インラインの script は外部ファイルにし、importmap はハッシュで許可する
- kit が持つのは `_headers` のテンプレート（`csp/`）。ホストは各サイトが使うものだけを足す

## 構成メモ

- `worker/`: Worker の共有 JS と Node テスト（`node --test`、Node 22）
- `build/`: 静的ファイル（ページの HTML・robots.txt・sitemap.xml・_headers など）の生成。本文は呼び出し側が作る（使い方は `docs/usage.md` の 6）
- `csp/`: `_headers` のテンプレートと生成関数（`render-headers.mjs`）。Cloudflare の上限を検査する（`_headers` はルール 100 個まで・1 行 2000 文字まで、`_redirects` は静的 2000 件まで・1 行 1000 文字まで）
- `tests/build/`・`tests/csp/`・`tests/fixtures/pokemon/`: 上の 2 つの Node テスト。pokemon の出力と同じになることを確かめる（fixtures は pokemon のファイルのコピー）
- `docs/`: 利用方法（`usage.md`）と変更履歴（`changelog.md`）、一括変更 CLI の使い方（`maintenance-cli.md`）
- メンテナンス表示の切り替えは、第一の手段が各サイトの Actions「Run workflow」画面（入力 `maintenance_mode` / `maintenance_message`。Cloudflare のトークン・環境変数は不要。実行後にジョブサマリーへ値を出す）。雛形は `docs/maintenance-cli.md`
- `.github/workflows/set-maintenance-all.yml` + `tools/maintenance-all.mjs`: kit の Actions から 4 サイトのメンテナンス表示をまとめて切り替える(入力 `target_branch` / `maintenance_mode` / `maintenance_message` / `sites`。`workflow_dispatch` のみ・Environment 2 つ(develop-maintenance は Deployment branches = develop でレビュワー任意、production-maintenance は master のみ・必須レビュワー)。実行 ref と target_branch の組み合わせを検査する(master の ref はすべて可、develop の ref は develop / migration/wasm だけ)・シークレット `SITES_DISPATCH_TOKEN` は Environment のシークレットとして置き、各 job の最後の step にだけ渡す。入力はシェルに埋め込まず環境変数で受けて検査する)。`tests/tools/maintenance-all.test.mjs` がワークフローの構造も検査する
- `tools/maintenance.mjs`（補助）: サイトの Worker の `MAINTENANCE_MODE` / `MAINTENANCE_MESSAGE` をまとめて扱う CLI。`status` は Cloudflare API の GET だけ（Read 権限）。`set` は Cloudflare API に書き込まず、各サイトの deploy ワークフローを `gh workflow run` で手動実行して（入力 `maintenance_mode` / `maintenance_message`）`wrangler deploy --var` で反映する。dev を先に流し、失敗で中断。対象は `tools/maintenance-sites.json`（repo・workflow・ref・Worker 名）。ワークフローの雛形は `docs/maintenance-cli.md`（テストが雛形の入力名を検査）。実 gh・実 API のテストはしない（`tests/tools/`、差し替え）。Worker の変数名は `MAINTENANCE_MODE`（0.3.0 で変更。旧名は読まない）
- `src/FaraSiteKit.Core/`: C#（`SiteLinks`・`MaintenanceInfo`・`ReportForm`）。UI と通信に依存しない純粋なコードだけを置く（Razor・MudBlazor は K0-4 で別のプロジェクトに）
- `tests/FaraSiteKit.Core.Tests/`: C# のテスト（xUnit）。`global.json` の SDK（10.0.x）で実行する
- `.github/workflows/ci.yml`: `npm test`（Node 22）と `dotnet test` を、ubuntu と windows の matrix で並列に実行

## 変更の流れ

1. kit に PR（テストを付ける）→ 独立レビュー → develop にマージ（ユーザー）→ タグ
2. 各サイトで、submodule をそのタグのコミットに上げる PR（develop 向け）→ 確認用で確認 → master への反映はユーザーが判断

## 確認

```bash
npm test
dotnet test tests/FaraSiteKit.Core.Tests
```

- C# の名前空間は `FaraSiteKit.Core`（`SiteLinks`・`MaintenanceInfo`・`MaintenanceState`・`ReportForm` すべて）。利用するサイトは `using FaraSiteKit.Core;` を書く。名前空間を変えると、利用中のサイトが壊れる（破壊的変更）
- `tests/FaraSiteKit.Core.Tests` のテストが正。pokemon の `tests/FaraPokemonBattleAssistant.Web.Tests`（MaintenanceInfoTests・ReportFormTests）は kit の複製で、サイトの組み込みの確認として残す。pokemon 側は組み込みの確認で、内容が同一である必要はない。kit のテストを変えたら、pokemon 側が壊れていないか（pokemon の Web.Tests が通るか）を確認する

## その他

- ライセンスは MIT。コードを足すときは、MIT で公開できない第三者のコード・秘密情報を入れない
