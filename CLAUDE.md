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
- C# は ProjectReference で参照する（ステップ 2 以降）
- 利用するサイトの例: pokemon（`external/fara-site-kit`）

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
- `.github/workflows/ci.yml`: `npm test` を ubuntu で実行
- C#（`src/`）と Razor 部品は、ステップ 2 以降で作る（K0 では作らない）

## 変更の流れ

1. kit に PR（テストを付ける）→ 独立レビュー → develop にマージ（ユーザー）→ タグ
2. 各サイトで、submodule をそのタグのコミットに上げる PR（develop 向け）→ 確認用で確認 → master への反映はユーザーが判断

## 確認

```bash
npm test
```
