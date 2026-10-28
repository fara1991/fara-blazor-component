# メンテナンス表示の切り替え（Actions の画面 / 一括変更 CLI）

Worker の変数 `MAINTENANCE_MODE`（`true` / `notice` / `false`）と `MAINTENANCE_MESSAGE`（文面）を切り替える方法は 3 つ。**第一の手段は、GitHub Actions の「Run workflow」画面で入力して実行する方法**（スマホの GitHub アプリからも可）。Cloudflare のトークンも、手元の環境変数も要らない。5 サイトをまとめて切り替えたいときは、kit の Actions（3）か、手元の CLI（2。補助）を使う。

| 方法 | 使う場面 | 必要なもの |
| --- | --- | --- |
| 1. Actions の画面で実行する | 1 サイトずつ。いつでも・どこからでも | GitHub のアカウントだけ(ブラウザかスマホアプリ) |
| 2. CLI の `set`(補助) | 4 サイトをまとめて(dev を先に流し、成功したら本番) | `gh auth login` 済みの `gh`。環境変数は不要 |
| 3. kit の Actions「Set maintenance (all sites)」 | 4 サイトをまとめて、スマホからでも。手元の環境変数も CLI も不要 | 一度だけ: PAT(`SITES_DISPATCH_TOKEN`)と Environment の登録(下の 3) |
| 2. CLI の `status`(補助) | 4 サイトの現在値を 1 つの表で見る(任意) | Cloudflare の読み取りトークン(Workers Scripts の Read)。無くてもよい(結果は Actions のジョブサマリーにも出る) |

1・2・3 のどの方法でも、実際の反映は各サイトの deploy ワークフロー(`wrangler deploy --var ...`)が行う。いずれも同じ入力 `maintenance_mode` / `maintenance_message` を使う。**公開されるのは、実行するブランチ(dev = `develop`、本番 = `master`)の最新のコード**である点に注意する。

## 1. Actions の画面で実行する(第一の手段)

1. サイトのリポジトリ → **Actions** → 対象のワークフロー(pokemon・portfolio は dev が「Deploy (develop)」、本番が「Deploy (production)」。avatar・bot は 1 つのワークフロー「Deploy」で、ブランチで dev / 本番が決まる)を開く。スマホの GitHub アプリでも、リポジトリ → Actions → ワークフロー → 「Run workflow」で同じ入力欄が出る
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

別の一覧を使うときは `--sites-file <パス>`。Worker を足すときは JSON にサイトを足す（dev だけのサイトも可）。

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

事前確認と計画: `--apply` と `--plan` のときは、起動の前に、各ワークフローのファイルが ref の上で入力 `maintenance_mode`(`--message` を渡すなら `maintenance_message` も)を受け取れる版かを、`GET /repos/{repo}/contents/...` で見る。受け取れないサイトは、警告つきで飛ばす(失敗させない)。すべて飛ばされたら失敗(`--allow-empty` なら成功)。`--plan` は、この事前確認だけをして計画を表示する(何も起動しない・本番の確認も求めない)。本番の再入力は、飛ばす前に選んだサイト名。PAT の Contents: Read が無く確かめられないときは、従来どおり dispatch する。

反映の確認は `status`。公開の直後は、反映に数十秒かかることがある。

`set` は、サイトのコードを公開し直す（`wrangler deploy`）。つまり、そのブランチ（dev は `develop`、production は `master`）の最新の内容が公開される。公開してはいけない変更が `master` に入っていないか、実行の前に確かめる。

## 3. kit の Actions から 4 サイトまとめて切り替える

> album（fara-vrc-photo-album）は対象に**含めない**。2026-10-28 から、サイトの公開を GitHub Actions では行わず（手元のアプリから公開）、起動するワークフローが無いため。

kit のリポジトリ(`fara1991/fara-site-kit`)の Actions →「**Set maintenance (all sites)**」→ Run workflow で、4 サイトに一度に反映する。手元の環境変数も CLI も要らない(スマホの GitHub アプリからも可)。中身は 2 の `set` を、Actions の上で動かしているだけ(`.github/workflows/set-maintenance-all.yml` → `tools/maintenance-all.mjs` → `tools/maintenance.mjs set`)。

**Use workflow from は `master` のみ**(`validate` が検査する。develop など、ほかのブランチ上からは実行できない)。

