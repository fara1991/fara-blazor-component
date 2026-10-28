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

例外をログに出すときは、kit の `error-summary.js` の `errorSummary` を使う（サイトごとのコピーは持たない。報告と同じ規則）。名前とメッセージを出し、URL（Webhook の URL を含む）・Bearer・`token=`／`token:`・24 字以上の英数字の連続を伏せ、200 字で切る。Error 以外の値も文字列にして同じ規則に通す。

```js
import { errorSummary } from "../external/fara-site-kit/worker/error-summary.js";

console.error(`報告の受け口で例外: ${errorSummary(error)}`);
```

- wrangler は、サブモジュールの中のファイルもバンドルする（`wrangler deploy --dry-run` で確認する）。
- サイトの `package.json` のテストは、kit のテストファイルを指す（例: `node --test external/fara-site-kit/worker/report.test.mjs`）。

### 2.1 メンテナンスの変数（0.3.0 で名前を変更）

Worker の変数（ダッシュボードの「変数とシークレット」、または `wrangler deploy --var`）で切り替える。

| 変数 | 値 |
| --- | --- |
| `MAINTENANCE_MODE` | `false`（または未設定）= 通常 / `notice` = 通常のページの上に「更新予定」のお知らせ / `true` = メンテナンス画面（503） |
| `MAINTENANCE_MESSAGE` | お知らせ・メンテナンス画面に出す文（200 文字まで） |

- **旧名 `MAINTENANCE` は 0.3.0 から読まない**（残っていても何も起きない＝通常動作）。0.2.x 以前から上げるサイトは、`docs/changelog.md` の 0.3.0 の移行手順に従う。
- 本番の公開前にお知らせを出す運用（`require-maintenance.mjs` 相当）や、公開と同時に `--var MAINTENANCE_MODE:true` を付けるワークフローも、新しい名前に合わせる。
- 複数サイトの変数をまとめて見る・切り替えるには `tools/maintenance.mjs`（`status` は読み取り、`set` は deploy ワークフローを `gh` で実行。雛形と手順は `docs/maintenance-cli.md`）。

### 2.2 報告の回数制限（1 日 3 回まで・送信元ごと）

報告の受け口（`handleReport`）は、Turnstile を通った送信の試みを、送信元（Cloudflare の `CF-Connecting-IP`）ごとに **1 日 3 回まで** 数える。超えたら 429（`{"error":"rate_limited","message":"1 日の送信上限（3 回）に達しました。明日もう一度お試しください。"}`・`Retry-After` は次の JST 0 時までの秒）。数えるのは、Discord へ送る直前の 1 回。Turnstile の失敗・本文の不正・罠の欄で弾いたものは数えない。**Discord への送信が失敗したときは、数えた 1 回を戻す**（届いていない分で枠を使い切らない）。

**有効化の手順（opt-in）**: 次の 2 つを、サイトの Worker に入れる。バインディングが無いサイトは、今までどおり（制限なし）。

1. `worker/index.js` で、クラスを公開する（kit の `report-rate-limit.js` にある Durable Object）。
```js
export { ReportRateLimiter } from "../external/fara-site-kit/worker/report-rate-limit.js";
```
2. `wrangler.jsonc` に、バインディングと migrations を書く。`durable_objects` と `migrations` は環境（`env.develop`）を継承しないので、**本番と develop の両方に**書く。SQLite の DO（`new_sqlite_classes`）を使う（新しい DO はこの形で作る。プランごとの対応は Cloudflare の DO の docs で確かめる）。
```jsonc
{
  "durable_objects": { "bindings": [{ "name": "REPORT_LIMITER", "class_name": "ReportRateLimiter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ReportRateLimiter"] }],
  "env": {
    "develop": {
      "durable_objects": { "bindings": [{ "name": "REPORT_LIMITER", "class_name": "ReportRateLimiter" }] },
      "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ReportRateLimiter"] }]
    }
  }
}
```
  - 既に `migrations` があるサイトは、tag を重複させず、新しい tag（例: `v2`）で `new_sqlite_classes` を足す。
  - 確認: `wrangler deploy --dry-run`（本番と develop）。`npm run preview` で、同じ IP から 4 回送って 4 回目が 429 になるかを見る。
  - 公式 docs の確認: `storage.transaction()`・`alarm`・`list`・`delete`（128 件まで）は、Storage API の docs で確認した。input gate（storage 操作の間に他のイベントが入らない仕組み）の記載は、確認したページに見つからなかったため、要照合。並行性は transaction に頼っている。

