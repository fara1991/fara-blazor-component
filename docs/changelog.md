# 変更履歴（バージョン）

kit は SemVer のタグ（`vX.Y.Z`）で切る。各サイトは、タグのコミットに固定して使う。破壊的変更（API・名前空間・ファイル名）はメジャーを上げる。

## 未リリース

- JS のテストを追加: `tests/js/boot-indicator.test.mjs`（45 秒・60 秒のタイマー、inert の戻し、blazor.webassembly.js の読み込み失敗、MutationObserver が無いとき）・`tests/js/scroll-progress.test.mjs`（スクロール対象の選択: 入れ子・最も背の高い要素・画面替えの選び直し・resize・同値なら書かない）。pokemon の tests/js（e68d150）から移植。

- K0: 骨格（`worker/`: `maintenance.js`・`report.js` とテスト、CI、利用方法）。pokemon の develop 時点と同一内容を取り込み。
- K0-2: C#（`src/FaraSiteKit.Core`、net8.0）: `SiteLinks`（`DevelopHost` を追加し、サイト固有のホスト名を持たせない）・`MaintenanceInfo`・`ReportForm`。pokemon の同名クラスから移動（名前空間は `FaraSiteKit.Core` に統一。移す前は `FaraPokemonBattleAssistant.*`）。テスト `tests/FaraSiteKit.Core.Tests`（69 件）。CI に `dotnet test` を追加。
- CI: ubuntu と windows の matrix（`test`・`dotnet` の両ジョブ）。ジョブ名が `test (ubuntu-latest)` のように変わる（ブランチ保護の必須チェック名を合わせる）。
- .NET 10 へ移行: C#（`src/FaraSiteKit.Core`・テスト）を net10.0 に、`global.json` を SDK 10.0.100（latestFeature）に。.NET 8 のサイトからは参照できなくなる（破壊的変更）。
- K0-4 / K0-5: Razor 部品（`src/FaraSiteKit.Razor`、net10.0、MudBlazor 9.11.0）: `SiteLayout`（ヘッダー・サイドバー・検索の欄・スキップリンク・フッターの固定）・`MudProviders`・`ThemeSwitch`（テーマの保存は `SiteThemeState`、描画の前の反映は `theme-init.js`）・`SiteNavMenu`（`SiteNavItem`・`SiteNavGroup`）・`SiteFooter`・`SocialLinks`（URL はサイト設定。空は出さない）・`MaintenanceBanner`・`MaintenanceScreen`・`ReportFormView`（タイムアウトを通信エラーとして案内）・`NotFoundView`・`ScrollProgress`。静的ファイル（`wwwroot/`）は `_content/FaraSiteKit.Razor/...`。`SiteOptions`（Core）と `AddFaraSiteKit`。
- Razor のテスト `tests/FaraSiteKit.Razor.Tests`（bUnit 2.12.5。108 件）と、最小のサイト `samples/MinimalSite`（CI のビルド）。
- 利用方法: `docs/usage.md` の 6（Razor の部品）、`docs/index-template.html`（index.html の断片）。
- CI: dotnet ジョブに Razor のテストと、サンプルのビルドを追加（ジョブ名は変えない）。
- 注意: `SocialLinks`・`SiteFooter` の名前は、pokemon の同名の型と衝突する（取り込み時は、pokemon 側の名前を外してから using する）。

- K0-3: `build/build-pages.mjs`（pokemon の `tools/build-entry-pages.mjs` を一般化。本文は呼び出し側が作る）と `csp/render-headers.mjs`（`_headers` の生成。テンプレート `csp/_headers.template`）。テスト `tests/build`・`tests/csp`（pokemon の出力とバイト単位で一致することを含む）。
- PR #7 の独立レビューの対応（未リリース。kit の API と CSS 名の変更は、まだ利用していないサイトが対象）:
  - 報告の文字数を、コードポイント単位に変更（worker/report.js と同じ。絵文字は 1 文字）。`ReportForm.CountCharacters` を追加。**挙動の変更**: UTF-16 の長さで数えていた既存の入力（絵文字を含む）の判定が変わる。
  - `MaintenanceScreen.Lead` は文字として出す（HTML は出さない。改行だけが改行）。**挙動の変更**: HTML の `<br />` を入れていた呼び出しは、改行（`
`）に直す。
  - `SocialLinks` は https:// の URL だけを出す（javascript:・data:・http: は描かない）。
  - `SiteLayout`: `ShowDrawer`・`TopNav`・`CollapseTopNavOnMobile`（上部ナビだけの構成）。Esc で検索の欄を閉じる。ページの移動で本文へフォーカス。起動の後に、theme-init.js のキーと SiteOptions の食い違いを警告（`faraSiteKit.checkConfig`）。フッターは `<footer>`（contentinfo）として本文の外に置き、全幅で固定。
  - `SiteFooter`: 作者のホームページのリンクは、実行中のホスト名で確認用に切り替える（`SiteLinks.CurrentHost` を手で入れない）。
  - `NotFoundView`・長文のページ幅（`fsk-page-column--wide`）。
  - クラス名を `fsk-` の接頭辞に統一（`content`・`page-column`・`card`・`nowrap` など。移行の表は docs/usage.md の 8.9）。**名前の変更**: 旧い名前を使っているサイトは、CSS を読み替える。
  - 100vh の後に 100dvh を書く（iOS の高さ）。フッターの高さは CSS（flex）だけで決める（`--footer-height` と JS の計測は廃止）。
  - `csp/render-headers.mjs` に `presets`（Turnstile・Google Fonts）。
  - テスト: Razor 133 件・Core 73 件・npm 126 件（JS の `tests/js/kit-js.test.mjs` を含む）。
  - 保存のキーの既定（`fara-site-kit.*`）は変えない。移行の手順は docs/usage.md の 8.6。