入力(反映先は**チェックボックス**で選ぶ。複数チェック可。サイトは常に 4 つすべて):

| 入力 | 値 |
| --- | --- |
| `develop`(チェック。既定 ON) | 各サイトの dev(`develop` ブランチ)に反映する |
| `master`(チェック。既定 OFF) | 各サイトの本番(`master` ブランチ)に反映する。`maintenance_mode` が必須。承認が要る。**そのサイトの master の最新のコードが公開される** |
| `maintenance_mode` | 空 / `true` = 全体メンテナンス(503) / `notice` = お知らせ帯 / `false` = 通常。空 = 変更しない(`master` では必須。message だけの変更は `develop` だけ) |
| `maintenance_message` | 文面(200 文字まで・改行なし)。空 = 変更しない |

1 つもチェックしないと、`validate` で止まる。例: `develop` と `master` の両方をチェックすると、dev に反映し、成功したら本番に反映する。

動き:

1. `validate` job: 入力を検査する(シークレットは渡さない)。実行元が `master` か、チェックボックスが 1 つ以上か、`maintenance_mode` / 文面(200 文字以内・制御文字なし)が正しいか、`master` を選んだとき mode があるか、を確かめる。通らなければ、後の job は動かない
2. `dev` job(Environment `develop-maintenance`): まず**計画**(事前確認)を、選んだ**すべての対象(本番を含む)**について行い、飛ばすサイトと理由をジョブサマリーに出す(本番の承認画面より前に見える)。実行できる対象が 1 つも無ければ、ここで失敗する。そのあと、`develop` をチェックしていれば、dev を実行する(各サイトの dev 用ワークフローを起動し、結果を待つ)。**`master` だけを選んだときも、計画のためにこの job は動く**(`develop-maintenance` にレビュワーを付けていると、その承認が要る)
3. `production` job(`master` をチェックしたときだけ。Environment `production-maintenance`): dev(develop をチェックしたとき)が**全部成功してから**、**承認(必須レビュワー)が済むまで動かない**。承認の画面(Review deployments)では、**入力値(チェックしたブランチ・`maintenance_mode` / `maintenance_message`)と、`dev` job のサマリーの計画(飛ばすサイト)、対象各サイトの master の最新のコード(公開される内容)を確認してから**承認する。承認後、各サイトの本番ワークフローを `master` で 1 サイトずつ起動し、結果を待つ
4. 起動した run の特定・失敗で中断・サマリーは `set` のとおり。ジョブサマリーに、各サイトの run の URL と結果が出る
5. `concurrency`(dev と本番で別の枠)で、同じ枠の job を同時に 2 つ動かさない。実行中のものは止めない。待てるのは 1 件だけで、さらに追加すると、古い待機は取り消される(最後に押したものだけが残る)

### 事前確認(入力を受け取れない版は、失敗させず飛ばす)

各サイトの対象ブランチに、入力 `maintenance_mode`(文面も渡すなら `maintenance_message`)を受け取る新しい版のワークフローが入っていないと、dispatch は失敗する。そこで、起動の前に、`GET /repos/{repo}/contents/{ワークフローのファイル}?ref={ブランチ}` でファイルの中身を見て、入力が無いサイトは**警告つきで飛ばす**。

- 飛ばしたサイトと理由は、**必ずジョブサマリー**に出る(`dev` job の計画に、本番の分も含めて出る。production job のサマリーにも出る)
- 選んだ対象が**すべて飛ばされた**ら失敗(何も反映されなかったことが分かる)。一部だけなら成功で、飛ばしたサイトは警告として残る
- ワークフローのファイルがその ref に無い(404)ときも飛ばす
- PAT に **Contents: Read** が無いと、事前確認の GET が 403 になり、確かめられない。このときは飛ばさずに dispatch する。dispatch が **HTTP 422 `Unexpected inputs provided`**(そのサイトのその ref のワークフローが、入力を受け取れない版)で返ったら、**失敗にせず、そのサイトを「飛ばす(警告)」にして続行する**(サマリーにも出る。dev でも本番でも同じ)。422 以外のエラー(認証・ワークフロー不在・その他の 4xx / 5xx)は、従来どおり失敗で中断する。すべて飛ばされたら失敗、の規則は同じ
- **Contents: Read-only が必要なリポジトリ**: 非公開のリポジトリ(**avatar と portfolio**)は、PAT に Contents: Read-only が無いと、事前確認の GET が 403 になる(公開のリポジトリは、トークンが無くても読めるが、PAT の権限が絞られていても通る場合がある)。付けておくと、事前確認で飛ばす判断ができ、起動した run のコミット照合もできる
- 事前確認のパスは `.github/workflows/{ファイル名}`(ワークフローのファイルは、リポジトリの `.github/workflows/` の下にある)
- 現状: 各サイトの master 側は、すべて未対応(各サイトの develop → master のマージまで)。この間、master をチェックすると、本番は飛ばされる旨の警告が出る。avatar の dev(develop の `deploy.yml`)は入力つきの版が入っているので、飛ばされずに反映される