**数え方と保存（プライバシー）**:
- 保存するのは、**送信元の識別子と回数だけ**。識別子は、Turnstile の秘密鍵（`TURNSTILE_SECRET`）から用途ラベル（`fara-site-kit/report-limit/v1`）付きの HMAC で導いた鍵で、`HMAC(鍵, IP + "
" + JST の日付)` の先頭 128 ビット（32 桁の hex）。鍵が無いと同じ値は作れない（公開のソルトだけなら、IPv4 の全探索で逆算できてしまうため）。IP そのものは保存しない・ログに出さない。
- 日付（JST の暦日）ごとにキーを分ける。同じ IP でも日付が変われば別の識別子になる。
- **保存期間**: その日（JST）の分。JST の次の 0 時に、Durable Object の alarm で前の日のキーを消す。alarm が取りこぼされても、次の日の最初のリクエストで掃除する（日付が変わってから、次の掃除まで残る）。
- **秘密鍵を変えると、識別子がすべて変わり、計数はリセットされる**（回数の枠が一度だけ戻る）。鍵の更新は、この点を承知のうえで行う。
- **各サイトのプライバシーポリシーに追記が必要**: 「報告の送信の回数を制限するため、送信元の IP アドレスから作った、秘密の鍵つきの識別子（ハッシュ）を、その日の間だけ保存し、日付が変わると消す」旨。「匿名」とは書かない（識別子は送信元に結びつくため）。IP アドレスそのものは保存しないこと。
- 報告の本文は従来どおり保存しない（Discord に送るだけ）。

**運用上の注意（制約）**:
- 1 サイトの中では、全部の送信が **1 つの Durable Object を通る**（固定名）。送信が多いと、ここが混み合う。個人のサイトの問い合わせの量では問題にならない想定。
- alarm の掃除は `storage.list()` で、そのサイトが保存しているキーを一度に読む（1 日分の、送信元の数）。送信元が非常に多い日は、掃除が重くなる。
- DO の課金・上限に達したり、DO が使えなくなると **fail-open（制限せず送る）**。Turnstile は残るので、ボット対策は効いている。
- 同じ回線（CGNAT・共有 IP）の人は、枠を共有する。
- IPv6 は /64 などの単位で丸めていない（1 人が別のアドレスを使うと、回避できる）。Turnstile は残る。
- Discord 側の障害では、送信が失敗した分の枠は戻す（上の「戻す」）。戻しも失敗したときは、報告の応答は 502 のまま、ログに残す。

**DO が使えないとき・数えられないとき（fail-open）**: 回数を数えられないとき（DO の例外・非 2xx・IP ヘッダーが無い・秘密鍵が無い）は、**制限せず送る**。理由: 問い合わせを取りこぼさないため。ログには `report: daily limit unavailable, sending anyway`・`report: daily limit skipped, no CF-Connecting-IP`・`report: daily limit unavailable (no key), sending anyway` を出す（IP・識別子・鍵は出さない）。

**報告画面（ReportFormView）**: 429 のときは、Worker の `message`（「1 日の送信上限（3 回）に達しました。明日もう一度お試しください。」）をそのまま出す。本文が読めないときも同じ文を出す（汎用の失敗の文にはしない）。

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

## 6. 静的ファイルを作る（`build/`）

`dotnet publish` などが出したテンプレート（`index.html`）に、ページごとの head（title・description・canonical・OGP・Twitter カード・robots）と本文を差し込み、`robots.txt`・`sitemap.xml`・`404.html`・`_headers`・`_redirects` を書き出す。本文の HTML は呼び出し側（サイトの C# など）が作る。このツールは本文を作らない。

```bash
node external/fara-site-kit/build/build-pages.mjs \
  --site site.json --pages pages.json --template artifacts/template/index.html \
  --out publish/wwwroot --env production
```

テンプレート（`dotnet publish` の出力の `index.html`）は、出力先（`publish/wwwroot`）とは別のフォルダに置く。テンプレートを出力先で上書きする設定は、書き出す前にエラーにする（2 回目の実行が壊れるため）。同じ入力を 2 回実行すると同じ結果になる（テンプレートは変わらない）。

- `--env production|develop`（確認用は `develop`）。`--site` `--pages` `--template` `--out` は必須。
- モジュールとしても使える: `import { buildPages, writeFiles } from "../external/fara-site-kit/build/build-pages.mjs";`。`buildPages({ site, pages, redirects, template, env })` は、ファイル名 → 内容 の Map を返す（書き込みはしない）。

### テンプレート

- 区切りは `<!-- SEO-HEAD:START -->`・`<!-- SEO-HEAD:END -->`（`<head>` の中）と `<!-- SEO-BODY:START -->`・`<!-- SEO-BODY:END -->`。各 1 つだけ。SEO-BODY は `<div id="app">` の直下（最初の `</div>` より前）に置く。区切りの外（読み込み表示など）は変えない。
- `#app` の開始タグは、class などの属性があっても受ける（`<div class="…" id="app">`）。
- 本文の先頭の要素（`bodyHtml` の最初のタグ）には、`site.json` の `bodyRootClass` の class を付ける（pokemon は `entry-static`。例: `<main class="entry-static">`）。読み込み表示の JavaScript は、この class に依存する。JavaScript 本体とそのテストは、kit の Razor ライブラリ側（別の PR）で移す。
- SEO-BODY の中は空にしておく。本文が入った HTML（生成済みの `index.html` など）を `--template` に渡すとエラーになる（404 や SPA のフォールバックに本文が残るのを防ぐ）。`dotnet publish` の出力を使う。
- 本文（`bodyHtml`）は `SEO-BODY` の中に入る。Blazor が起動すると `#app` の中身ごと置き換わる。`bodyHtml` に区切りの文字列を入れるとエラーになる。

### サイト設定（`site.json`）

