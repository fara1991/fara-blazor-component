# メンテナンス表示の切り替え（Actions の画面 / 一括変更 CLI）

Worker の変数 `MAINTENANCE_MODE`（`true` / `notice` / `false`）と `MAINTENANCE_MESSAGE`（文面）を切り替える方法は 2 つ。**第一の手段は、GitHub Actions の「Run workflow」画面で入力して実行する方法**（スマホの GitHub アプリからも可）。Cloudflare のトークンも、手元の環境変数も要らない。4 サイトをまとめて切り替えたいときだけ、手元の CLI（`tools/maintenance.mjs`）を使う（補助）。

| 方法 | 使う場面 | 必要なもの |
| --- | --- | --- |
| 1. Actions の画面で実行する | 1 サイトずつ。いつでも・どこからでも | GitHub のアカウントだけ(ブラウザかスマホアプリ) |
| 2. CLI の `set` | 4 サイトをまとめて(dev を先に流し、成功したら本番) | `gh auth login` 済みの `gh`。環境変数は不要 |
| 2. CLI の `status` | 4 サイトの現在値を 1 つの表で見る(任意) | Cloudflare の読み取りトークン(Workers Scripts の Read)。無くてもよい(結果は Actions のジョブサマリーにも出る) |

どちらの方法でも、実際の反映は各サイトの deploy ワークフロー(`wrangler deploy --var ...`)が行う。両方とも同じ入力 `maintenance_mode` / `maintenance_message` を使う。**公開されるのは、実行するブランチ(dev = `develop`、本番 = `master`)の最新のコード**である点に注意する。

## 1. Actions の画面で実行する(第一の手段)

1. サイトのリポジトリ → **Actions** → 対象のワークフロー(pokemon・portfolio は dev が「Deploy (develop)」、本番が「Deploy」。avatar・bot は 1 つのワークフローで、ブランチで dev / 本番が決まる)を開く。スマホの GitHub アプリでも、リポジトリ → Actions → ワークフロー → 「Run workflow」で同じ入力欄が出る
2. **Run workflow** を押し、**Use workflow from** でブランチを選ぶ(dev = `develop`、本番 = `master`)
3. 入力欄に入れる:
   - `maintenance_mode`: `true` = 全体メンテナンス(全ページがメンテナンス画面・503)、`notice` = お知らせ帯、`false` = 通常、空 = 変更しない
   - `maintenance_message`: お知らせ・メンテナンス画面に出す文(200 文字まで・改行なし)。空 = 変更しない
4. 実行する。終わったら、その実行のページ下部の**ジョブサマリー**に、設定した値と反映後の現在値(`MAINTENANCE_MODE` と `MAINTENANCE_MESSAGE`)が出る

本番を `notice` や `false` にしたいだけのとき、`maintenance_mode` を空にして `maintenance_message` だけを入れると、モードは変えずに文面だけを変える(本番を勝手にメンテナンス画面にはしない)。まず dev で試してから、本番で実行する。

## 2. CLI でまとめて実行する(補助)

`tools/maintenance.mjs`。Node 22 以上、依存なし(`fetch` と GitHub CLI の `gh` だけ)。

| サブコマンド | やること | 使うもの |
| --- | --- | --- |
| `status` | 全 Worker の現在値を表にする(**読み取りだけ**) | Cloudflare API の `GET`。トークンは Workers Scripts の **Read** 権限で足りる(任意) |
| `set` | 各サイトの deploy ワークフローを手動実行(`workflow_dispatch`)して、値を反映する(上の 1 を、複数サイトに対してまとめて行う) | `gh`(ログイン済み)。**環境変数は不要。Cloudflare の API には書き込まない・トークンも使わない** |

- 終了コード: `0` = 成功(ドライランを含む)、`1` = 失敗・中断・確認の不一致、`2` = 使い方の誤り

### なぜ Cloudflare API で書き込まないのか

Worker の設定を API で書き換える方式は採らない。シークレットの値は API から読み出せないため、設定を書き換えて壊したときに復元できないからである。代わりに、サイトの公開と同じ経路（ワークフローの `wrangler deploy --var ...`）で変数を渡す。`wrangler deploy` は、`wrangler.jsonc` の `keep_vars = true` の設定により、ダッシュボードで足した変数とシークレットを保持する。`--var` で渡した変数だけが、その公開で上書きされる。

### 準備

#### `set` に必要なもの

- `gh auth login` 済みであること（各サイトのリポジトリのワークフローを実行できる権限）
- 各サイトの deploy ワークフローに、下の「ワークフローの雛形」の入力と `--var` の渡し方が入っていること

#### `status` に必要なもの(任意。API トークン)

