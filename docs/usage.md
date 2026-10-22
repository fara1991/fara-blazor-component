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

## 6. Razor の部品（`src/FaraSiteKit.Razor`）

MudBlazor 9.11.0 と、`FaraSiteKit.Core` を使う Razor クラスライブラリ（net10.0）。参照は `ProjectReference`（3 と同じ）。

```xml
<ProjectReference Include="..\..\external\fara-site-kit\src\FaraSiteKit.Razor\FaraSiteKit.Razor.csproj" />
```

### 最小の構成

**Program.cs**（`AddFaraSiteKit` が、SiteOptions・テーマの状態・MudBlazor を登録する）

```csharp
builder.Services.AddFaraSiteKit(options =>
{
    options.Name = "サイト名";
    options.Author = "作者";
    options.PublishedYear = 2026;
    options.AuthorHomeUrl = "https://example.com/";   // 確認用では SiteLinks.Localize で切り替える
    options.DevelopHost = "example-dev.example.com";  // 確認用ホスト（空なら切り替えない）
    options.Social.Add(new SiteSocialLink("github", "https://github.com/...")); // URL が空のものは出ない
});
var maintenance = await MaintenanceInfo.LoadAsync(new HttpClient { BaseAddress = new Uri(baseAddress) });
builder.Services.AddSingleton(maintenance);
```

- 保存のキーは `SiteOptions.StorageKey`（既定 `fara-site-kit.settings`）と `SidebarKey`（既定 `fara-site-kit.sidebar-hidden`）。下の index.html の `data-storage-key`・`data-sidebar-key` と同じ値にする（テストで確かめる）。

**_Imports.razor**

```razor
@using FaraSiteKit.Core
@using FaraSiteKit.Razor
@using FaraSiteKit.Razor.Components
@using MudBlazor
```

**Shared/MainLayout.razor**（`SiteLayout` の中に、サイトの中身を置く）

```razor
@inherits LayoutComponentBase
@inject MaintenanceInfo Maintenance

<SiteLayout Body="@Body" Maintenance="Maintenance">
    <DrawerContent>
        <SiteNavMenu Groups="NavGroups" />
    </DrawerContent>
    <SearchBox>...サイトの検索欄...</SearchBox>       @* PC のヘッダーの中央 *@
    <HeaderEnd><ThemeSwitch /></HeaderEnd>              @* PC のヘッダーの右 *@
    <MobileHeaderActions>...</MobileHeaderActions>      @* スマホのヘッダー（省略可） *@
    <SearchSheet Context="close">...検索欄...</SearchSheet> @* スマホ。ヘッダーの検索ボタンで開く（省略で検索ボタンを出さない） *@
</SiteLayout>

@code {
    private static readonly IReadOnlyList<SiteNavGroup> NavGroups = new[]
    {
        new SiteNavGroup(null, new[] { new SiteNavItem("", "ホーム", Icons.Material.Filled.Home) }),
        new SiteNavGroup("計算", new[]
        {
            new SiteNavItem("calculator", "ダメージ計算機", Icons.Material.Filled.Calculate),
            new SiteNavItem("speed", "素早さ比較", Icons.Material.Filled.Speed, Disabled: true, Title: "未対応です"),
        }),
    };
}
```

- `SiteNavItem(Href, Label, Icon, Disabled, Title)`: Href は相対パス（`""` がホーム）。`Disabled` の項目は選べない。現在のページは自動で active。
- スマホでメニューを閉じるのは、画面の移動（LocationChanged）で行う。項目は `<a href>` のまま。
- ヘッダーの名前は `SiteOptions.Name`（`HomeHref` へのリンク）。別の表示にしたいときは `Brand` に渡す。
- `MudProviders` は SiteLayout の中で置かれる（テーマは `CustomTheme` で替えられる。省略は紫系の既定）。

**App.razor**: `Router` の `DefaultLayout` を上の MainLayout にし、`<NotFound>` で `NotFoundView` を出す。

```razor
<NotFound>
    <LayoutView Layout="@typeof(MainLayout)">
        <NotFoundView HomeHref="./" />
    </LayoutView>
</NotFound>
```