| 項目 | 必須 | 中身 |
| --- | --- | --- |
| `name` | ○ | サイト名（`og:site_name`・既定の 404 の title・`spaFallback` の title） |
| `origin` | ○ | 本番のホスト（`https://example.com`。末尾の / なし） |
| `devOrigin` | ○ | 確認用のホスト（canonical・sitemap に使う。develop のとき） |
| `lang` | ○ | `<html lang>` の既定（`ja` など）。ページの `lang` で上書きできる |
| `locale` | ○ | `og:locale`（`ja_JP` など） |
| `bodyRootClass` | | 本文の先頭の要素に付ける class（例: `entry-static`）。指定すると、`bodyHtml` の先頭の要素にこの class が無いとエラー |
| `homeFile` | | `/` のファイル名。既定 `index.html`（avatar の形）。pokemon は `home.html` |
| `urlStyle` | | `html`（既定。`<path>.html`。Cloudflare が拡張子を外す）か `directory`（`<path>/index.html`） |
| `spaFallback` | | `{}` で、汎用の title だけの `index.html` を作る（存在しない URL の SPA フォールバック用）。`homeFile` を `index.html` 以外にする |
| `notFoundPage` | | 既定は `404.html`（noindex・読み込み表示だけの汎用）。`false` で作らない。`{ title, bodyHtml }` で中身を変えられる |
| `robotsDisallow` | | production の robots.txt の Disallow（例: `["/my-", "/api/my/"]`） |
| `developRobots` | | develop の robots.txt。既定 `disallow`（全部 Disallow）。`allow` で `Allow: /` |
| `maxDescription` | | description の最大文字数（既定 160） |
| `csp` | | あれば `_headers` を作る（下の「CSP」）。develop は `X-Robots-Tag: noindex` を付ける |

- 知らない項目（`spaFallback`・`notFoundPage`・ページ・redirects・pages.json の最上位も含む）は、綴りの間違いとしてエラーにする。
- `lang`・`locale`・`ogImage` などは、BCP 47 や URL の形を検査する（`lang` は `ja`・`en-US` の形、`locale` は `ja_JP` の形）。
- `developRobots` を既定の `disallow` にすると、クローラーは確認用の `X-Robots-Tag: noindex` を見られない。すでに検索に出ている確認用の URL が消えないことがある。確認用の URL が検索に出ても問題ないサイトは `allow` にする（pokemon は `allow`）。

### ページ一覧（`pages.json`）

配列、または `{ "pages": [...], "redirects": [...] }`。

| 項目 | 必須 | 中身 |
| --- | --- | --- |
| `path` | ○ | `/`（ホーム）か、小文字・数字・ハイフンのパス（`/battle-terms`、`/learn/intro`）。末尾の / は付けない |
| `title` | ○ | `<title>` と `og:title`（エスケープする） |
| `description` | ○ | `meta description` と `og:description`（`maxDescription` を超えるとエラー） |
| `bodyHtml` | ○ | 本文の HTML（そのまま入れる。呼び出し側が安全な HTML にする） |
| `canonical` | | 省略時は `origin` + `path`。`https://` の URL か `/` のパス（同じホストだけ） |
| `noindex` | | `true` で `<meta name="robots" content="noindex">` を付け、sitemap に入れない |
| `ogImage` | | `https://…` か `/` のパス。付けると `og:image` と `summary_large_image` |
| `ogType` | | 既定 `website` |
| `lang` | | このページの `<html lang>` |
| `lastmod` | | `YYYY-MM-DD`（実在する日付）。sitemap の `<lastmod>` |
| `changefreq` / `priority` | | sitemap の `<changefreq>`（`daily` など）・`<priority>`（0 から 1） |
| `jsonLd` | | JSON-LD のオブジェクト。`<script type="application/ld+json">` を、`<` などを \u の形にして出す |

- `noindex` のページに別の `canonical` は指定できない。noindex のページを別のページの canonical にすることもできない（シグナルが矛盾するため）。
- `redirects`: `[{ "from": "/glossary", "to": "/battle-terms", "status": 301 }]`。`from` は既存のページと同じにできない。`to` は `/` で始まるパス、または `https://` の URL（空白・改行・制御文字は使えない。URL は正規化して書く）。`status` は 301・302・307・308（既定 301）。`_redirects` に 1 行ずつ書く（静的の規則は 2,000 件まで、1 行は 1,000 文字まで。超えるとエラー）。

### 出力

| ファイル | 作るとき |
| --- | --- |
| `<path>.html`（`urlStyle` による）・`homeFile` | ページごと |
| `index.html` | `spaFallback` を指定したとき |
| `404.html` | `notFoundPage` が `false` でないとき |
| `robots.txt` | 常に |
| `sitemap.xml` | production のとき（noindex のページは入れない） |
| `_headers` | `csp` を指定したとき |
| `_redirects` | `redirects` が 1 つ以上あるとき |

- 同じ入力は、同じバイト列を出す（決定論的）。
- 出力先の古いファイルは消さない。例えば `urlStyle` を変えると、古い `.html` が残る。出力先を空にしてから実行する運用にする。
- 入力の問題（path の重複・形・出力ファイル名の重複・区切りの不備など）は、まとめて 1 回のエラーで報告する。エラーのときは何も書き出さない。

### 使い方の例