### 注意点

1. **各サイトの対象ブランチに、入力つきのワークフローが入っている必要がある**(上のとおり、無いサイトは飛ばされる)。サイト側の develop → master のマージが済むまで、本番側はそのサイトに反映されない。サマリーの警告で確かめる
2. **pokemon の本番は未作成の間**、master のワークフローが旧版(入力なし)なので、この Actions からは作れない(飛ばされる)。初回は pokemon の develop → master のマージ(master への push)で作る。push は `--var MAINTENANCE_MODE:true` を付けるので、メンテナンス画面のまま(非公開のまま)作られる。作ったあとの切り替えから、この Actions を使う
3. 各サイトの `develop` 側は、新しい入力つきのワークフローが先に入るので、dev から使える

### 登録するもの(ユーザー向けの手順)

**トークンはチャットや issue に貼らない**。次の画面に直接入力する。

PAT は repository secret ではなく、**Environment のシークレット**に置く。理由: `workflow_dispatch` は「実行時に選んだ ref(ブランチ)」のワークフローを使う。repository secret にすると、書き込み権限のある人が別ブランチで書き換えたワークフローから、PAT を読めてしまう。Environment のシークレットは、Deployment branches を決めておけば、そのブランチのワークフローでしか使えない。このワークフローは `master` からしか実行しないので、**2 つの Environment の Deployment branches は、どちらも `master` だけ**にする。

1. fine-grained PAT を作る: GitHub → 右上のアイコン → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Resource owner: 自分(`fara1991`)
   - Repository access: **Only select repositories** → `fara-pokemon-battle-assistant`、`fara-avatar-modding-guide`、`fara-bot-moderator`、`fara-portfolio-site` の **4 つだけ**（album は、公開を Actions で行わなくなったので外した）
   - Repository permissions: **Actions: Read and write**(Metadata: Read-only は自動で付く)。あわせて **Contents: Read-only を付けることを推奨**する。(a) 事前確認(入力を受け取れないサイトを飛ばす)ができる、(b) 起動した run が各ブランチの先頭のコミットのものかまで照合でき、取り違えを防げる(付けなくても動くが、その 2 つが働かない)
   - 有効期限(Expiration): 必ず付ける(短めにして、切れたら作り直す)
2. Environment を **2 つ**作る: **fara-site-kit → Settings → Environments → New environment**

   | Environment | Deployment branches and tags(Selected branches and tags) | Required reviewers |
   | --- | --- | --- |
   | `develop-maintenance` | **`master` だけ** | 任意。付けない運用でも、付ける運用(dev でも承認が要る)でも動く |
   | `production-maintenance` | **`master` だけ** | **必須**(自分を追加) |

   - すでに `develop-maintenance` の Deployment branches を `develop` にしている場合は、**`master` に変更する**: **Settings → Environments → `develop-maintenance` → Deployment branches and tags** で、`develop` を外して `master` を追加して保存する(このワークフローは master からしか実行しないため、`develop` のままだと、dev job が Environment の制限で動かない)
   - 自分だけがレビュワーで、自分が実行する運用なら、**Prevent self-review は OFF** にする(ON のままだと、自分では承認できず動かない)
