# 1.0.0 への移行ガイド（fara-site-kit → fara-blazor-component）

対象: 0.8.0 以前の kit を使っているサイト（pokemon・avatar・bot・portfolio（fara-labs）・album）。

1.0.0 は破壊的変更（リポジトリ名・名前空間・CSS のクラス・変数・id・JS の名前を、すべて新名にそろえる）。**旧名の別名・読み替え・互換の層は作らない**。各サイトは、このガイドの手順で submodule の付け替えと名前の置き換えを一度に行い、CSS・JS・テストを確かめてから、1.0.0 のタグに上げる PR（develop 向け）で取り込む。

この文書の旧名（`fara-site-kit`・`FaraSiteKit`・`fsk-` など）は、対応表と手順の説明にだけ残す。

## 1. 対応表

### 1.1 リポジトリ・submodule・パス

| 旧 | 新 |
| --- | --- |
| GitHub: `fara1991/fara-site-kit` | `fara1991/fara-blazor-component` |
| submodule のフォルダ: `external/fara-site-kit` | `external/fara-blazor-component` |
| `src/FaraSiteKit.Core/FaraSiteKit.Core.csproj` | `src/FaraBlazorComponent.Core/FaraBlazorComponent.Core.csproj` |
| `src/FaraSiteKit.Razor/FaraSiteKit.Razor.csproj` | `src/FaraBlazorComponent.Razor/FaraBlazorComponent.Razor.csproj` |

`worker/`・`build/`・`csp/`・`tools/`・`samples/` の中のファイル名は変わらない。変わるのは、サイトから見た接頭辞（`external/fara-site-kit/` → `external/fara-blazor-component/`）だけ。

### 1.2 C#（名前空間・プロジェクト・拡張メソッド）

| 旧 | 新 |
| --- | --- |
| `FaraSiteKit.Core`（`using FaraSiteKit.Core;`） | `FaraBlazorComponent.Core` |
| `FaraSiteKit.Razor`・`FaraSiteKit.Razor.Components`（`@using`） | `FaraBlazorComponent.Razor`・`FaraBlazorComponent.Razor.Components` |
| `AddFaraSiteKit(...)`（`Program.cs`） | `AddFaraBlazorComponent(...)` |

### 1.3 静的アセット（Razor のパッケージ）

| 旧 | 新 |
| --- | --- |
| `_content/FaraSiteKit.Razor/css/fara-site-kit.css` | `_content/FaraBlazorComponent.Razor/css/fara-blazor-component.css` |
| `_content/FaraSiteKit.Razor/js/fara-site-kit.js` | `_content/FaraBlazorComponent.Razor/js/fara-blazor-component.js` |
| `_content/FaraSiteKit.Razor/js/theme-init.js`・`boot-indicator.js`・`scroll-progress.js`・`report.js` | `_content/FaraBlazorComponent.Razor/js/…`（ファイル名は同じ） |

### 1.4 CSS（クラス・変数・id）

kit の CSS（改名前の `fara-site-kit.css`）と、kit の JS・Razor・Worker が付ける名前を、機械的に抽出した一覧。サイトの CSS が上書きしている名前は、すべてこの表に載る（2.3 の数を参照）。