- **pokemon**（`tools/build-entry-pages.mjs` から移行する予定）: `homeFile: "home.html"`、`spaFallback: {}`、`notFoundPage: false`、`developRobots: "allow"`、`maxDescription: 150`。kit のテスト（`tests/build/pokemon-equivalence.test.mjs`）が、pokemon の現行の出力とバイト単位で同じになることを確かめる。
- **avatar**（C# の Build がページ一覧を作る）: `homeFile` は既定（`index.html`）、`notFoundPage` は既定、`spaFallback` は使わない（`not_found_handling = "404-page"`）。`pages.json` は Markdig で作った本文を `bodyHtml` に入れて C# が書き出し、`dotnet publish` の出力の `index.html` を `--template` に渡す。
- **bot・portfolio**: 同じ。`path` と `bodyHtml` が決まれば、`node` で `buildPages` を呼ぶか、CLI を実行する。

## 7. CSP（`csp/`）

`csp/render-headers.mjs` の `renderHeaders(options)` が `_headers` の本文を作る。テンプレート（`csp/_headers.template`）の形は、pokemon の `_headers` と同じ（テストで同じ CSP になることを確かめている）。

```js
import { renderHeaders } from "../external/fara-site-kit/csp/render-headers.mjs";

renderHeaders({
    scriptSrc: ["https://challenges.cloudflare.com"],
    styleSrc: [],
    fontSrc: ["https://fonts.gstatic.com"],
    imgSrc: [],
    connectSrc: ["https://challenges.cloudflare.com"],
    frameSrc: ["https://challenges.cloudflare.com"],
    noindex: false,
});
```

- 欄: `scriptSrc`・`styleSrc`・`fontSrc`・`imgSrc`・`connectSrc`（`https://` と `wss://`）・`frameSrc`。ホストは使うものだけ書く。`https://ホスト名` の形のみ（`*`・`https:` だけ・パス・`;`・空白は拒否する）。`scriptSrc` と `styleSrc` には `'sha256-…'` のハッシュを書ける（importmap などに使う）。
- 固定の方針（`CLAUDE.md`）: `script-src` に `'unsafe-inline'` と `'unsafe-eval'` は書けない（拒否する）。`'wasm-unsafe-eval'` は固定で入る。`style-src` の `'unsafe-inline'` は MudBlazor のために固定で入る。
- `noindex: true` で `X-Robots-Tag: noindex` を `/*` に付ける。`build-pages` は develop のとき自動で `true` にする。
- Cloudflare の上限（超えるとエラー）: `_headers` はルール（`/*` を含むパスの行）が 100 個まで、1 行が 2,000 文字まで。
- `scriptSrc`・`styleSrc` の `'sha256-…'` は、sha256 の base64（44 文字、末尾 `=`）だけを受ける。sha384・sha512 は受けない。
- `cacheRules`（`[{ "path": "/_framework/*", "value": "public, max-age=31536000, immutable" }]`）は既定では付けない。pokemon の `_headers` にはキャッシュの規則が無いため。`immutable` は、ファイル名にハッシュが付いていないファイルには使わない（デプロイ後に古いファイルが残るため）。
- `build-pages` の `site.json` の `csp` にこの引数を書けば、`_headers` も一緒に作られる。Worker の `/api/*` には付かない（Cloudflare の静的アセットだけ）。

## 8. Razor の部品（`src/FaraSiteKit.Razor`）

MudBlazor 9.11.0 と、`FaraSiteKit.Core` を使う Razor クラスライブラリ（net10.0）。参照は `ProjectReference`（3 と同じ）。

```xml
<ProjectReference Include="..\..\external\fara-site-kit\src\FaraSiteKit.Razor\FaraSiteKit.Razor.csproj" />
```

### 8.1 最小の構成

**Program.cs**（`AddFaraSiteKit` が、SiteOptions・テーマの状態・MudBlazor を登録する）

```csharp
builder.Services.AddFaraSiteKit(options =>
{
    options.Name = "サイト名";
    options.Author = "作者";
    options.PublishedYear = 2026;
    options.AuthorHomeUrl = "https://example.com/";
    options.DevelopHost = "example-dev.example.com";  // 確認用ホスト（空なら切り替えない。8.4）
    options.Social.Add(new SiteSocialLink("github", "https://github.com/...")); // URL が空のものは出ない
});
var maintenance = await MaintenanceInfo.LoadAsync(new HttpClient { BaseAddress = new Uri(baseAddress) });
builder.Services.AddSingleton(maintenance);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");   // 報告・404 の noindex と、ページの題名に必要
```

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
    <SearchBox>...サイトの検索欄（8.5）...</SearchBox>
    <HeaderEnd><ThemeSwitch /></HeaderEnd>
    <MobileHeaderActions>...</MobileHeaderActions>
    <SearchSheet Context="close">...検索欄...</SearchSheet>
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

