# レイアウトの自動計測（tools/layout-check）

レビュー（人・エージェント）で繰り返し見つかったレイアウトの指摘を、CI で機械的に止めるための計測ライブラリ。Node（ESM）と `playwright-core` で動く。配信中のサイトを、幅ごとに開いて測る。

- 判定は `tools/layout-check/rules.mjs`（ブラウザなしで `node:test` の確認あり）。計測は `browser.mjs`。
- **これで止められるのは、数値で決まる崩れだけ**。見た目の良し悪し・色・実機・CLS・目視が要るものは止められない（後の「限界」）。

## 1. ルール

違反は `{ ページ・幅・ルール・要素のセレクター・値・メッセージ }` で返る。CLI は一覧を出し、違反があれば終了コード 1。

| ルール | 何を見るか | 既定 |
| --- | --- | --- |
| `no-horizontal-scroll` | ページ全体の横スクロール（`scrollWidth > clientWidth`）。はみ出している要素（右端が画面の幅を超える）を報告する | on |
| `single-h1` | 見える h1 がちょうど 1 つ（`.sr-only` の h1 も数える） | on |
| `focus-visible` | Tab で順に止まった要素に、見えるフォーカス表示がある（outline が none でない、box-shadow が変わる、枠線の色が変わる、のどれか） | on |
| `no-offscreen-focus` | Tab で止まった要素が画面の外にある（`left < -100` など）。閉じたドロワーの中のリンクが Tab で止まる不具合を見つける。ドロワーの `inert` の確認も、これで兼ねる（独立したルールは作っていない） | on |
| `tap-target` | 幅 600px 未満だけ。`a`・`button`・`[role=button]`・`input`・`select`・`summary` の押せる範囲が 44×44 以上。要素の中心から上下左右 ±21.5px（44px の箱の画素の中心どうし）が、自分（または子）に当たるかで判定する。文中のリンク（inline で前後に文字がある）は除く | on |
| `min-font-size` | 見えるテキストを持つ要素の文字の大きさが 12px 以上。装飾・アイコンフォントは `minFontSize.ignoreSelectors` か除外で外す | on |
| `menu-esc` | `menuEsc.buttonSelector` を設定したときだけ（既定 off）。スマホ幅（既定 768px 未満）でメニューを開き、Esc で閉じると、メニューボタンの `aria-expanded` が `false` に戻り、フォーカスがメニューボタンに戻る | 設定時のみ |

個別に止めるときは `rules: { "tap-target": false }` のように書く。

## 2. 設定の例（`layout-check.config.mjs`）

各サイトのルートに置く。値は配信中のサイトに合わせる。

```js
// layout-check.config.mjs
export default {
  baseURL: "http://localhost:8820",                  // 配信中のサイトの URL（パスは含めない）
  pages: [
    { path: "/", name: "トップ" },
    { path: "/works", name: "作品" },               // 文字列の "/works" でもよい（名前は path）
  ],
  viewports: [360, 390, 768, 1024, 1440],            // 既定も同じ
  viewportHeight: 800,                               // 既定 800
  readySelector: ".mud-layout",                      // 描画の後にだけある要素（Blazor など）。待ってから測る
  menuEsc: { buttonSelector: ".fsk-menu-toggle" },   // 省くと menu-esc は off
  rules: {
    "min-font-size": true,
  },
  tapTarget: { minSize: 44, maxWidth: 600 },         // 既定どおり
  minFontSize: { min: 12, ignoreSelectors: [".material-icons"] },
  focus: { maxStops: 40 },                           // Tab は最大 40 回
  timeoutMs: 30000,
  browser: { channel: undefined },                   // undefined = 同梱の chromium。ローカルで Edge を使うときは "msedge"
  exclusions: [
    {
      rule: "tap-target",
      selector: ".footer-note a",
      reason: "本文の注記の文字リンク。見た目を変えずに余白で広げるのは、別の PR で検討する",
    },
  ],
};
```

## 3. 除外（exclusions）

既知の例外だけを、**セレクター・ルール名・理由**つきで書く。

- `rule`（必須）: ルール名。`RULE_NAMES` のどれか
- `selector`（必須）: 除外する要素の CSS セレクター（`el.matches` で判定）
- `reason`（必須・空でない）: 理由。**理由の無い除外は設定エラー**（終了コード 2）
- `page`（任意）: `/` で始まるパス。省くとすべてのページ

除外は、その要素の違反だけを消す。ページ全体の問題（`single-h1` の h1 の数など）は、`selector` を `html` にして書けばよい。

## 4. CLI と終了コード

```bash
node tools/layout-check/cli.mjs --config layout-check.config.mjs
```

