# fara-blazor-component

Fara のサイト（Pokémon Battle Assistant・Avatar Modding Guide ほか）で共通に使う部品をまとめるリポジトリ。

- 計画: fara-avatar-modding-guide リポジトリの `docs/wasm-migration-plan.md`（§10）
- 本番・確認用のサイトそのものは、このリポジトリには無い（各サイトのリポジトリにある）

## 構成

| 場所 | 中身 | 状態 |
| --- | --- | --- |
| `worker/` | Worker の共有 JS（`maintenance.js`: メンテナンス表示、`report.js`: 作者への報告の受け口、`text.js`: 両方が使う文字列の整え方・`error-summary.js`: 例外ログの要約）と、そのテスト | K0 で取り込み（develop 時点で pokemon と同一内容） |
| `.github/workflows/set-maintenance-all.yml` | kit の Actions「Set maintenance (all sites)」。反映先をチェックボックス(develop / master)、対象を `sites` で選び、4 サイト(album は対象外)のメンテナンス表示(true / notice / 解除 false)をまとめて切り替える。計画に各サイトの現在の状態(/api/maintenance)を出す(`workflow_dispatch` のみ・実行元は master のみ。Environment のシークレット・本番は承認つき。`docs/maintenance-cli.md` の 3) | 0.3.1(0.3.2 でチェックボックスに変更、0.3.4 で migration_wasm を廃止) |
| `docs/` | 利用方法・変更履歴・メンテナンス一括変更 CLI の使い方（`maintenance-cli.md`）・新しいサイトの立ち上げ手順（`new-site-checklist.md`） | K0 で作成 |
| `tools/` | `maintenance.mjs`（補助の CLI。`set` で複数サイトの deploy ワークフローを `gh` でまとめて実行して `MAINTENANCE_MODE` / `MAINTENANCE_MESSAGE` を切り替え、`status` で現在値を見る。Cloudflare API へは書き込まない）と対象の一覧。第一の手段は、各サイトの Actions の「Run workflow」画面で入力して実行する方法（`docs/maintenance-cli.md` の 1。Cloudflare のトークンも手元の環境変数も不要） | 0.3.0 |
| `src/FaraBlazorComponent.Core/` | C#（UI と通信に依存しない共通コード）: `SiteLinks`（確認用ホストへの切り替え）・`MaintenanceInfo`（メンテナンス状態の読み取り）・`ReportForm`（報告の入力の検査） | K0-2 |
| `tests/FaraBlazorComponent.Core.Tests/` | 上の C# の xUnit テスト（`dotnet test`） | K0-2 |
| `.github/workflows/ci.yml` | `npm test`（Node 22、ubuntu）・`lint`（ESLint）・`layout-check`（ブラウザ）と `dotnet test`（global.json の SDK） | K0・v0.6.0 |
| `tools/layout-check/` | レイアウトの自動計測（ESM・playwright-core。幅ごとの崩れ・h1・フォーカス・当たり判定・文字の大きさ・メニューの Esc）。使い方は `docs/layout-check.md` | 0.6.0 |
| `tools/lint/` | ESLint の共通設定（`eslint.config.shared.mjs`）と .NET のアナライザーの設定（`dotnet.editorconfig`。ラチェット）。使い方は `docs/lint.md` | 0.6.0 |
| `src/FaraBlazorComponent.Razor/` | Razor 部品（MudBlazor。SiteLayout・MudProviders・ThemeSwitch・SiteFooter・ReportFormView・NotFoundView など）と静的ファイル | K0-4・K0-5 |
| `samples/MinimalSite/` | Razor 部品を使う最小のサイト（CI でビルドのみ。公開しない） | K0-4 |

## 使い方

各サイトは git submodule で取り込み、必要なファイルを参照する（詳しい手順は `docs/usage.md`）。

```bash
git submodule add https://github.com/fara1991/fara-blazor-component.git external/fara-blazor-component
```

- Worker: `worker/index.js` から `../external/fara-blazor-component/worker/report.js` などを import する（wrangler がバンドルする）
- C#: `ProjectReference` で `external/fara-blazor-component/src/FaraBlazorComponent.Core/FaraBlazorComponent.Core.csproj` を参照する（net10.0。名前空間は `FaraBlazorComponent.Core`。詳しくは `docs/usage.md`）

## テスト

```bash
npm test                  # worker/ の Node テストすべて（Node 22 以上）
npm run test:report
npm run test:maintenance
npm run test:layout-check  # レイアウト計測の統合テスト（ブラウザ。CI は chromium を入れて動かす）
npm run lint               # ESLint（共通設定）
dotnet test tests/FaraBlazorComponent.Core.Tests   # C#（.NET 10 SDK）
dotnet test tests/FaraBlazorComponent.Razor.Tests  # Razor 部品（bUnit）
```

静的解析・レイアウト計測の取り込み方は `docs/lint.md`・`docs/layout-check.md`。

## 関連

- 変更の流れ・ブランチ運用: `CLAUDE.md`
- バージョン（タグ）と変更履歴: `docs/changelog.md`

ライセンス: MIT（LICENSE を参照）