- スロットの位置: `SearchBox`・`HeaderEnd` は PC のヘッダーの中央・右。`MobileHeaderActions` はスマホのヘッダー（省略可）。`SearchSheet` はスマホの検索欄（ヘッダーの検索ボタンで開く。省略すると検索ボタンを出さない）。
- `SiteNavItem(Href, Label, Icon, Disabled, Title)`: Href は相対パス（`""` がホーム）。`Disabled` の項目は選べない（`aria-disabled="true"`）。現在のページは自動で active。
- 項目は `<a href>` のまま。スマホでメニューを閉じるのは、画面の移動で行う（OnClick は付けない）。
- ヘッダーの名前は `SiteOptions.Name`（`HomeHref` へのリンク）。別の表示にしたいときは `Brand` に渡す。
- `MobilePageScroll`（既定 false）: true にすると、スマホ（767.98px 以下）でページ全体（window）がスクロールする。既定は、スマホでもページ全体を画面の高さに収め、本文の中だけをスクロールさせる。PC には影響しない。
- `MudProviders` は SiteLayout の中に置かれる（テーマは `CustomTheme` で替えられる。省略は紫系の既定）。

**App.razor**: `Router` の `DefaultLayout` を上の MainLayout にし、`<NotFound>` で `NotFoundView` を出す。ページが移ったときは、SiteLayout が本文（`#fsk-main`）へフォーカスを移す（最初の読み込みでは動かさない）。`FocusOnNavigate` は使わない。

```razor
<Router AppAssembly="@typeof(App).Assembly">
    <Found Context="routeData">
        <RouteView RouteData="@routeData" DefaultLayout="@typeof(MainLayout)" />
    </Found>
    <NotFound>
        <LayoutView Layout="@typeof(MainLayout)">
            <NotFoundView HomeHref="./" />
        </LayoutView>
    </NotFound>
</Router>
```

### 8.2 部品の一覧

| 部品 | 役目 | 主なパラメータ |
| --- | --- | --- |
| `SiteLayout` | ヘッダー・サイドバー（PC は Mini、スマホは一時的なメニュー）・本文・フッター・お知らせ帯。サイドバーなしの上部ナビにもできる（8.3） | `Brand` `SearchBox` `HeaderEnd` `MobileHeaderActions` `SearchSheet` `DrawerContent` `TopNav` `ShowDrawer` `CollapseTopNavOnMobile` `Maintenance` `CustomTheme` `PageClass` |
| `MudProviders` | MudBlazor の土台（テーマ・ポップアップ・ダイアログ・通知） | `CustomTheme` |
| `ThemeSwitch` | ライト／ダーク（スイッチ。`AsButton` で文字のボタン） | `AsButton` `LightLabel` `DarkLabel` |
| `SiteNavMenu` | サイドバーの項目（見出しと項目は `SiteNavGroup`・`SiteNavItem`） | `Groups` `Top` |
| `SiteFooter` | フッター（サイト名・問い合わせ・プライバシー・©・SNS）。`<footer>`（contentinfo）として、本文の外に置く | （`SiteOptions` から） |
| `ReportFormView` | 「作者へ報告」（問い合わせ）のフォーム。Turnstile・送信の状態・noindex | `Title` `Lead` `From` `NoIndex` `UnavailableNote` `MessagePlaceholder` `ContactHint` `Timeout` `ContactRequired` `ContactFormat` `ContactLabel` `ContactPlaceholder` |
| `NotFoundView` | 404（ページが見つからない） | `Code` `Title` `Lead` `HomeHref` `HomeText` `NoIndex` |
| `MaintenanceBanner` | 「更新予定」のお知らせ（Notice のときだけ） | `Info` |
| `MaintenanceScreen` | メンテナンス中の画面（Program.cs で切り替える）。文言は文字として出す（HTML は出さない。改行だけが改行） | `Info` `Heading` `Lead` `Contact` |
| `ScrollProgress` | ヘッダー下端の、読んだ量の線 | — |
| `SocialLinks` | フッターの SNS（URL は https:// だけ。それ以外は描かない） | （`SiteOptions.Social`） |

- 報告フォームの例（`Pages/Report.razor`）:

```razor
@page "/report"
<ReportFormView From="@From" UnavailableNote="お急ぎの場合は、SNS からお願いします。" />
@code {
    [SupplyParameterFromQuery(Name = "from")] public string? From { get; set; }
}
```

- 連絡先を必須にする・X のユーザー名に限る（既定は従来どおり任意・自由な文字列）:

```razor
<ReportFormView From="@From" ContactRequired="true" ContactFormat="ReportContactFormat.XHandle"
                ContactLabel="X のユーザー名（@@○○）" ContactPlaceholder="@@example" />
```

  - **Razor の属性（`"…"`）の中の `@` は `@@` と書く**（`@` 1 つのままだと RZ9986 / RZ1005 のコンパイルエラー。画面には `@○○`・`@example` と出る）。C# のコード（`@code`・テスト）の文字列では、そのまま `@` でよい。

  - `ContactRequired`: 空のままでは送れない（見出しの末尾が「（必須）」になる。任意のときは「（任意）」）。
  - `ContactFormat`: `Any`（既定。長さだけ検査）／`XHandle`（`@` + 英数字とアンダースコア 1〜15 文字。前後の空白は無視。全角の `＠` は不可）。任意のときは、空なら検査せず、書いたときだけ形を検査する。
  - `ContactLabel`・`ContactHint`・`ContactPlaceholder`: 欄の見出し・説明・例。未指定は、必須か任意かに合わせた既定の文。
  - 検査は画面側（`ReportForm.Validate`）だけ。Worker（`worker/report.js`）は従来どおり連絡先の長さしか見ない（直接 POST されれば空や別の形でも通る。連絡先は返信のためで、安全のための検査ではない）。

