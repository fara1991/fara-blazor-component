# 変更履歴（バージョン）

kit は SemVer のタグ（`vX.Y.Z`）で切る。各サイトは、タグのコミットに固定して使う。破壊的変更（API・名前空間・ファイル名）はメジャーを上げる。

## 0.3.0

**破壊的変更**: Worker の変数名 `MAINTENANCE` を **`MAINTENANCE_MODE`** に変更した。値（`true` / `notice` / `false`）と挙動（true = 全体 503 のメンテナンス画面、notice = お知らせ帯、false = 通常）は同じ。`MAINTENANCE_MESSAGE` は変えない。**旧名 `MAINTENANCE` は読まない**（フォールバックなし）。旧名だけが設定されている Worker は、通常動作になる（メンテナンス画面もお知らせも出ない）。

- `worker/maintenance.js`: `getMaintenance(env)` が `env.MAINTENANCE_MODE` を読む。旧名だけの設定は通常（テストで固定）。
- コメント・説明文（`MaintenanceInfo`・`MaintenanceBanner`・`MaintenanceScreen`・CSS）の変数名を更新。C# の公開 API・Worker の `/api/maintenance` の JSON の形は変わらない。
- 追加: 一括変更 CLI `tools/maintenance.mjs`（Node・依存なし）と対象の一覧 `tools/maintenance-sites.json`。`status`（現在値の一覧）・`set`（`--env` `--site` `--mode` `--message`）・`rename`（旧 `MAINTENANCE` → `MAINTENANCE_MODE`。移行用）。既定はドライラン、`--apply` で実行、本番はサイト名の入力が必須。使い方は `docs/maintenance-cli.md`。テスト `tests/tools/maintenance-cli.test.mjs`（API は fetch を差し替え）。
- `docs/usage.md` に 2.1「メンテナンスの変数」を追加。

### 各サイトの移行手順（kit を 0.3.0 に上げるとき）

kit を上げた Worker が公開された時点から旧名は効かなくなる。**公開（本番）の前に、新しい変数を用意しておく**（順序を守らないと、メンテナンス中・お知らせ中の Worker が通常に戻る）。

1. Cloudflare の各 Worker に `MAINTENANCE_MODE` を作り、いまの `MAINTENANCE` と同じ値にする。まとめてやるなら `node tools/maintenance.mjs rename --env dev`（ドライランで確認 → `--apply`）、続けて `--env production`。`MAINTENANCE` を消すのは手順 4。（`rename` は新変数の作成と旧変数の削除を一度に行う。kit を上げる前に旧変数を消してよいのは、まだ旧い kit の Worker が動いていない＝公開前のサイトだけ。公開済みのサイトは、kit を上げて公開してから `rename` する。その間の短い時間、状態は通常に戻る）
2. サイトの `wrangler` / ワークフローの `--var MAINTENANCE:...` を `--var MAINTENANCE_MODE:...` に変える（`deploy.yml` / `site.yml` など）。
3. `require-maintenance.mjs` 相当のスクリプトが読む変数名（`readMaintenanceValue` の `b.name === "MAINTENANCE"`）を `MAINTENANCE_MODE` にし、メッセージ・テストも合わせる。`SKIP_MAINTENANCE_CHECK` は変えない。
4. 旧変数 `MAINTENANCE` を各 Worker から削除する（`rename` を使った場合は削除済み）。
5. サイトの README・docs・テストの `MAINTENANCE`（変数名としての参照）を `MAINTENANCE_MODE` に直す。`MAINTENANCE_MESSAGE` は直さない。
6. submodule を `v0.3.0` に上げる PR（develop 向け）→ 確認用で、`notice` / `true` / `false` の表示を確認。

## 0.2.1

pokemon の PR-2（kit 採用）で見つかった課題の修正。既存のパラメータ・クラス名は変えない（追加のみ。1 件だけ、下の Worker のお知らせの class 名に注意）。

- `fara-site-kit.css`: `ReportFormView` が使うのに定義が無かった `fsk-mb-0`・`fsk-mb-1`・`fsk-mb-3`・`fsk-mt-3`・`fsk-small`・`fsk-muted`・`fsk-form-group`・`fsk-form-label` と、`fsk-card`・`fsk-card-body` の構造（flex の縦並び・内側の余白）を追加。色は kit のトークン（`--fsk-muted`・`--fsk-border`）。`--fsk-card-spacer`（既定 1rem）で余白を替えられる。サイトが app.css で補う必要はなくなる。
- `SiteLayout`: `MobilePageScroll` パラメータを追加（既定 false = 従来どおり、スマホでもページ全体を画面の高さに固定）。true にすると、スマホ（767.98px 以下）でページ全体がスクロールする（クラス `fsk-page-scroll`）。
- `worker/maintenance.js`: `noticeHtml` の class を `maintenance-notice*` から `fsk-notice`・`fsk-notice-title`・`fsk-notice-text` に変更（Razor の `MaintenanceBanner` と同じ）。**名前の変更**: 旧い class の CSS を自分で書いているサイトは、`fsk-notice*` に読み替える（kit の CSS を読めば、そのまま見た目が付く）。
- `boot-indicator.js`: メンテナンス画面（`.fsk-maintenance`。`.mud-layout` が無い）が描かれたら、読み込み表示を外す（以前は 60 秒のタイムアウトまで残った）。
- `docs/usage.md`: 8.12「導入手順（小規模サイト向け）」を追加。`MobilePageScroll` の説明。
- JS のテストを追加（PR #8）: `tests/js/boot-indicator.test.mjs`（45 秒・60 秒のタイマー、inert の戻し、blazor.webassembly.js の読み込み失敗、MutationObserver が無いとき、メンテナンス画面での解除）・`tests/js/scroll-progress.test.mjs`。pokemon の tests/js（e68d150）から移植。
- テスト: `MobilePageScroll` のクラス、追加した CSS の定義、worker の class 名、読み込み表示の解除。

## 0.2.0 まで

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