3. それぞれの Environment のシークレットとして登録する: 各 Environment のページ → **Environment secrets → Add environment secret** → 名前 `SITES_DISPATCH_TOKEN`、値に PAT を貼る(2 つの Environment に同じ値)。**repository secret(Settings → Secrets and variables → Actions)には置かない**
4. **kit の master を保護する(ruleset)**: 現状、kit の `master` にはブランチ保護が無い。保護が無いと、書き込み権限のある人が、`master` のワークフローを直接 push で書き換えて、Environment のシークレットを読める。**Settings → Rules → Rulesets → New ruleset → New branch ruleset** → Target branches に `master`(Default) → **Require a pull request before merging** を有効にして保存する。個人のリポジトリで書き込み権限者が自分だけなら、保護が無くても許容範囲だが、その場合は**アカウントの 2FA と、短い PAT の期限が前提**になる(個人リポジトリの無料プランでは、ruleset に自分を例外にできない・レビュー必須にできないなど限界がある)
5. **最初の試行(実機で確認する項目)**: まず `develop` だけをチェックして試す。サマリーの計画(飛ばしたサイト)と run の URL、そのサイトの dev の表示を確かめる。同時に次を確認する
   - `gh api user`(起動した人の特定)が、fine-grained PAT で通ること
   - `gh api repos/.../contents/...`(事前確認)・`gh run list` / `gh run watch` が、PAT の権限で通ること
   - Environment の承認画面(本番。`develop-maintenance` にレビュワーを付けたなら dev も)が出て、承認後に動くこと
   - `develop` ブランチ上から実行しようとすると、`validate` で止まること
   - 問題がなければ `master` もチェックして使う
   - 失敗例と対処(v0.3.2 の初回実行): 事前確認が `pokemon` と `bot` の「ワークフローが見つからない」(404)で飛ばされた → 原因は事前確認のパスが `.github/workflows/` を欠いていたバグ(v0.3.3 で修正。実在するファイルは見つかる)。`avatar` と `portfolio`(非公開)は事前確認が 403 になり dispatch に進み、avatar の develop が当時は旧ワークフロー(入力なし)で `HTTP 422: Unexpected inputs provided` となって中断された → v0.3.3 からは、422 は「飛ばす(警告)」になり、残りを続行する。403 が出るときは PAT に Contents: Read-only を付ける

### 安全性(kit は公開リポジトリ)

- トリガは `workflow_dispatch` だけ(issue・PR・コメント・push では動かない)。テストが、`on:` が `workflow_dispatch` だけであることを検査している
- fork からの PR では、リポジトリのシークレットは渡されない(そもそもこのワークフローは PR で動かない)。実行できるのは、kit のリポジトリに**書き込み権限のある人だけ**
- 実行元は `master` だけ。`validate` と、実行する job(`tools/maintenance-all.mjs`)の両方が `RUN_REF`(= `github.ref`)を検査する。`SITES_DISPATCH_TOKEN` は Environment のシークレットで、`dev` / `production` job の最後の step(gh を動かす step)の `GH_TOKEN` にだけ渡す。`validate` job には渡さない。Environment の Deployment branches が `master` だけなので、別ブランチのワークフローからは読めない。PAT は 4 リポジトリの Actions にしか効かないので、漏れても被害は限られる。画面・サマリーには出さない
- `production` job の Environment(`production-maintenance`)には必須レビュワーを付ける。承認しなければ、本番には何も起動されない。`dev` job の Environment(`develop-maintenance`)は、PAT を置くためのもので、レビュワーを付けるかは任意
- `actions/checkout` と `actions/setup-node` は GitHub 公式の action で、タグ指定(`@v4`)のまま使っている(ほかのワークフローと同じ。PAT は最後の step にしか渡さないので、これらの step からは見えない)
- 入力はシェルに埋め込まず、環境変数で渡して、`tools/maintenance-all.mjs` が検査する(チェックボックスは `true` / `false` だけ、`maintenance_mode` は 3 値、文面は 200 文字・制御文字なし)。`gh` には引数配列として渡す(シェルを通さない)。テストで、記号入りの文面・不正な入力を確かめている

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
          ALLOW_MISSING_WORKER: ${{ inputs.first_publish && '1' || '' }}   # 初回の公開だけ（Worker がまだ無いとき）。判定は `1` か `true`（大文字小文字を区別しない）

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
4. **ゲートが Worker の不在（404）をどう扱うか**を確かめる（`require-maintenance.mjs` の `run`）。まだ本番の Worker が無いサイト（例: pokemon）では、ゲートは Worker の不在（404）を失敗にする。初回の公開だけ、入力 `first_publish`（boolean）を true にして `ALLOW_MISSING_WORKER` を `1` または `true`（大文字小文字を区別しない。どちらも同じ意味）にして通す（下の「本番の初回」）。Worker 名の打ち違い・権限不足を、初回と取り違えないため
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
