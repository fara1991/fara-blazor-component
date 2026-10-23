# メンテナンス一括変更 CLI（`tools/maintenance.mjs`）

複数サイトの Worker の変数 `MAINTENANCE_MODE`（`true` / `notice` / `false`）と `MAINTENANCE_MESSAGE`（文面）を、まとめて見る・切り替える。Node 22 以上、依存なし（`fetch` と GitHub CLI の `gh` だけ）。

| サブコマンド | やること | 使うもの |
| --- | --- | --- |
| `status` | 全 Worker の現在値を表にする（**読み取りだけ**） | Cloudflare API の `GET`。トークンは Workers Scripts の **Read** 権限で足りる |
| `set` | 各サイトの deploy ワークフローを手動実行（`workflow_dispatch`）して、値を反映する | `gh`（ログイン済み）。**Cloudflare の API には書き込まない・トークンも使わない** |

- 終了コード: `0` = 成功（ドライランを含む）、`1` = 失敗・中断・確認の不一致、`2` = 使い方の誤り

## なぜ Cloudflare API で書き込まないのか

Worker の設定を API で書き換える方式は採らない。シークレットの値は API から読み出せないため、設定を書き換えて壊したときに復元できないからである。代わりに、サイトの公開と同じ経路（ワークフローの `wrangler deploy --var ...`）で変数を渡す。`wrangler deploy` は、`wrangler.jsonc` の `keep_vars = true` の設定により、ダッシュボードで足した変数とシークレットを保持する。`--var` で渡した変数だけが、その公開で上書きされる。

## 準備

### `set` に必要なもの

- `gh auth login` 済みであること（各サイトのリポジトリのワークフローを実行できる権限）
- 各サイトの deploy ワークフローに、下の「ワークフローの雛形」の入力と `--var` の渡し方が入っていること

### `status` に必要なもの（API トークン）

Cloudflare ダッシュボード → 右上のプロフィール → **My Profile → API Tokens → Create Token → Create Custom Token**。

- 権限: **Account → Workers Scripts → Read** の 1 つだけ（書き込み権限は要らない）
- Account Resources: 対象のアカウントだけ
- 有効期限（TTL）は任意。短くしておくと安全。公開（デプロイ）用のトークンを使い回さない
- 環境変数で渡す（コマンドの引数やログに出さない。この CLI も出力に出さない）:

```bash
export CLOUDFLARE_API_TOKEN=...    # 上で作ったトークン
export CLOUDFLARE_ACCOUNT_ID=...   # ダッシュボードの Workers & Pages の右側
```

### 対象のサイト（`tools/maintenance-sites.json`）

サイトごとに、GitHub のリポジトリ（`repo`）、環境（`dev` / `production`）ごとの deploy ワークフローのファイル名と ref（`workflows`）、`status` で読む Worker 名（`workers`。各サイトの `wrangler.jsonc` / `wrangler.toml` の `name` と同じ）を書く。同梱の例:

| サイト | dev（ワークフロー / ref / Worker） | production（ワークフロー / ref / Worker） |
| --- | --- | --- |
| pokemon | `deploy-develop.yml` / `develop` / `fara-pokemon-dev` | `deploy.yml` / `master` / `fara-pokemon` |
| avatar | `deploy.yml` / `develop` / `fara-avatar-dev` | `deploy.yml` / `master` / `fara-avatar` |
| bot | `site.yml` / `develop` / `fara-twitch-bot-dev` | `site.yml` / `master` / `fara-twitch-bot` |
| portfolio | `deploy-develop.yml` / `develop` / `fara-portfolio-dev` | `deploy.yml` / `master` / `fara-portfolio` |

別の一覧を使うときは `--sites-file <パス>`。Worker を足すときは JSON にサイトを足す（dev だけのサイトも可。例: avatar の WASM 移行用の確認用 Worker は、Cloudflare 側の作成後に足す）。

## `status` — 現在値の一覧

```bash
node tools/maintenance.mjs status                      # 全サイトの dev・production
node tools/maintenance.mjs status --env dev --site pokemon
```

サイト・環境・Worker 名・`MAINTENANCE_MODE`・`MAINTENANCE_MESSAGE` を表にする。値が `plain_text` でない（シークレットなど）ときは `(secret_text)` のように種類だけを出す。旧 `MAINTENANCE` が残っている Worker は備考に出る（読まれないので無害）。