| 旧 | 新 | 種類・備考 |
| --- | --- | --- |
| `--fsk-body-bg` | `--fbc-body-bg` | CSS 変数 |
| `--fsk-border` | `--fbc-border` | CSS 変数 |
| `--fsk-brand` | `--fbc-brand` | CSS 変数 |
| `.fsk-btn-primary` | `.fbc-btn-primary` | class |
| `.fsk-card` | `.fbc-card` | class |
| `.fsk-card-body` | `.fbc-card-body` | class |
| `--fsk-card-spacer` | `--fbc-card-spacer` | CSS 変数 |
| `.fsk-content` | `.fbc-content` | class |
| `.fsk-drawer-close` | `.fbc-drawer-close` | class |
| `.fsk-drawer-head` | `.fbc-drawer-head` | class |
| `.fsk-field` | `.fbc-field` | class |
| `--fsk-field-bg` | `--fbc-field-bg` | CSS 変数 |
| `--fsk-focus` | `--fbc-focus` | CSS 変数 |
| `.fsk-footer` | `.fbc-footer` | class |
| `.fsk-footer-line` | `.fbc-footer-line` | class |
| `.fsk-footer-name` | `.fbc-footer-name` | class（css に定義なし。Razor・JS・Worker が付ける） |
| `.fsk-footer-sep` | `.fbc-footer-sep` | class |
| `.fsk-footer-social` | `.fbc-footer-social` | class |
| `.fsk-footer-socials` | `.fbc-footer-socials` | class |
| `.fsk-form-group` | `.fbc-form-group` | class |
| `.fsk-form-label` | `.fbc-form-label` | class |
| `--fsk-grad` | `--fbc-grad` | CSS 変数 |
| `.fsk-header` | `.fbc-header` | class |
| `--fsk-header-accent` | `--fbc-header-accent` | CSS 変数 |
| `--fsk-header-bg` | `--fbc-header-bg` | CSS 変数 |
| `--fsk-header-track` | `--fbc-header-track` | CSS 変数 |
| `#fsk-main` | `#fbc-main` | id（`#fsk-main`） |
| `.fsk-maintenance` | `.fbc-maintenance` | class |
| `--fsk-maintenance-bg` | `--fbc-maintenance-bg` | CSS 変数 |
| `.fsk-maintenance-link` | `.fbc-maintenance-link` | class |
| `--fsk-maintenance-muted` | `--fbc-maintenance-muted` | CSS 変数 |
| `.fsk-maintenance-schedule` | `.fbc-maintenance-schedule` | class |
| `--fsk-maintenance-text` | `--fbc-maintenance-text` | CSS 変数 |
| `.fsk-mb-0` | `.fbc-mb-0` | class |
| `.fsk-mb-1` | `.fbc-mb-1` | class |
| `.fsk-mb-3` | `.fbc-mb-3` | class |
| `.fsk-menu-toggle` | `.fbc-menu-toggle` | class |
| `.fsk-mt-3` | `.fbc-mt-3` | class |
| `--fsk-muted` | `--fbc-muted` | CSS 変数 |
| `.fsk-nav` | `.fbc-nav` | class |
| `.fsk-nav-section` | `.fbc-nav-section` | class |
| `.fsk-no-drawer` | `.fbc-no-drawer` | class |
| `.fsk-not-found` | `.fbc-not-found` | class |
| `.fsk-not-found-code` | `.fbc-not-found-code` | class |
| `.fsk-not-found-lead` | `.fbc-not-found-lead` | class |
| `.fsk-notice` | `.fbc-notice` | class |
| `--fsk-notice-bg` | `--fbc-notice-bg` | CSS 変数 |
| `--fsk-notice-text` | `--fbc-notice-text` | CSS 変数 |
| `.fsk-notice-title` | `.fbc-notice-title` | class |
| `.fsk-nowrap` | `.fbc-nowrap` | class |
| `.fsk-page` | `.fbc-page` | class |
| `.fsk-page-card` | `.fbc-page-card` | class |
| `.fsk-page-column` | `.fbc-page-column` | class |
| `.fsk-page-column--wide` | `.fbc-page-column--wide` | class |
| `.fsk-page-header` | `.fbc-page-header` | class |
| `.fsk-page-pane` | `.fbc-page-pane` | class |
| `.fsk-page-scroll` | `.fbc-page-scroll` | class |
| `.fsk-page-title` | `.fbc-page-title` | class |
| `.fsk-pane-scroll` | `.fbc-pane-scroll` | class |
| `.fsk-report-card` | `.fbc-report-card` | class |
| `.fsk-report-submit` | `.fbc-report-submit` | class |
| `.fsk-report-trap` | `.fbc-report-trap` | class |
| `#fsk-report-turnstile` | `#fbc-report-turnstile` | id（`#fsk-report-turnstile`） |
| `.fsk-report-unavailable` | `.fbc-report-unavailable` | class |
| `.fsk-scroll-progress` | `.fbc-scroll-progress` | class |
| `.fsk-search-open` | `.fbc-search-open` | class |
| `.fsk-search-sheet` | `.fbc-search-sheet` | class |
| `.fsk-search-toggle` | `.fbc-search-toggle` | class |
| `.fsk-select` | `.fbc-select` | class |
| `fsk-service-*` | `fbc-service-*` | class の接頭辞（`fsk-service-*` を連結して作る） |
| `.fsk-sidebar` | `.fbc-sidebar` | class |
| `--fsk-sidebar-bg` | `--fbc-sidebar-bg` | CSS 変数 |
| `.fsk-sidebar-hidden` | `.fbc-sidebar-hidden` | class |
| `--fsk-sidebar-text` | `--fbc-sidebar-text` | CSS 変数 |
| `.fsk-skip-link` | `.fbc-skip-link` | class |
| `.fsk-small` | `.fbc-small` | class |
| `.fsk-theme-button` | `.fbc-theme-button` | class |
| `.fsk-theme-switch` | `.fbc-theme-switch` | class |
| `.fsk-topnav-bar` | `.fbc-topnav-bar` | class |
| `.fsk-topnav-drawer` | `.fbc-topnav-drawer` | class |
| `.fsk-topnav-link` | `.fbc-topnav-link` | class |
| `--fsk-warning-text` | `--fbc-warning-text` | CSS 変数 |
| `#fsk-sidebar`・`#fsk-search-sheet` | `#fbc-sidebar`・`#fbc-search-sheet` | id（SiteLayout が付ける。css は `#fbc-…`） |