Cloudflare ダッシュボード → 右上のプロフィール → **My Profile → API Tokens → Create Token → Create Custom Token**。

- 権限: **Account → Workers Scripts → Read** の 1 つだけ（書き込み権限は要らない）
- Account Resources: 対象のアカウントだけ
- 有効期限（TTL）は任意。短くしておくと安全。公開（デプロイ）用のトークンを使い回さない
- `status` を使うときだけ、環境変数で渡す(コマンドの引数やログに出さない。この CLI も出力に出さない):

```bash
export CLOUDFLARE_API_TOKEN=...    # 上で作ったトークン
export CLOUDFLARE_ACCOUNT_ID=...   # ダッシュボードの Workers & Pages の右側
```

#### 対象のサイト(`tools/maintenance-sites.json`)

サイトごとに、GitHub のリポジトリ（`repo`）、環境（`dev` / `production`）ごとの deploy ワークフローのファイル名と ref（`workflows`）、`status` で読む Worker 名（`workers`。各サイトの `wrangler.jsonc` / `wrangler.toml` の `name` と同じ）を書く。同梱の例:

| サイト | dev（ワークフロー / ref / Worker） | production（ワークフロー / ref / Worker） |
| --- | --- | --- |
| pokemon | `deploy-develop.yml` / `develop` / `fara-pokemon-dev` | `deploy.yml` / `master` / `fara-pokemon` |
| avatar | `deploy.yml` / `develop` / `fara-avatar-dev` | `deploy.yml` / `master` / `fara-avatar` |
| bot | `site.yml` / `develop` / `fara-twitch-bot-dev` | `site.yml` / `master` / `fara-twitch-bot` |
| portfolio | `deploy-develop.yml` / `develop` / `fara-portfolio-dev` | `deploy.yml` / `master` / `fara-portfolio` |

別の一覧を使うときは `--sites-file <パス>`。Worker を足すときは JSON にサイトを足す（dev だけのサイトも可。例: avatar の WASM 移行用の確認用 Worker は、Cloudflare 側の作成後に足す）。

### `status` — 現在値の一覧

```bash
node tools/maintenance.mjs status                      # 全サイトの dev・production
node tools/maintenance.mjs status --env dev --site pokemon
```

サイト・環境・Worker 名・`MAINTENANCE_MODE`・`MAINTENANCE_MESSAGE` を表にする。値が `plain_text` でない（シークレットなど）ときは `(secret_text)` のように種類だけを出す。旧 `MAINTENANCE` が残っている Worker は備考に出る（読まれないので無害）。

終了コード: 全 Worker の値を取得できたら `0`。1 件でも取得できなかった（Worker が見つからない = 名前かアカウントの誤り、権限や通信の失敗）ら `1`。取得できた行は表に出る。

### `set` — 値を切り替える

```bash
node tools/maintenance.mjs set --env dev|production|all [--site <名前>...] [--mode true|notice|false] [--message "文面"] [--apply] [--confirm "production サイト名,..."]
```

- `--env` は必須（うっかり全部を変えないため）。`--site` は繰り返し・カンマ区切りで複数指定できる。省略すると全サイト
- `--mode` か `--message` の少なくとも一方が必要。**production を含むときは `--mode` が必須**（`--message` だけの変更は dev だけ。本番の公開が意図しない表示の切り替えにならないようにするため）。`--message` は 200 文字まで・改行なし・空は不可。指定しなかった方は、その公開では渡さない（`wrangler deploy` が現在の値を保持する）。文面を出したくないときは、`--mode false` に戻す（`false` では文面は出ない）
- **既定はドライラン**: 実行する `gh workflow run ...` のコマンドを順に表示するだけ。`--apply` を付けたときだけ実行する

実行の順序:

1. dev のワークフローを、すべて起動する（`gh workflow run <file> --repo <repo> --ref <ref> -f maintenance_mode=... -f maintenance_message=...`）
2. それぞれの実行の URL を表示し、`gh run watch --exit-status` で結果を待って表示する
3. dev がすべて成功したら、production を 1 サイトずつ、起動 → 待つ → 表示（**production は、master の最新のコードが `wrangler deploy` で公開される**。実行前の確認文言にも出る）
4. **どれかが失敗したら、そこで中断**する（それ以降は実行しない。終了コード 1）

起動した run は、起動前の一覧との差に加えて、`gh` のログインユーザーが起動した `workflow_dispatch` であること・対象のブランチであること・作成時刻・`headSha` がブランチの先頭のコミットと一致することで特定する。条件に合う新しい run が 2 つ以上見つかったら、取り違えを避けるために中断する。