- 報告の送信先は `SiteOptions.ReportApiPath`（既定 `api/report`）・確認の設定は `ReportConfigPath`（既定 `api/report/config`）。Worker（`worker/report.js`）と同じ形。
- 報告の文字数は、コードポイント単位（絵文字も 1 文字。worker/report.js と同じ数え方）。UTF-16 の長さとは違う。
- 長文のページ（プライバシーポリシーなど）は `fsk-page-column fsk-page-column--wide`（PC で横幅 72rem）。入力のページ（問い合わせなど）は `fsk-page-column`（46rem）。

### 8.3 上部ナビだけの構成（サイドバーなし）

サイドバーを使わないサイトは、`ShowDrawer="false"` にして、`TopNav` に横に並ぶ項目を渡す。

```razor
<SiteLayout Body="@Body" ShowDrawer="false" CollapseTopNavOnMobile="true">
    <TopNav>
        <a class="fsk-topnav-link" href="top">ホーム</a>
        <a class="fsk-topnav-link" href="top/works">作品</a>
    </TopNav>
    <HeaderEnd><ThemeSwitch /></HeaderEnd>
</SiteLayout>
```

- `ShowDrawer=false`: サイドバーもハンバーガーも描かない。上部ナビは PC のヘッダーに横に並ぶ（幅が足りないときは横にスクロール）。
- `CollapseTopNavOnMobile=true`: スマホだけは、ハンバーガーで開く一時的なメニューに上部ナビを入れる（縦に並ぶ）。畳まないときは、スマホのヘッダーに横スクロールで出す。
- サイトごとに 1 つのレイアウトを作り、ページは `@layout` で選ぶ（サンプル: `samples/MinimalSite/Shared/TopNavLayout.razor`）。

### 8.4 確認用サイトへの切り替え（自動）

- `SiteOptions.DevelopHost` に、その確認用のホスト名（例: `pokemon-dev.fara-labs.com`）だけを入れる。空なら切り替えない。
- 作者のホームページのリンクは、`SiteFooter` が**実行中のホスト名**（`NavigationManager.BaseUri`）と DevelopHost を比べ、一致したら `fara-labs.com` を `dev.fara-labs.com` などに切り替える（`SiteLinks.Localize`）。`SiteLinks.CurrentHost` を手で入れる必要はない。
- 本番のホストで開いたときは、リンクはそのまま。

### 8.5 検索の契約（kit と、サイトの分担）

検索は、kit が持つ範囲とサイトが持つ範囲を分けている。

| 持つもの | 担当 |
| --- | --- |
| スマホの検索欄（Sheet）の開閉、ヘッダーの検索ボタン、ハンバーガーとの排他（欄とメニューを同時に開かない） | kit（`SiteLayout`・`SearchSheet`） |
| 欄を閉じたときのフォーカスを検索ボタンへ戻す（閉じる・Esc・画面の移動） | kit |
| Esc で欄を閉じる（欄の中で押したキーが、kit の `SearchSheet` の要素に届く） | kit |
| 画面の移動で欄を閉じる | kit |
| 入力欄へのフォーカス（欄を開くとき、欄の中の最初の `input`。ID は決め打ちしない） | kit（JS） |
| 検索ロジック・候補の一覧・結果の並び・件数 | サイト |
| `role="combobox"`・`aria-expanded`・`aria-controls`・`aria-activedescendant`・`role="listbox"` などの ARIA | サイト（候補の部品が持つ） |
| ↑↓・Enter・←→（別の開き方）などの候補の選択 | サイト |
| Ctrl+K・「/」で検索欄へ移る | サイト（ヘッダーの検索部品が持つ） |
| IME の変換中の Enter・↑↓ を無視する | サイト（候補の部品が、`e.isComposing` と keyCode 229 を見る） |

- サイトの検索部品が Esc を先に使うとき（候補を閉じるだけ、など）は、その部品の要素に `@onkeydown:stopPropagation="true"` を付けると、kit は欄を閉じない（欄を閉じるのは、次の Esc）。
- 検索部品の入力欄は `type="search"` で、`aria-label` を付ける。
- samples/MinimalSite が、この契約の最小の例（スマホで Esc を押すと欄が閉じる）。

### 8.6 保存のキーと移行（既存サイトの引き継ぎ）

テーマと PC のサイドバーの状態は、次の 2 つのキーに保存する。**`SiteOptions`（C#）と、index.html の `theme-init.js` の `data-storage-key`・`data-sidebar-key` は、同じ値にする**（違うと、描画の前の反映と保存が別の場所を見る。起動の後に、コンソールに警告が出る）。

| 項目 | kit の既定（新しいサイト） | 例: pokemon（既存のキー） |
| --- | --- | --- |
| `SiteOptions.StorageKey` と `data-storage-key` | `fara-site-kit.settings` | `fara-pokemon-battle-assistant.settings` |
| `SiteOptions.SidebarKey` と `data-sidebar-key` | `fara-site-kit.sidebar-hidden` | `fara-pokemon-battle-assistant.sidebar-hidden` |