終了コード: 全 Worker の値を取得できたら `0`。1 件でも取得できなかった（Worker が見つからない = 名前かアカウントの誤り、権限や通信の失敗）ら `1`。取得できた行は表に出る。

## `set` — 値を切り替える

```bash
node tools/maintenance.mjs set --env dev|production|all [--site <名前>...] [--mode true|notice|false] [--message "文面"] [--apply] [--confirm "production サイト名,..."]
```

- `--env` は必須（うっかり全部を変えないため）。`--site` は繰り返し・カンマ区切りで複数指定できる。省略すると全サイト
- `--mode` か `--message` の少なくとも一方が必要。`--message` は 200 文字まで・改行なし・空は不可。指定しなかった方は、その公開では渡さない（`wrangler deploy` が現在の値を保持する）。文面を出したくないときは、`--mode false` に戻す（`false` では文面は出ない）
- **既定はドライラン**: 実行する `gh workflow run ...` のコマンドを順に表示するだけ。`--apply` を付けたときだけ実行する

実行の順序:

1. dev のワークフローを、すべて起動する（`gh workflow run <file> --repo <repo> --ref <ref> -f maintenance_mode=... -f maintenance_message=...`）
2. それぞれの実行の URL を表示し、`gh run watch --exit-status` で結果を待って表示する
3. dev がすべて成功したら、production を 1 サイトずつ、起動 → 待つ → 表示
4. **どれかが失敗したら、そこで中断**する（それ以降は実行しない。終了コード 1）

production を含む `--apply` は、`--confirm` に **`production <サイト名をカンマ区切り・アルファベット順>`**（例: `production pokemon,portfolio`）の再入力が必要。ターミナルで対話できるときは、`--confirm` を省くと入力を求められる。一致しなければ、何も実行しない。ドライランでは求めない。

例:

```bash
# 1. 確認用で試す（ドライラン → 実行）
node tools/maintenance.mjs set --env dev --mode notice --message "10月25日 20:00 ごろ、サイトを更新します"
node tools/maintenance.mjs set --env dev --mode notice --message "10月25日 20:00 ごろ、サイトを更新します" --apply

# 2. 本番（dev を先に流し、成功したら本番）
node tools/maintenance.mjs set --env all --site pokemon --site portfolio --mode notice --message "..." --apply --confirm "production pokemon,portfolio"

# 3. 終わったら通常に戻す（お知らせも一緒に消える）
node tools/maintenance.mjs set --env all --mode false --apply --confirm "production avatar,bot,pokemon,portfolio"
```

反映の確認は `status`。公開の直後は、反映に数十秒かかることがある。

`set` は、サイトのコードを公開し直す（`wrangler deploy`）。つまり、そのブランチ（dev は `develop`、production は `master`）の最新の内容が公開される。公開してはいけない変更が `master` に入っていないか、実行の前に確かめる。

## ワークフローの雛形（各サイトに入れる）

`set` が動くには、各サイトの deploy ワークフローが、入力 `maintenance_mode` と `maintenance_message` を受け取り、`wrangler deploy` に `--var` で渡す必要がある。入力は 2 つとも任意。

### 1. 入力（`on.workflow_dispatch.inputs`）

dev・production の両方のワークフローに足す（既存の `skip_maintenance_check` などはそのまま残す）。

```yaml
on:
  workflow_dispatch:
    inputs:
      maintenance_mode:
        description: "メンテナンス表示を切り替える（true = メンテナンス画面、notice = お知らせ、false = 通常。空なら変えない）"
        type: choice
        options: ["", "true", "notice", "false"]
        default: ""
      maintenance_message:
        description: "お知らせ・メンテナンス画面の文（200 文字まで。空なら変えない）"
        type: string
        default: ""
```

### 2. 公開のステップ（`wrangler deploy` の `--var`）

入力はシェルに直接埋め込まず、環境変数で受ける（文面に記号が入っても安全にするため）。空の入力には `--var` を付けない（付けないと、`keep_vars` により現在の値が保持される）。

**dev**（確認用。環境名は各サイトの設定に合わせる）:

```yaml
      - name: Deploy to Cloudflare Workers (develop)
        shell: bash
        run: |
          vars=()
          if [ -n "$MAINTENANCE_MODE_INPUT" ]; then vars+=(--var "MAINTENANCE_MODE:$MAINTENANCE_MODE_INPUT"); fi
          if [ -n "$MAINTENANCE_MESSAGE_INPUT" ]; then vars+=(--var "MAINTENANCE_MESSAGE:$MAINTENANCE_MESSAGE_INPUT"); fi
          npx wrangler deploy --env develop "${vars[@]}"
        env:
          MAINTENANCE_MODE_INPUT: ${{ inputs.maintenance_mode }}
          MAINTENANCE_MESSAGE_INPUT: ${{ inputs.maintenance_message }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

`push` で動いたとき（`inputs` が空）は `--var` が付かないので、従来どおり現在の値が保持される。

**production**（`master`）: 従来の「公開の前に `MAINTENANCE_MODE` が `notice` かを確かめ、公開と同時に `true` にする」運用を残しつつ、`set` で値を指定したときはそちらを使う。

```yaml
      # push（master）と、値を指定しない手動実行は、従来どおり: 公開の前に notice を確かめる（skip_maintenance_check で飛ばせる）
      # 値を指定した手動実行（maintenance-cli の set）は、操作した人の意思なので、確認を飛ばす
      - name: Require MAINTENANCE_MODE=notice
        if: ${{ inputs.maintenance_mode == '' }}
        run: node .github/scripts/require-maintenance.mjs fara-portfolio
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          SKIP_MAINTENANCE_CHECK: ${{ inputs.skip_maintenance_check }}

      - name: Deploy to Cloudflare Workers
        shell: bash
        run: |
          vars=()
          if [ -n "$MAINTENANCE_MODE_INPUT" ]; then
            vars+=(--var "MAINTENANCE_MODE:$MAINTENANCE_MODE_INPUT")
          elif [ "$SKIP_MAINTENANCE_CHECK" != "true" ]; then
            vars+=(--var "MAINTENANCE_MODE:true")   # 従来どおり、公開と同時にメンテナンス画面にする
          fi
          if [ -n "$MAINTENANCE_MESSAGE_INPUT" ]; then vars+=(--var "MAINTENANCE_MESSAGE:$MAINTENANCE_MESSAGE_INPUT"); fi
          npx wrangler deploy --env="" "${vars[@]}"
        env:
          MAINTENANCE_MODE_INPUT: ${{ inputs.maintenance_mode }}
          MAINTENANCE_MESSAGE_INPUT: ${{ inputs.maintenance_message }}
          SKIP_MAINTENANCE_CHECK: ${{ inputs.skip_maintenance_check }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

### 3. 適用の手順（サイトごと）

1. 上の入力と公開のステップを、サイトの deploy ワークフロー（pokemon: `deploy.yml` と `deploy-develop.yml`、avatar: `deploy.yml`、bot: `site.yml`、portfolio: `deploy.yml` と `deploy-develop.yml`）に入れる。avatar と bot は 1 つのワークフローが dev と production の両方を担うので、ステップの `--env` の式（`github.ref_name == 'master' && 'production' || 'dev'`）はそのまま使い、`--var` の部分だけ置き換える
2. `require-maintenance.mjs` が読む変数名を `MAINTENANCE_MODE` にする（`b.name === "MAINTENANCE_MODE"`）。メッセージ・テストも合わせる
3. ワークフローを参照しているテスト（`--var MAINTENANCE:true` の文字列を探すもの）を、新しい式に合わせる
4. 文面に `:` を含む場合でも、`wrangler deploy --var NAME:値` が最初の `:` で分けて値を受け取ることを、dev で一度確かめる（`set --env dev --message "20:00 ごろ"` → `status`）
5. dev で `set` を試して、`status` に反映されることと、シークレット・Durable Object・assets などが消えていないこと（サイトが普通に動くこと）を確かめてから、production に使う

## 旧 `MAINTENANCE` 変数

0.3.0 から、Worker は `MAINTENANCE_MODE` だけを読む。旧 `MAINTENANCE` が Cloudflare に残っていても、読まれないので何も起きない。この CLI は旧変数を消さない。消したいときは、Cloudflare ダッシュボードの Worker →「設定」→「変数とシークレット」で手動で削除する（`status` の備考に残っている Worker が出る）。

## トークンと安全について

- `set` は Cloudflare のトークンを使わない（GitHub の `gh` のログインだけ）。`status` のトークンは Read 権限だけにして、画面にもログにも出さない（エラー文に含まれても `***` に置き換える）
- 文面は `gh` に引数として渡す（シェルを通さない）。制御文字（改行を含む）は拒否する
- 本番を含む `--apply` は、サイト名の再入力が必須。dev で失敗したときは本番を実行しない