- 名前の置き換えは接頭辞だけ（`fsk-` → `fbc-`）。`--fsk-*` の変数も同じ。
- `#fsk-…` の id を CSS で使っているサイト（pokemon の `#fsk-search-sheet`、album の `#fsk-main` など）は、id も置き換える。

### 1.5 JS（window の名前と、Razor から呼ぶ名前）

| 旧 | 新 |
| --- | --- |
| `window.faraSiteKit`（kit の JS の名前空間） | `window.faraBlazorComponent` |
| `faraSiteKit.watchMobile` | `faraBlazorComponent.watchMobile` |
| `faraSiteKit.unwatchMobile` | `faraBlazorComponent.unwatchMobile` |
| `faraSiteKit.focusMenu` | `faraBlazorComponent.focusMenu` |
| `faraSiteKit.focusMain` | `faraBlazorComponent.focusMain` |
| `faraSiteKit.searchSheet` | `faraBlazorComponent.searchSheet` |
| `faraSiteKit.sidebarChanged` | `faraBlazorComponent.sidebarChanged` |
| `faraSiteKit.checkConfig` | `faraBlazorComponent.checkConfig` |
| `faraSiteKit.report.mount` | `faraBlazorComponent.report.mount` |
| `faraSiteKit.report.waitToken` | `faraBlazorComponent.report.waitToken` |
| `faraSiteKit.report.reset` | `faraBlazorComponent.report.reset` |
| `faraSiteKit.report.dispose` | `faraBlazorComponent.report.dispose` |

- サイトが定義する `faraSite.*`（サイト自身の JS の名前空間）は kit のものではないので、変えない。
- サイトの Razor が kit の関数を直接呼んでいる（pokemon の `NavMenu.razor`・bot の `NavMenu.razor`、album のテスト）。`faraSiteKit.` を含む文字列は、すべて置き換える。

### 1.6 保存のキー（kit の既定値）

| 旧 | 新 |
| --- | --- |
| `fara-site-kit.settings`（`SiteOptions.StorageKey` の既定） | `fara-blazor-component.settings` |
| `fara-site-kit.sidebar-hidden`（`SiteOptions.SidebarKey` の既定） | `fara-blazor-component.sidebar-hidden` |

- サイトが `StorageKey`・`SidebarKey` と、index.html の `data-storage-key`・`data-sidebar-key` に**自分のキーを書いている**なら、キーは変えなくてよい（保存された設定はそのまま残る）。
- kit の既定を使っていたサイトだけ、キーが変わるので、保存されたテーマ・サイドバーの設定が 1 回リセットされる。確認した 5 サイトでは、portfolio だけが保存を使わない（プライバシーポリシーのとおり。`StorageKey` の設定が無い）。ほかの 4 サイトは自分のキーを設定している。