- 保存の形式は、JSON の `Theme`（`"light"` か `"dark"`）と、サイドバー（`"1"` で隠す）。pokemon の既存の値と同じ形なので、**値のコピーは要らない**。キーを同じにすれば、既存のユーザーの設定（ダーク・サイドバー・他の項目）はそのまま読める。テーマの保存は、同じ JSON の他の項目（`DataSetKey`・`Format` など）を消さない。
- 移行の手順（既存のサイトを kit の部品に替えるとき）:
  1. `SiteOptions.StorageKey` と `SidebarKey` に、既存のキーをそのまま入れる（例: 上の pokemon の値）。
  2. index.html の `theme-init.js` の `data-storage-key` と `data-sidebar-key` に、同じ値を入れる。
  3. 旧い名前のキーを消す処理（pokemon の `fara-pokemon-assistance.*` の削除など）は、サイトの index.html に残す（kit の関わることではない）。
  4. 確認: 既存のブラウザ（ダークで保存したもの）で開き、ダークのまま表示されること。コンソールに `[fara-site-kit]` の警告が出ないこと。
- kit の既定のキーから別のキーへ移すときも、同じ手順（両方を同じ値にする）。保存された値は自動では引き継がれない。必要なら、サイトが一度だけ旧いキーから読み直す。

### 8.7 index.html

`docs/index-template.html` の断片を、サイトの `wwwroot/index.html` に合わせる。`<html>` は `data-bs-theme="light"`、`<meta name="viewport">` には `viewport-fit=cover`（フッターの安全領域のため）を付ける。

- `theme-init.js` の `data-storage-key` と `data-sidebar-key` は、`SiteOptions` と同じ値（8.6）。
- 読み込み表示（`#boot-indicator`）と `inert` の対象（`.entry-static`）は、断片のとおり。CSP は 8.8。
- 起動の後に、`faraSiteKit.checkConfig` が、data 属性と SiteOptions が違えば警告する（theme-init.js が無い場合も）。

### 8.8 CSP（Turnstile・Google Fonts）

Blazor WebAssembly（`'wasm-unsafe-eval'`）と MudBlazor（`style-src 'unsafe-inline'`）は、`csp/render-headers.mjs` が常に入れる。外部のサービスは、サイトが使うものだけ足す。`csp/render-headers.mjs` の `presets` を展開して渡す:

```js
import { renderHeaders, presets } from "../external/fara-site-kit/csp/render-headers.mjs";
const headers = renderHeaders({ ...presets.turnstile, ...presets.googleFonts });
```

| 使うもの | 必要な欄 | presets |
| --- | --- | --- |
| 報告フォームの Turnstile | `script-src https://challenges.cloudflare.com`・`frame-src https://challenges.cloudflare.com`・`connect-src https://challenges.cloudflare.com` | `presets.turnstile` |
| Google Fonts（CSS とフォント） | `style-src https://fonts.googleapis.com`・`font-src https://fonts.gstatic.com` | `presets.googleFonts` |
| 報告の API（`/api/report`） | 同じオリジンなら `'self'` で足りる。別のホストに置くときだけ `connectSrc` に足す | — |

- `'unsafe-inline'` と `'unsafe-eval'` の script は、どの presets も入れない（拒否の規則は維持）。
- presets の一覧に無い外部のサービスは、公式の要件を確かめてから、サイトの設定に直接書く。

### 8.9 クラス名の移行（`fsk-` 接頭辞）

kit の部品のクラス名は、`fsk-` の接頭辞で統一した（pokemon などの CSS との重複を避けるため）。サイトが kit の CSS を使うときは、新しい名前で書く。

| 旧 | 新 |
| --- | --- |
| `content` | `fsk-content` |
| `page-header` | `fsk-page-header` |
| `page-column` | `fsk-page-column`（長文は `fsk-page-column--wide`） |
| `page-card` | `fsk-page-card` |
| `page-pane` / `pane-scroll` | `fsk-page-pane` / `fsk-pane-scroll` |
| `card` / `card-body` | `fsk-card` / `fsk-card-body` |
| `nowrap` | `fsk-nowrap` |
| `app-header` / `app-brand` | `fsk-header` / `fsk-brand` |
| `sidebar` / `sidebar-toggle` / `side-nav` / `nav-section` | `fsk-sidebar` / `fsk-menu-toggle` / `fsk-nav` / `fsk-nav-section` |
| `skip-link` / `scroll-progress` / `theme-switch` | `fsk-skip-link` / `fsk-scroll-progress` / `fsk-theme-switch` |
| `site-footer*` | `fsk-footer*`（`fsk-footer-line`・`fsk-footer-socials` など） |
| `maintenance-notice*` / `maintenance-screen` | `fsk-notice*` / `fsk-maintenance` |
| `report-card` / `report-trap` | `fsk-report-card` / `fsk-report-trap` |
| `app-field` / `app-select` | `fsk-field` / `fsk-select` |
| `form-group` / `form-label` / `text-muted` | `fsk-form-group` / `fsk-form-label` / `fsk-muted` |
| html の `sidebar-hidden` / `search-open` | `fsk-sidebar-hidden` / `fsk-search-open` |
| `#site-sidebar` | `#fsk-sidebar` |

- 保存のキー（`fara-site-kit.sidebar-hidden` など）は、クラス名ではないので、この表の対象外（8.6）。

### 8.10 pokemon へ取り込むときの名前の衝突（メモ）