| 終了コード | 意味 |
| --- | --- |
| 0 | 違反なし |
| 1 | 違反あり（一覧を出す） |
| 2 | 計測できなかった（設定の誤り・ブラウザが起動しない・ページが開けない）。明確な文を出す |

### ブラウザ

- 既定は `playwright-core` の同梱 chromium。CI・初回は `npx playwright-core install --with-deps chromium`。
- ローカルで入れたくないときは `browser: { channel: "msedge" }`（Edge が入っている必要がある）。
- 起動に失敗すると終了コード 2 で「ブラウザを起動できなかった」と出す。

## 5. 各サイトへの導入

1. submodule を kit のタグに上げる（`external/fara-site-kit`）。
2. サイトの devDependency に `playwright-core` を入れる（版は kit と同じに固定する: `npm install -D --save-exact playwright-core@1.64.1`）。
3. `layout-check.config.mjs` を置く（上の例）。
4. 静的ファイルを配るときは、kit の簡易サーバーを使える（Node だけ。`/works` は `works.html` を探す）:

   ```bash
   node external/fara-site-kit/tools/layout-check/serve-static.mjs publish/wwwroot 8820
   ```

5. CI の job の例（ubuntu。ビルド → 配信 → 計測）:

   ```yaml
   layout-check:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
         with:
           submodules: true
       - uses: actions/setup-node@v4
         with:
           node-version: 22
       - run: npm ci
       - name: Build（サイトのビルド。公開用の静的ファイルを publish/wwwroot に作る）
         run: dotnet publish -c Release -o publish
       - name: Serve
         run: |
           node external/fara-site-kit/tools/layout-check/serve-static.mjs publish/wwwroot 8820 &
           for i in $(seq 1 30); do curl -sf http://127.0.0.1:8820/ > /dev/null && break; sleep 1; done
       - name: Install Chromium
         run: npx playwright-core install --with-deps chromium
       - name: Layout check
         run: node external/fara-site-kit/tools/layout-check/cli.mjs --config layout-check.config.mjs
   ```

   サイトのビルドの手順は、そのサイトの CI に合わせる（上の `dotnet publish` は例）。

6. 初めて入れるときは、違反を全部直すか、理由つきで除外してから必須にする（既存の違反で CI が落ちる状態にしない）。

## 6. kit 自身の確認

```bash
npm run test:layout-check                       # 統合テスト（ブラウザを使う。正しい例は 0 件、わざと崩した例は各ルールの違反が出ること）
LAYOUT_CHECK_CHANNEL=msedge npm run test:layout-check   # ローカルで Edge を使う
npm test                                        # 判定の純粋なテスト（ブラウザなし。tests/layout-check/rules.test.mjs を含む）
```

- 統合テストの fixture は `tests/layout-check/fixtures/good`（正しい例）と `bad`（わざと崩した例: h1 が 2 つ・20px のボタン・outline を消したリンク・閉じたドロワーの項目・10px の文字・横にはみ出す幅・Esc で閉じないメニュー）。
- CI の `layout-check` job は ubuntu だけで動く（chromium を入れる）。

## 7. 限界（これで止められないもの）

このチェックは**レイアウトの数値の崩れ**だけを見る。次は保証しない。人・エージェントのレビューはここに絞る。

- **見た目の良し悪し**（余白のリズム・揃え・情報の並び・画像の選び方）
- **色のコントラスト**（色そのものは見ない。`--fsk-warning-text` のような色の決め方は、人が確かめる）
- **実機**（iOS Safari・Android Chrome の挙動、実際の指での押しやすさ、フォントの描画の差）。計測はヘッドレス chromium（または Edge）だけ
- **CLS・描画の速さ**（レイアウトのずれは測らない。Lighthouse などで別に見る）
- **画面の読み上げ・支援技術の実際の挙動**（aria の値は、この一部だけを見る。`menu-esc` の `aria-expanded` と、フォーカスの戻り先のみ）
- **設計の妥当性**（どの情報を出すか、どの導線にするか）
- **Tab で届かない操作**（マウスだけで動く要素。Tab に入らないものは見ない）
- **見えるフォーカスの「良さ」**: `focus-visible` は、見える表示が「ある」ことだけを見る。太さ・色・コントラストは見ない
- **文字の大きさ**: 12px 以上かだけ。行間・読みやすさ・字間は見ない
- **押せる範囲**: 中心から上下左右に当たるかで見る。タップの誤爆（隣との間隔）や、押した後の挙動は見ない
- **動く要素・アニメーションの途中**: 計測は読み込み後の一瞬。`readySelector` で待つ要素が描画された後の状態だけ
