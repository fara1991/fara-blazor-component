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
- C# は ProjectReference で参照する（`src/FaraSiteKit.Core`、net8.0）
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
- kit が持つのは `_headers` のテンプレート（`csp/`、ステップ 4 以降）。ホストは各サイトが使うものだけを足す

## 構成メモ

- `worker/`: Worker の共有 JS と Node テスト（`node --test`、Node 22）
- `docs/`: 利用方法（`usage.md`）と変更履歴（`changelog.md`）
- `src/FaraSiteKit.Core/`: C#（`SiteLinks`・`MaintenanceInfo`・`ReportForm`）。UI と通信に依存しない純粋なコードだけを置く（Razor・MudBlazor は K0-4 で別のプロジェクトに）
- `tests/FaraSiteKit.Core.Tests/`: C# のテスト（xUnit）。`global.json` の SDK（8.0.x）で実行する
- `.github/workflows/ci.yml`: `npm test`（Node 22）と `dotnet test`（ubuntu）を実行

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
