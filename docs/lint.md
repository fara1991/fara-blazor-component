# 静的解析（lint）の共通設定

レビューで繰り返し見つかったコードの指摘（空の catch・await 漏れ・async void・Dispose 漏れ・不要な代入など）を、CI で機械的に止める。方針は**ラチェット**: 今、違反が 0 件のルールだけ error にして、新しい違反を止める。違反が残るルールは warning のまま（件数を下に書く）。

レイアウトの計測は [layout-check.md](layout-check.md)。この lint では見た目は扱わない。

## 1. JavaScript（ESLint）

### 共通設定

`tools/lint/eslint.config.shared.mjs`。ルールは全サイトで同じ（`sharedRules`）。

| ルール | 中身 |
| --- | --- |
| `no-empty` | 空の catch・空のブロックを止める（`allowEmptyCatch: false`）。**コメントだけのブロックは許す**（理由を書けば通る） |
| `no-unused-vars` | 未使用の変数・引数・catch の変数。先頭が `_` のものは除く。`catch {` と書けば変数は要らない |
| `no-undef` | 宣言の無い変数（環境のグローバルは設定ごとに選ぶ） |
| `eqeqeq` | `==` を止める（`===` を使う） |
| `no-constant-condition` | 定数の条件（`while (true)` は許す） |
| `no-fallthrough` | switch の抜け落ち |
| `no-prototype-builtins` | `obj.hasOwnProperty(...)` を止める（`Object.hasOwn`） |
| `no-useless-catch` | 再送出しだけの catch |

環境（グローバル）は `globals` の `node`・`browser` から選ぶ。実行環境だけのグローバルは `extraGlobals`（例: Cloudflare Workers の `HTMLRewriter`）。

既定の `default` export（`...shared`）は、次の 2 つに分けている。

- Node の JS（`**/*.{js,mjs,cjs}`。ただし `**/wwwroot/js/**` を除く）: `node` の環境
- 画面の JS（`**/wwwroot/js/**/*.{js,mjs,cjs}`）: `browser` の環境（`sourceType` は既定の `module`。サイトの設定で `sourceType: "script"` と書けば上書きされる）

画面の JS に `node` の環境を当てると、`process`・`require` などの誤りが `no-undef` で見つからなくなるため、分けている（テスト: `tests/lint/shared-config.test.mjs`、`npm run test:lint`）。`createSharedConfig` は `ignores`（任意）を受け取る。

### kit 自身の設定

`eslint.config.mjs`（kit のルート）。

- `worker/`: Node + `HTMLRewriter`（Cloudflare Workers の実行環境だけのグローバル）
- `src/FaraBlazorComponent.Razor/wwwroot/js/`: ブラウザ・古い形の script（`sourceType: "script"`）
- `tools/layout-check/browser.mjs`: Node と browser（`page.evaluate` に渡す関数だけがブラウザで動く）
- それ以外（`tools/`・`build/`・`tests/`・`csp/`）: Node（`**/*.{js,mjs,cjs}`）

違反は直す。直せないものは `eslint-disable` ではなく、**設定の overrides に理由つきで書く**（`eslint.config.mjs` の `createSharedConfig` のコメントを参照）。

実行: `npm run lint`（CI の `lint` job）。版は `eslint` 10.13.0・`globals` 17.13.0 を固定（`^` `~` は付けない）。

### 各サイトへの取り込み

1. devDependency に入れる（版を固定）: `npm install -D --save-exact eslint@10.13.0 globals@17.13.0`
2. サイトのルートに `eslint.config.mjs`:

   ```js
   import shared, { createSharedConfig } from "./external/fara-blazor-component/tools/lint/eslint.config.shared.mjs";

   export default [
     ...shared,                                              // Node の JS（wwwroot/js 以外）と、画面の JS（wwwroot/js・browser）
     ...createSharedConfig({                                 // Worker の HTMLRewriter のように、サイトだけの実行環境のグローバル
       files: ["worker/**/*.js"],
       environments: ["node"],
       extraGlobals: { HTMLRewriter: "readonly" },
     }),
     ...createSharedConfig({                                 // 画面の JS（HTML の <script> で読む）
       files: ["wwwroot/js/**/*.js"],
       environments: ["browser"],
       sourceType: "script",
     }),
   ];
   ```

3. `npm run lint` を CI に足す（kit の `lint` job と同じ。`npm ci` の後に `npm run lint`）。

**注意**: 共通設定は `globals` を import する。import はファイルの場所から探すので、**サイトの node_modules に `globals` が要る**（kit の devDependency は、submodule 側には入らない）。
共通設定は `external/**`（取り込んだ kit）を lint の対象から外している。kit の JS は kit の CI で lint する（画面・Worker・Node で必要なグローバルが違うため、サイトの設定では誤った違反になる）。