pokemon の既存の型・ファイルと、kit の部品の名前が重なる。取り込むときは、pokemon 側を外してから kit を使う（別の作業）。

- 型・部品: `SocialLinks`（pokemon の静的クラスと、kit の Razor 部品）・`SocialIcon`・`SiteFooter`・`MudProviders`・`MaintenanceBanner`。両方の名前空間を using すると、曖昧な参照（CS0104）になる。
- `_Imports.razor`: kit の `@using FaraSiteKit.Razor.Components` を入れると、pokemon の同名の部品と衝突する。pokemon の部品を先に消すか、kit の部品を `FaraSiteKit.Razor.Components.SiteFooter` のように書く。
- CSS: pokemon の `app.css` の `.site-footer`・`.page-column` などと、kit の CSS（`fsk-` の接頭辞）は名前が違うので重ならない。pokemon の CSS の共通の塊を消すときは、8.9 の表を見る。
- `index.html`: pokemon の `theme-init.js` と、kit の `theme-init.js` を両方読まない。

### 8.11 確認

- `dotnet test tests/FaraSiteKit.Razor.Tests`（bUnit）・`dotnet test tests/FaraSiteKit.Core.Tests`
- `npm test`（worker・build・csp と、JS の `tests/js/kit-js.test.mjs`。JS だけは `npm run test:js`）
- `samples/MinimalSite` は、同じ構成の最小の例（上部ナビの構成のページ `/top` を含む）。`dotnet build samples/MinimalSite` が CI で通ること。公開はしない。

### 8.12 導入手順（小規模サイト向け: portfolio・bot など）

静的 SSR のサイトを WASM に移すときの最短の流れ。詳しい説明は 8.1〜8.9。

1. **submodule を追加**: `git submodule add https://github.com/fara1991/fara-site-kit.git external/fara-site-kit` のあと、使うタグに固定する（`cd external/fara-site-kit && git checkout vX.Y.Z`）。CI のチェックアウトは `submodules: true`。
2. **参照を足す**: Web プロジェクトの csproj に `FaraSiteKit.Razor` の `ProjectReference`（8 の冒頭）。`_Imports.razor` に `FaraSiteKit.Core`・`FaraSiteKit.Razor`・`FaraSiteKit.Razor.Components`・`MudBlazor` の using。
3. **`SiteOptions`**: `Program.cs` で `AddFaraSiteKit(options => ...)`。最低限 `Name`・`Author`・`PublishedYear`・`AuthorHomeUrl`・`DevelopHost`（確認用ホスト。空なら切り替えない）。`Social` は URL が空のものは出ない。`StorageKey`・`SidebarKey` は、既存の保存を引き継ぐ場合だけ旧い値に合わせる（8.6）。`HeadOutlet` と `MaintenanceInfo` の登録も 8.1 のとおり。
4. **レイアウト**: `MainLayout.razor` は `SiteLayout` に `Body`・`Maintenance` を渡す。ナビは `ShowDrawer="false"` と `TopNav`（8.3）か、`DrawerContent` に `SiteNavMenu`。スマホでページ全体をスクロールさせたいサイトは `MobilePageScroll="true"`（既定の false は、本文の中だけがスクロールする）。
5. **`index.html`**: `docs/index-template.html` の断片に合わせる。必須の data 属性は `theme-init.js` の `data-storage-key`・`data-sidebar-key`（`SiteOptions.StorageKey`・`SidebarKey` と同じ値。違うと起動時にコンソールへ警告）。`#boot-indicator`・`<div id="app">`・静的な本文の `class="entry-static"` と、body 末尾のスクリプトの順番（boot-indicator.js → fara-site-kit.js → scroll-progress.js → report.js → blazor.webassembly.js）も断片のとおり。
6. **静的ファイル（`build-pages`）**: ページごとの title・description・本文を `pages.json` に、サイト名・ホストを `site.json` に書き、`dotnet publish` の出力の `index.html`（本文が空のもの）を `--template` にして実行する（6 の「使い方」）。

   ```bash
   node external/fara-site-kit/build/build-pages.mjs      --site site.json --pages pages.json --template artifacts/template/index.html      --out publish/wwwroot --env production   # 確認用は --env develop
   ```

   `site.json` の `bodyRootClass` は `entry-static`（読み込み表示の JS が使う）。`--out` はテンプレートと別のフォルダにする。
7. **Worker**: `worker/index.js` から kit の `report.js`・`maintenance.js` を import する（2）。お知らせの帯は `fsk-notice`（Razor の `MaintenanceBanner` と同じ class）。
8. **確認**: `wrangler deploy --dry-run`（本番・確認用）、`dotnet test`、`npm test`。確認用で、起動の表示・ダーク・メンテナンス・404 を見る。

## 9. 静的解析・レイアウトの自動計測（未リリース・v0.6.0 で入る）

- ESLint の共通設定と、C# のアナライザーの取り込み: [lint.md](lint.md)
- レイアウトの自動計測（幅ごとの崩れ・見えるフォーカス・押せる範囲・文字の大きさ・メニューの Esc）: [layout-check.md](layout-check.md)

どちらも、違反が出る CI を各サイトに足すときの手順を書いてある。計測の限界（見た目・色・実機は見ない）は、各文書の最後を見る。