**Program.cs** の最後で `HeadOutlet` を置く（報告・404 の noindex と、ページの題名に必要）。

```csharp
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");
```

### 部品の一覧

| 部品 | 役目 | 主なパラメータ |
| --- | --- | --- |
| `SiteLayout` | ヘッダー・サイドバー（PC は Mini、スマホは一時的なメニュー）・本文・フッター・お知らせ帯 | `Brand` `SearchBox` `HeaderEnd` `MobileHeaderActions` `SearchSheet` `DrawerContent` `Maintenance` `CustomTheme` `PageClass` |
| `MudProviders` | MudBlazor の土台（テーマ・ポップアップ・ダイアログ・通知） | `CustomTheme` |
| `ThemeSwitch` | ライト／ダーク（スイッチ。`AsButton` で文字のボタン） | `AsButton` `LightLabel` `DarkLabel` |
| `SiteNavMenu` | サイドバーの項目（見出しと項目は `SiteNavGroup`・`SiteNavItem`） | `Groups` `Top` |
| `SiteFooter` | フッター（サイト名・問い合わせ・プライバシー・©・SNS） | （`SiteOptions` から） |
| `ReportFormView` | 「作者へ報告」（問い合わせ）のフォーム。Turnstile・送信の状態・noindex | `Title` `Lead` `From` `NoIndex` `UnavailableNote` `MessagePlaceholder` `ContactHint` `Timeout` |
| `NotFoundView` | 404（ページが見つからない） | `Code` `Title` `Lead` `HomeHref` `HomeText` `NoIndex` |
| `MaintenanceBanner` | 「更新予定」のお知らせ（Notice のときだけ） | `Info` |
| `MaintenanceScreen` | メンテナンス中の画面（Program.cs で切り替える） | `Info` `Heading` `Lead` `Contact` |
| `ScrollProgress` | ヘッダー下端の、読んだ量の線 | — |

- 報告フォームの例（`Pages/Report.razor`）:

```razor
@page "/report"
<ReportFormView From="@From" UnavailableNote="お急ぎの場合は、SNS からお願いします。" />
@code {
    [SupplyParameterFromQuery(Name = "from")] public string? From { get; set; }
}
```

- 報告の送信先は `SiteOptions.ReportApiPath`（既定 `api/report`）・確認の設定は `ReportConfigPath`（既定 `api/report/config`）。Worker（`worker/report.js`）と同じ形。
- 本文の日本語の改行は、kit の CSS が `.page-column` の中に入れる。日付などの塊は `<span class="nowrap">…</span>` で囲む。

### 静的ファイル（`_content/FaraSiteKit.Razor/...`）

- `css/fara-site-kit.css`: 共通の見た目。色は `:root` の `--fsk-*`（ダークは `:root[data-bs-theme="dark"]`）。サイトは同じ変数で上書きできる。
- `js/theme-init.js`: head で同期に読む（テーマと PC のサイドバーの反映）。
- `js/boot-indicator.js`・`js/fara-site-kit.js`・`js/scroll-progress.js`・`js/report.js`: 下の index.html の断片のとおり読む。

### index.html

`docs/index-template.html` の断片を、サイトの `wwwroot/index.html` に合わせる。`<html>` は `data-bs-theme="light"`、`<meta name="viewport">` には `viewport-fit=cover`（フッターの安全領域のため）を付ける。

- `theme-init.js` の `data-storage-key` と `data-sidebar-key` は、`SiteOptions.StorageKey`・`SidebarKey` と同じ値にする。
- 読み込み表示（`#boot-indicator`）と `inert` の対象（`.entry-static`）は、断片のとおり。CSP は `script-src` に `'self'`、`style-src` に `'unsafe-inline'`（MudBlazor のため）で足りる（インラインの script は使わない）。

### 確認

- `dotnet test tests/FaraSiteKit.Razor.Tests`（bUnit）
- `samples/MinimalSite` は、同じ構成の最小の例。`dotnet build samples/MinimalSite` が CI で通ること。公開はしない。
