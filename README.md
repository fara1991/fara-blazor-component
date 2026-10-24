# fara-site-kit

Fara のサイト（Pokémon Battle Assistant・Avatar Modding Guide ほか）で共通に使う部品をまとめるリポジトリ。

- 計画: fara-avatar-modding-guide リポジトリの `docs/wasm-migration-plan.md`（§10）
- 本番・確認用のサイトそのものは、このリポジトリには無い（各サイトのリポジトリにある）

## 構成

| 場所 | 中身 | 状態 |
| --- | --- | --- |
| `worker/` | Worker の共有 JS（`maintenance.js`: メンテナンス表示、`report.js`: 作者への報告の受け口）と、そのテスト | K0 で取り込み（develop 時点で pokemon と同一内容） |
| `docs/` | 利用方法・変更履歴・メンテナンス一括変更 CLI の使い方（`maintenance-cli.md`） | K0 で作成 |
| `.github/workflows/set-maintenance-all.yml` | kit の Actions「Set maintenance (all sites)」。反映先をチェックボックス(develop / master)で選び、5 サイトのメンテナンス表示をまとめて切り替える(`workflow_dispatch` のみ・実行元は master のみ。Environment のシークレット・本番は承認つき。`docs/maintenance-cli.md` の 3) | 0.3.1(0.3.2 でチェックボックスに変更、0.3.4 で migration_wasm を廃止) |
| `tools/` | `maintenance.mjs`（補助の CLI。`set` で複数サイトの deploy ワークフローを `gh` でまとめて実行して `MAINTENANCE_MODE` / `MAINTENANCE_MESSAGE` を切り替え、`status` で現在値を見る。Cloudflare API へは書き込まない）と対象の一覧。第一の手段は、各サイトの Actions の「Run workflow」画面で入力して実行する方法（`docs/maintenance-cli.md` の 1。Cloudflare のトークンも手元の環境変数も不要） | 0.3.0 |
| `src/FaraSiteKit.Core/` | C#（UI と通信に依存しない共通コード）: `SiteLinks`（確認用ホストへの切り替え）・`MaintenanceInfo`（メンテナンス状態の読み取り）・`ReportForm`（報告の入力の検査） | K0-2 |
| `tests/FaraSiteKit.Core.Tests/` | 上の C# の xUnit テスト（`dotnet test`） | K0-2 |
| `.github/workflows/ci.yml` | `npm test`（Node 22、ubuntu）と `dotnet test`（global.json の SDK） | K0 |
| `src/FaraSiteKit.Razor/` | Razor 部品（MudBlazor。SiteLayout・MudProviders・ThemeSwitch・SiteFooter・ReportFormView・NotFoundView など）と静的ファイル | K0-4・K0-5 |
| `samples/MinimalSite/` | Razor 部品を使う最小のサイト（CI でビルドのみ。公開しない） | K0-4 |

## 使い方

各サイトは git submodule で取り込み、必要なファイルを参照する（詳しい手順は `docs/usage.md`）。

```bash
git submodule add https://github.com/fara1991/fara-site-kit.git external/fara-site-kit
```

- Worker: `worker/index.js` から `../external/fara-site-kit/worker/report.js` などを import する（wrangler がバンドルする）
- C#: `ProjectReference` で `external/fara-site-kit/src/FaraSiteKit.Core/FaraSiteKit.Core.csproj` を参照する（net10.0。名前空間は `FaraSiteKit.Core`。詳しくは `docs/usage.md`）

## テスト

```bash
npm test                  # worker/ の Node テストすべて（Node 22 以上）
npm run test:report
npm run test:maintenance
dotnet test tests/FaraSiteKit.Core.Tests   # C#（.NET 10 SDK）
dotnet test tests/FaraSiteKit.Razor.Tests  # Razor 部品（bUnit）
```

## 関連

- 変更の流れ・ブランチ運用: `CLAUDE.md`
- バージョン（タグ）と変更履歴: `docs/changelog.md`

ライセンス: MIT（LICENSE を参照）
