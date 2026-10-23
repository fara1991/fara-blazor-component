# メンテナンス一括変更 CLI（`tools/maintenance.mjs`）

複数サイトの Worker の変数 `MAINTENANCE_MODE`（`true` / `notice` / `false`）と `MAINTENANCE_MESSAGE`（文面）を、Cloudflare の API でまとめて見る・変える。Node 22 以上、依存なし（`fetch` のみ）。

- **既定はドライラン**（変更内容の差分を表示するだけ）。`--apply` を付けたときだけ書き込む
- **本番（production）を変えるときは、サイト名の入力が必須**
- 終了コード: `0` = 成功（ドライラン・変更なしを含む）、`1` = どれかの Worker で失敗・確認の不一致、`2` = 使い方の誤り

## 準備

### API トークン

Cloudflare ダッシュボード → 右上のプロフィール → **My Profile → API Tokens → Create Token → Create Custom Token**。

- 権限: **Account → Workers Scripts → Edit** の 1 つだけ（`status` だけなら Read でよい）
- Account Resources: 対象のアカウントだけ
- **有効期限（TTL）を付ける**（作業の日だけなど、短く）。使い終わったら削除する
- 公開用（デプロイ）のトークンを使い回さない。専用に作る

### 環境変数

```bash
export CLOUDFLARE_API_TOKEN=...    # 上で作ったトークン（履歴に残さない。ツールの出力にも出さない）
export CLOUDFLARE_ACCOUNT_ID=...   # ダッシュボードの Workers & Pages の右側
```

### 対象のサイト（`tools/maintenance-sites.json`）

サイトごとに、本番（`production`）と確認用（`dev`）の Worker 名を書く。名前は各サイトの `wrangler.jsonc` / `wrangler.toml` の `name` と同じ。同梱の例:

| サイト | production | dev |
| --- | --- | --- |
| pokemon | `fara-pokemon` | `fara-pokemon-dev` |
| avatar | `fara-avatar` | `fara-avatar-dev` |
| bot | `fara-twitch-bot` | `fara-twitch-bot-dev` |
| portfolio | `fara-portfolio` | `fara-portfolio-dev` |

別の一覧を使うときは `--sites-file <パス>`。Worker を足すときは JSON にサイトを足す（dev だけのサイトも可）。

## サブコマンド

### `status` — 現在値の一覧

```bash
node tools/maintenance.mjs status                      # 全サイトの dev・production
node tools/maintenance.mjs status --env dev --site pokemon
```

サイト・環境・Worker 名・`MAINTENANCE_MODE`・`MAINTENANCE_MESSAGE` を表にする。旧 `MAINTENANCE` が残っている Worker は備考に出る。Worker が無い・取得に失敗したものがあれば終了コード 1。

### `set` — 値を変える

```bash
node tools/maintenance.mjs set --env dev|production|all [--site <名前>...] [--mode true|notice|false] [--message "文面"] [--apply]
```

- `--env` は必須（うっかり全部を変えないため）。`--site` は繰り返し・カンマ区切りで複数指定できる。省略すると全サイト
- `--mode` か `--message` の少なくとも一方が必要。`--message ""` で文面を空にできる（200 文字まで・改行なし）
- 変数がまだ無い Worker には作る。すでに同じ値の Worker は「変更なし」で書き込まない
- 変数が `secret_text`（シークレット）になっている Worker は、値を読めない・変えると型が変わるため、変更せずにエラーにする

例:

```bash
# 1. 確認用で試す（ドライラン → 実行）
node tools/maintenance.mjs set --env dev --mode notice --message "10月25日 20:00 ごろ、サイトを更新します"
node tools/maintenance.mjs set --env dev --mode notice --message "10月25日 20:00 ごろ、サイトを更新します" --apply

# 2. 本番（実行するときに「production pokemon,portfolio」のように、対象のサイト名の入力を求められる）
node tools/maintenance.mjs set --env production --site pokemon --site portfolio --mode notice --message "..." --apply

# 3. 終わったら通常に戻す（お知らせも一緒に消える）
node tools/maintenance.mjs set --env all --mode false --apply
```

### `rename` — 旧 `MAINTENANCE` から `MAINTENANCE_MODE` への移行（一度きり）

```bash
node tools/maintenance.mjs rename --env dev [--site <名前>...] [--overwrite] [--apply]
```

旧 `MAINTENANCE` の値を新しい `MAINTENANCE_MODE` にコピーして、旧変数を削除する。

- 旧変数が無い Worker は何もしない（繰り返し実行しても安全）
- すでに `MAINTENANCE_MODE` があって値が違うときは止める。旧の値で上書きしてよければ `--overwrite`
- 旧変数が `secret_text` のときは、値を読めないので移行できない（ダッシュボードで作り直す）
- 移行の順序は `docs/changelog.md` の 0.3.0 を参照（kit を上げた Worker は旧名を読まない）

## 安全のしくみ

- **バインディングを消さない**: Cloudflare の `PATCH /accounts/{id}/workers/scripts/{name}/settings` は、`bindings` を全部置き換える。そこで、まず `GET .../settings` で現在の設定を取得し、変える `plain_text` の変数だけ新しい値にして、ほかの `plain_text` は取得した値のまま、それ以外（`secret_text`・Durable Object・assets・KV など）は `{ "type": "inherit", "name": ... }` で現在の設定を引き継ぐ。送るのは `bindings` だけ（`multipart/form-data` の `settings` フィールド）
- **書き込み後の検査**: 書き込んだあと、もう一度取得して、変えるつもりのないバインディングが 1 つも減っていない・型が変わっていない・狙いの値になっていることを確かめる。違えば失敗（終了コード 1）
- **バックアップ**: `--apply` のとき、変更前のバインディング（取得した内容。`secret_text` は名前と種類だけ）を `./maintenance-backup/<日時>.json` に保存する（`--backup-dir` で場所を変更、`--no-backup` で無効。`.gitignore` 済み）
- **本番の確認**: 本番を含む変更は、`production <サイト名をカンマ区切り・アルファベット順>`（例: `production pokemon,portfolio`）の入力が一致しないと書き込まない。対話できない環境では `--confirm "production pokemon"` で渡す。ドライランでは求めない
- **取得に失敗した Worker があるとき**は、`--apply` でも何も書き込まない
- **トークンは出力に出さない**: 画面にもバックアップにも出さない。エラー文にたまたま含まれても `***` に置き換える。コマンドの引数には渡さず、環境変数だけで受ける
- 1 件の書き込みに失敗しても、残りは続ける（最後に終了コード 1）。失敗した Worker はバックアップから確認できる

## 初回は確認用（dev）で

`inherit` による引き継ぎは Cloudflare の API の挙動に依存する。初めて使うときは、本番の前に **dev の 1 サイトだけ**で `--apply` まで試し、`status` と Cloudflare ダッシュボードで、変数・シークレット・Durable Object・assets のバインディングが残っていることを確かめる。

## 公開のワークフローとの関係

公開（`wrangler deploy`）は `keep_vars = true` でダッシュボードの変数を残す。ただし、ワークフローが `--var MAINTENANCE_MODE:true` を付けて公開すると、その変数は公開のたびに上書きされる。この CLI で `false` に戻したあとも、次の公開で `true` に戻らないか、サイトのワークフローを確かめる。