**サイト側の新たな lint 違反に注意（kit の更新で増える）**: 既定の `...shared` は、画面の JS（`wwwroot/js`）に **Node のグローバルを当てない**。以前は当たっていたため、画面の JS で `process`・`require`・`module`・`exports`・`Buffer`・`global`・`__dirname`・`__filename`・`setImmediate` を使うと、kit を上げた後の `npm run lint` で `no-undef` が出る。直す（ブラウザの API に書き換える。`import` と `require` の違いに注意）か、その JS を `wwwroot/js` の外に置く（Node として lint される）。
この変更の時点（2026-10-29）で、サイト（labs・pokemon・album・avatar・bot）の `wwwroot/js` を、新旧の設定で lint して比べたところ、新たに落ちる箇所は 0 件だった。サイトの側の `eslint.config.mjs` は変えなくてよい（画面の JS の `sourceType: "script"` は、サイトの設定のままで効く）。

## 2. C#（アナライザー）

### 設定

- `tools/lint/dotnet.editorconfig`（`is_global = true`。global の設定はセクションを使わない）
- `Directory.Build.props`（kit のルート）: `GlobalAnalyzerConfigFiles` で上を読む。`EnforceCodeStyleInBuild`（IDE の規則を `dotnet build` でも見る。IDE0059 に必要）。`Microsoft.VisualStudio.Threading.Analyzers` 17.14.15（`PrivateAssets="all"`）

kit の `Directory.Build.props` は kit の中のプロジェクトだけに効く。サイトのプロジェクトには、サイト自身の `Directory.Build.props` で同じ設定を入れる（下）。

### ルール

| ルール | 重大度 | 違反（kit 時点） | 中身 |
| --- | --- | --- | --- |
| `CS4014` | **error** | 0 | await していない非同期呼び出し |
| `VSTHRD100` | **error** | 0 | `async void`（イベント以外） |
| `CA1816` | **error** | 0 | Dispose で `GC.SuppressFinalize` を呼んでいない |
| `IDE0059` | **error** | 0 | 不要な代入 |
| `CA1031` | warning | 3 | 一般の例外の catch。`src/FaraBlazorComponent.Core/MaintenanceInfo.cs`（`LoadAsync`）・`src/FaraBlazorComponent.Razor/Services/SiteThemeState.cs`（`TryLoadSync`・`InitializeAsync`）。一般の例外を受けて、起動や描画を止めない場所（意図した握りつぶし） |
| `CA2000` | warning | 24 | Dispose 漏れ。大半はテストの `HttpClient`・`FakeHandler`・`StringWriter`（テスト用の使い捨て）。ノイズが多いため warning |
| `VSTHRD002`・`VSTHRD003`・`VSTHRD103` | warning（パッケージの既定） | 4 | 同期の待ち・開始していない Task の待ち・同期の書き込み。`SiteLayoutTests`・`ReportFormViewTests`・`MaintenanceInfo.cs`。error にしない |

### 確認していないもの（ラチェットに入れていない）

- `CS1998`（await の無い async）・`CA2012`（ValueTask の二重使用）: この SDK（.NET 10）では、わざと違反を入れても報告されなかった。報告されないルールを error にすると「0 件」が誤りになるので、入れていない。SDK が変わって報告されるようになったら、確かめて入れる。
- `CA2007`（ConfigureAwait）: kit は ASP.NET や UI の同期文脈で使うため、要らない（入れない）。

### ルールが動くかの確認（error にする前に）

違反を入れたファイルで、`dotnet build` が報告するかを見る（確認のあと、そのファイルは消す）。kit では `CS4014`・`VSTHRD100`・`CA1816`・`IDE0059` を確かめた。新しい error を足すときも同じ。

### 各サイトへの取り込み

1. サイトの `Directory.Build.props`（ルート）に、kit の設定と同じものを入れる:

   ```xml
   <Project>
     <PropertyGroup>
       <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
       <EnableNETAnalyzers>true</EnableNETAnalyzers>
     </PropertyGroup>
     <ItemGroup>
       <GlobalAnalyzerConfigFiles Include="$(MSBuildThisFileDirectory)external/fara-blazor-component/tools/lint/dotnet.editorconfig" />
     </ItemGroup>
     <ItemGroup>
       <PackageReference Include="Microsoft.VisualStudio.Threading.Analyzers" Version="17.14.15" PrivateAssets="all" />
     </ItemGroup>
   </Project>
   ```

2. サイトの違反を直してから入れる。直せないものは、サイト側の設定で `warning` に下げ、理由をコメントに書く。kit の `dotnet.editorconfig` 自体は変えない。サイト側で上書きしたら、`dotnet build` の結果を見て、意図どおりに効いているかを確かめる。
3. `dotnet build` が通るか確かめる（`TreatWarningsAsErrors` は使わない）。

## 3. 限界

- 見た目（余白・揃え・文字の読みやすさ）・色のコントラスト・実機・CLS・設計の妥当性は、この lint も [layout-check](layout-check.md) も保証しない。人・エージェントのレビューは、その部分に絞る。
- アナライザーは、書かれたコードの形しか見ない。「何をすべきか」（別の API を使うべきか・非同期の設計）は見ない。