production を含む `--apply` は、`--confirm`（実行すると master の最新が公開される）に **`production <サイト名をカンマ区切り・アルファベット順>`**（例: `production pokemon,portfolio`）の再入力が必要。ターミナルで対話できるときは、`--confirm` を省くと入力を求められる。一致しなければ、何も実行しない。ドライランでは求めない。

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
        description: "メンテナンス表示の切り替え。true = 全体メンテナンス（全ページがメンテナンス画面・503）、notice = お知らせ帯、false = 通常。空 = 変更しない"
        type: choice
        options: ["", "true", "notice", "false"]
        default: ""
      maintenance_message:
        description: "お知らせ・メンテナンス画面に出す文（200 文字まで・改行なし）。空 = 変更しない"
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

**production**（`master`）: 従来の「公開の前に `MAINTENANCE_MODE` が `notice` かを確かめ、公開と同時に `true` にする」運用を残しつつ、`set` で mode を指定したときはそちらを使う。分岐は次のとおり（テストが、この `run` を実際に bash で動かして固定している）:

| きっかけ | `--var MAINTENANCE_MODE` | `--var MAINTENANCE_MESSAGE` |
| --- | --- | --- |
| push（master）、または mode も message も空の手動実行 | `true`（公開と同時にメンテナンス画面）。`skip_maintenance_check` が true なら付けない | 付けない |
| mode を指定した手動実行（`set`） | 指定した値 | message があれば付ける |
| mode が空で message だけの手動実行 | 付けない（現在の値を保持） | 付ける |

```yaml
      # push（master）と、値を指定しない手動実行は、従来どおり: 公開の前に notice を確かめる（skip_maintenance_check で飛ばせる）
      # mode に true / notice / false のどれかを指定した手動実行（maintenance-cli の set）は、操作した人の意思なので、確認を飛ばす
      - name: Require MAINTENANCE_MODE=notice
        if: ${{ !contains(fromJSON('["true","notice","false"]'), inputs.maintenance_mode) }}
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
          elif [ -z "$MAINTENANCE_MESSAGE_INPUT" ] && [ "$SKIP_MAINTENANCE_CHECK" != "true" ]; then
            vars+=(--var "MAINTENANCE_MODE:true")   # push と、何も指定しない手動実行だけ: 従来どおり、公開と同時にメンテナンス画面にする
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

`skip_maintenance_check` だけでは、`MAINTENANCE_MODE` は作られない（`--var` を付けないため）。まだ変数が無い Worker に作るには、`set --mode ...` を使う。

**`choice` の空文字の選択肢（`options: [""...]`）は、GitHub が受け付けるか未検証**。最初に dev のワークフローで、Actions の「Run workflow」の画面と `gh workflow run` の両方で確かめる。使えないときは、`type: string`（既定 `""`）にして、ワークフローの先頭のステップで `true` / `notice` / `false` / 空のどれかであることを検査する（`case "$MAINTENANCE_MODE_INPUT" in true|notice|false|"") ;; *) echo "::error::maintenance_mode が不正です"; exit 1;; esac`）。CLI が渡す値は変わらない。

### 3. 実行後のサマリー(公開のステップの後に足す)

`status` を使わなくても結果が分かるように、公開の後に、設定した値と反映後の現在値をジョブサマリー(`$GITHUB_STEP_SUMMARY`)に出す。文面はサマリーに出してよい。シークレットは出さない(トークンは Authorization ヘッダにだけ使い、出力しない)。`WORKER_NAME` は各サイトの Worker 名(dev は `...-dev`)にする。公開が失敗したときも出す(`always()`)。

```yaml
      - name: Summary (maintenance)
        if: ${{ always() }}
        shell: bash
        run: |
          msg="$(printf '%s' "$MAINTENANCE_MESSAGE_INPUT" | tr '`' '"')"
          {
            echo "### メンテナンス表示 (${WORKER_NAME})"
            echo "- 設定した値: MAINTENANCE_MODE=\`${MAINTENANCE_MODE_INPUT:-(変更なし)}\` / MAINTENANCE_MESSAGE=\`${msg:-(変更なし)}\`"
            node -e '
              const j = (v) => JSON.stringify(v);
              fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${process.env.WORKER_NAME}/settings`, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } })
                .then((r) => r.json())
                .then((b) => {
                  const list = b?.result?.bindings ?? [];
                  const v = (n) => { const x = list.find((y) => y.name === n); return x ? (x.type === "plain_text" ? j(x.text).replaceAll("`", "\u0027") : `(${x.type})`) : "(未設定)"; };
                  console.log(`- 反映後の現在値: MAINTENANCE_MODE=\`${v("MAINTENANCE_MODE")}\` / MAINTENANCE_MESSAGE=\`${v("MAINTENANCE_MESSAGE")}\``);
                })
                .catch(() => console.log("- 反映後の現在値: 取得できませんでした"));
            '
          } >> "$GITHUB_STEP_SUMMARY"
        env:
          MAINTENANCE_MODE_INPUT: ${{ inputs.maintenance_mode }}
          MAINTENANCE_MESSAGE_INPUT: ${{ inputs.maintenance_message }}
          WORKER_NAME: fara-portfolio
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