### 1.7 報告の回数制限（Worker）

| 旧 | 新 |
| --- | --- |
| `fara-site-kit/report-limit/v1`（`worker/report-rate-limit.js` の `KEY_LABEL`。HMAC の用途ラベル） | `fara-blazor-component/report-limit/v1` |

- 用途ラベルが変わると、既存の回数の記録と一致しなくなり、1 日の送信回数のカウントが 1 回リセットされる（機能は壊れない）。
- サイトの Worker の設定（`REPORT_LIMITER` のバインディング・`TURNSTILE_SECRET`）は変えない。

### 1.8 Worker が出す HTML の class

`worker/maintenance.js` の `noticeHtml` が出すお知らせの class は、1.4 の表のとおり `.fsk-notice`・`.fsk-notice-title`・`.fsk-notice-text` → `.fbc-…`。サイトの CSS（`.fsk-notice*`）と、Worker のテスト（`fsk-notice` を検査するもの）を、同じ PR で直す。サイトの CSS が古いままだと、お知らせの見た目が付かない。

### 1.9 npm（kit の package.json）

- `name`: `fara-site-kit` → `fara-blazor-component`（private。公開はしない）。npm scripts の名前は変わらない。
- サイトの `package.json` の scripts が `external/fara-site-kit/worker/*.test.mjs` などを指す場合は、パスを置き換える（2.2 の置換で直る）。

## 2. 各サイトでの作業手順

### 2.1 submodule を付け替える

サイトのリポジトリのルートで（作業ブランチは develop から切る）。

```bash
git submodule deinit -f external/fara-site-kit
git rm -f external/fara-site-kit
rm -rf .git/modules/external/fara-site-kit
git submodule add https://github.com/fara1991/fara-blazor-component.git external/fara-blazor-component
cd external/fara-blazor-component && git checkout v1.0.0 && cd ../..   # タグ v1.0.0 が切られてから固定する
git add .gitmodules external/fara-blazor-component
```

- `.gitmodules` の `[submodule "external/fara-site-kit"]` の項目も、この手順で消える（名前ごと付け替える）。
- bot は `external/` が repo ルートにある（`site/` から `../external/` を参照する）。ほかのサイトも、`.gitmodules` の場所を確かめてから同じ手順を使う。

### 2.2 名前を置き換える

```bash
# 1) 対象を確認（external/ の中は触らない。git grep は追跡ファイルだけを見る）
git grep -n -E 'fara-site-kit|FaraSiteKit|faraSiteKit|fsk-' -- ':!external'

# 2) 置換（GNU sed。macOS の BSD sed は -i '' と書く）
git grep -l -E 'fara-site-kit|FaraSiteKit|faraSiteKit|(^|[^A-Za-z0-9_])fsk-' -- ':!external' | xargs sed -i -E \
  -e 's/fara-site-kit/fara-blazor-component/g' \
  -e 's/FaraSiteKit/FaraBlazorComponent/g' \
  -e 's/faraSiteKit/faraBlazorComponent/g' \
  -e 's/(^|[^A-Za-z0-9_])fsk-/\1fbc-/g'

# 3) 残りを確認（0 件。サイトの歴史的な文書（changelog など）に残るものは、その文書の中の旧名として見逃してよい）
git grep -n -i -E 'fara-site-kit|FaraSiteKit|faraSiteKit|fsk-' -- ':!external'
```

- 置換の前に、1) の一覧を目で見る。サイト固有の文字列（独自の名前・ドメイン）に、旧名の一部が含まれていないかを確かめる。
- 置換の後、`git diff` で、置換の範囲が想定どおりか（CSS・C#・JS・index.html・Worker・CI）を確かめる。

### 2.3 CSS の上書き（置換漏れの確認）

サイトの CSS が kit のクラスを上書きしている数（develop の浅い clone で数えた値。種類は重複を除いた数）:

| サイト | 上書きしている kit の名前（種類） | 2.2 の置換の後に残る `fsk-` |
| --- | --- | --- |
| pokemon（`app.css`） | 41 | 0 件（確認すること） |
| bot（`site/` の `site.css`） | 13 | 0 件 |
| album（`app.css`） | 14 | 0 件 |
| avatar（`app.css`・`practice.css`） | 11 | 0 件 |
| portfolio（fara-labs・`app.css`） | 11 | 0 件 |

上書きしている名前は、すべて 1.4 の表に載る。置換の漏れは、見た目が**無言で崩れる**（クラスが付かないだけで、エラーは出ない）ため、2.2 の 3) で 0 件を確かめ、3 の見た目の確認を必ず行う。

### 2.4 JS・Razor・index.html

- Razor の `JS.InvokeVoidAsync("faraSiteKit.…")` などは、2.2 の置換で `faraBlazorComponent.…` になる。テストの `JSInterop.Setup` の文字列も同じ。
- index.html の `_content/FaraSiteKit.Razor/…` は置換で直る。`data-storage-key`・`data-sidebar-key` は、`StorageKey`・`SidebarKey` と同じ値にする（違うと起動時に警告が出る）。

### 2.5 Worker・CI・ツール

- Worker の `import … from "../external/fara-site-kit/worker/…"` は、置換で `../external/fara-blazor-component/worker/…` になる。
- CI（`.github/workflows/`）の `checkout` は `submodules: true` のまま。kit の `tools/layout-check/cli.mjs` などを呼ぶ行は、置換で直る。
- `layout-check.config.mjs` の `.fsk-menu-toggle` などのセレクタは、置換で `.fbc-menu-toggle` になる。

### 2.6 掃除

- `rm -rf bin obj`（または `dotnet clean`）。旧 `_content/FaraSiteKit.Razor` の静的アセットが残ることがあるため。`npm run clean` も、publish の出力を消す。

## 3. 確認

- `dotnet test`（サイトの Razor・Web のテスト）と、`npm test`（Worker・Build の Node テスト）。
- `npm run check`（サイトの標準。`dotnet publish` と wrangler の dry-run）。
- `npm run preview` で `/` と代表的なページを見る。見る箇所: ヘッダー・サイドバー（PC・スマホ）・検索欄・フッター・お知らせの帯・404・問い合わせのフォーム。kit のクラスの置換漏れは、見た目が崩れるだけなので、目で確かめる。
- layout-check（サイトの CI）が通ること。
- 1.6 の保存キーを変える場合は、テーマとサイドバーの保存値が引き継がれるかを確かめる（キーを変えないなら確かめる必要はない）。

## 4. 作業量の見積もり

2026-10-29 時点の develop を浅く clone し、`git grep` で数えた値（行数は、ファイルごとの行の合計）。

| サイト | submodule の参照（行） | `FaraSiteKit` を含む行（using・名前空間・csproj を含む） | `_content/FaraSiteKit` の行 | `faraSiteKit.` の呼び出し（行） | 上書きしている kit の名前（種） | 作業量 |
| --- | --- | --- | --- | --- | --- | --- |
| pokemon | 39 | 43 | 12 | 6 | 41 | 大（CSS と JS の呼び出しが多く、保存キーも設定済み） |
| avatar | 39 | 30 | 8 | 0 | 11 | 中（CSS と Worker の class。保存キーは設定済み） |
| bot（site/） | 34 | 25 | 8 | 2 | 13 | 中（submodule が repo 直下。保存キーは設定済み） |
| portfolio（fara-labs） | 23 | 19 | 4 | 0 | 11 | 小（保存を使わない。Worker の class も含む） |
| album | 27 | 29 | 7 | 1 | 14 | 中（保存キーは設定済み） |

## 5. 判断が要った点（kit 側）

- リポジトリ名・名前空間・CSS・JS の名前に加えて、**保存キーの既定値と報告の用途ラベル（HMAC）も新名にした**。前者は 1.6、後者は 1.7 の影響がある。
- 旧名の別名は作らない（後方互換の層を置かない）。移行の PR で、旧名を一度に置き換える。
- Worker の `noticeHtml` の class を変えたため、サイトの CSS と Worker のテストは、submodule を上げる PR と同じ PR で直す。