反映後の現在値が `(secret_text)` や `(未設定)` になるときは、`--var` の変数が API の GET で値として見えない可能性がある(下の適用手順 6)。

### 4. 適用の手順（サイトごと）

1. 上の入力・公開のステップ・実行後のサマリーのステップを、サイトの deploy ワークフロー（pokemon: `deploy.yml` と `deploy-develop.yml`、avatar: `deploy.yml`、bot: `site.yml`、portfolio: `deploy.yml` と `deploy-develop.yml`）に入れる。avatar と bot は 1 つのワークフローが dev と production の両方を担うので、ステップの `--env` の式（`github.ref_name == 'master' && 'production' || 'dev'`）はそのまま使い、`--var` の部分だけ置き換える
2. `require-maintenance.mjs` が読む変数名を `MAINTENANCE_MODE` にする（`b.name === "MAINTENANCE_MODE"`）。メッセージ・テストも合わせる
3. ワークフローを参照しているテスト（`--var MAINTENANCE:true` の文字列を探すもの）を、新しい式に合わせる
4. **ゲートが Worker の不在（404）をどう扱うか**を確かめる（`require-maintenance.mjs` の `run`）。まだ本番の Worker が無いサイト（例: pokemon）では、ゲートが止めるのか通すのかで、初回の手順が変わる。止めるなら、初回は `set --mode true` でゲートを飛ばして作る（下の「本番の初回」）
5. 文面に `:` を含む場合でも、`wrangler deploy --var NAME:値` が最初の `:` で分けて値を受け取ることを、dev で一度確かめる（`set --env dev --mode notice --message "20:00 ごろ"` → `status`）
6. **dev で実測する（`set` → `status`）**: `--var` で渡した変数が、`status`（`GET .../settings`）で `"notice"` のように値が見えること、`require-maintenance.mjs`（同じ GET で読む）が読めることを確かめる。`--var` の変数が値の見えない形（`(secret_text)` や未設定）で返る場合は、次のどちらかにする
   - ゲートの読み取りを GET 以外にする（例: Worker の `/api/maintenance` を読む）。`status` の値の確認も同様に `/api/maintenance` で行う
   - 変数をダッシュボードで設定する運用に戻す（`set` は使わず、`wrangler deploy` は `--var` を付けない）
7. dev で `set` を試して、`status` に反映されることと、シークレット・Durable Object・assets などが消えていないこと（サイトが普通に動くこと）を確かめてから、production に使う

### 本番の初回（Worker がまだ無いサイト）

本番の Worker が未作成のサイト（例: pokemon）は、初回の公開で `MAINTENANCE_MODE=true` を付けて、メンテナンス画面のまま（非公開のまま）作る:

```bash
node tools/maintenance.mjs set --env production --site pokemon --mode true --apply --confirm "production pokemon"
```

mode を指定した手動実行はゲートを飛ばし、`--var MAINTENANCE_MODE:true` を付けて公開する。`skip_maintenance_check` だけでは `--var` が付かず、変数は作られない。公開の用意ができたら `set --env production --site pokemon --mode false --apply` で通常に戻す。**production の `set` は、そのとき master にあるコードをすべて公開する**ので、公開してよい状態になってから行う。

## 旧 `MAINTENANCE` 変数

0.3.0 から、Worker は `MAINTENANCE_MODE` だけを読む。旧 `MAINTENANCE` が Cloudflare に残っていても、読まれないので何も起きない。この CLI は旧変数を消さない。消したいときは、Cloudflare ダッシュボードの Worker →「設定」→「変数とシークレット」で手動で削除する（`status` の備考に残っている Worker が出る）。

## トークンと安全について

- `set` は Cloudflare のトークンを使わない（GitHub の `gh` のログインだけ）。`status` のトークンは Read 権限だけにして、画面にもログにも出さない（エラー文に含まれても `***` に置き換える）
- 文面は `gh` に引数として渡す（シェルを通さない）。制御文字（改行を含む）は拒否する
- 本番を含む `--apply` は、サイト名の再入力が必須。dev で失敗したときは本番を実行しない
