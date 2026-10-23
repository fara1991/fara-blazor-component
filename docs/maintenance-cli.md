# メンテナンス表示の切り替え（Actions の画面 / 一括変更 CLI）

Worker の変数 `MAINTENANCE_MODE`（`true` / `notice` / `false`）と `MAINTENANCE_MESSAGE`（文面）を切り替える方法は 3 つ。**第一の手段は、GitHub Actions の「Run workflow」画面で入力して実行する方法**（スマホの GitHub アプリからも可）。Cloudflare のトークンも、手元の環境変数も要らない。4 サイトをまとめて切り替えたいときは、kit の Actions（3）か、手元の CLI（2。補助）を使う。

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

## 3. kit の Actions から 4 サイトまとめて切り替える

kit のリポジトリ(`fara1991/fara-site-kit`)の Actions →「**Set maintenance (all sites)**」→ Run workflow で、4 サイトに一度に反映する。手元の環境変数も CLI も要らない(スマホの GitHub アプリからも可)。中身は 2 の `set` を、Actions の上で動かしているだけ(`.github/workflows/set-maintenance-all.yml` → `tools/maintenance-all.mjs` → `tools/maintenance.mjs set --apply`)。

入力:

| 入力 | 値 |
| --- | --- |
| `target_branch` | `develop` = 各サイトの dev(確認用)、`master` = 各サイトの本番、`migration/wasm` = avatar の WASM 移行用の確認用(下の「avatar の WASM 移行用」) |
| `maintenance_mode` | 空 / `true` = 全体メンテナンス(503) / `notice` = お知らせ帯 / `false` = 通常。空 = 変更しない。**`master` では必須**(message だけの変更は `develop` だけ) |
| `maintenance_message` | 文面(200 文字まで・改行なし)。空 = 変更しない |
| `sites` | 既定 `all`。`pokemon,avatar,bot,portfolio` のカンマ区切りで絞れる |

動き:

1. `validate` job: 入力を検査する(シークレットは渡さない)。**実行 ref(kit のどのブランチのワークフローを使うか)と `target_branch` の組み合わせ**、`maintenance_mode` / `sites` が決まった値か、文面が 200 文字を超える・制御文字を含まないか、をここで確かめる(下の表)。通らなければ、後の job は動かない
2. `target_branch=develop`(または `migration/wasm`)なら `dev` job: Environment `develop-maintenance`(Deployment branches = `develop`)を使う。レビュワーを付けるかは任意(付けたなら、承認が済むまで動く)。各サイトの dev 用ワークフローを、そのリポジトリの `develop` で起動する
3. `target_branch=master` なら `production` job: GitHub の **Environment `production-maintenance`**(必須レビュワー = 自分)の**承認が済むまで動かない**。承認の画面(Review deployments)では、**入力値(`maintenance_mode` / `maintenance_message` / `sites`)と、対象の各サイトの master の最新のコード(公開される内容)を確認してから**承認する。承認後、各サイトの本番ワークフローを `master` で 1 サイトずつ起動し、結果を待つ。**そのサイトの master の最新のコードが `wrangler deploy` で公開される**ので、承認の前に確かめる
4. 起動した run の特定・失敗で中断・サマリーは `set` のとおり。ジョブサマリーに、各サイトの run の URL と結果が出る
5. `concurrency`(dev と本番で別の枠)で、同じ枠の job を同時に 2 つ動かさない。実行中のものは止めない。待てるのは 1 件だけで、さらに追加すると、古い待機は取り消される(最後に押したものだけが残る)

実行 ref と `target_branch` の関係(Use workflow from で選んだ kit のブランチと、サイト側のどのブランチに反映するか):

| Use workflow from(kit の ref) | `target_branch` に選べるもの | 備考 |
| --- | --- | --- |
| `master` | `develop` / `master` / `migration/wasm` のすべて | 本番(`master`)に反映できるのは、`master` から実行したときだけ |
| `develop` | `develop` / `migration/wasm` だけ。`master` は**拒否**(何も起動しない) | `develop-maintenance` の Deployment branches が `develop` のため、`develop` 上のワークフローから dev 系を実行できる |
| それ以外のブランチ・タグ | 拒否 | `validate` の最初の step で止まる |

- 検査は `validate` job と、実行する job(`tools/maintenance-all.mjs`)の両方で行う(環境変数 `RUN_REF` = `github.ref`)
- `production` job は、Environment `production-maintenance` の Deployment branches(`master` のみ)により、`master` 以外の ref からは起動できない
- `migration/wasm` は、サイト側(avatar)のブランチ。kit のブランチではないので、kit の `develop` か `master` から実行する(kit に `migration/wasm` ブランチは要らない。kit の別のブランチから実行したいときは、その Environment の Deployment branches に足し、`ALLOWED_TARGETS` にも足す)

### 注意点

1. **各サイトの対象ブランチに、入力 `maintenance_mode` / `maintenance_message` を受け取るワークフローが入っている必要がある**。入っていないサイトへの dispatch は失敗する(`Unexpected inputs provided`)。失敗時は、サイト名と「そのサイトの `<ref>` に新しい入力つきワークフローがまだ入っていない可能性。`--site` で除く」を出して**そこで中断**する(それ以降のサイトは起動しない)。特に `master` 側は、各サイトの develop → master のマージが済むまで、未対応のサイトが出る。`sites` で対応済みのサイトだけに絞って実行する
2. **pokemon の本番は未作成の間**、master のワークフローが旧版(入力なし)なので、この Actions からは作れない。初回は pokemon の develop → master のマージ(master への push)で作る。push の公開は `--var MAINTENANCE_MODE:true` を付けるので、メンテナンス画面のまま(非公開のまま)作られる。作ったあとの切り替えから、この Actions を使う
3. 各サイトの `develop` 側は、新しい入力つきのワークフローが先に入るので、dev から使える

### avatar の WASM 移行用の確認用(`fara-avatar-wasm-dev`、`migration/wasm`)

**方式: `target_branch` に `migration/wasm` を足し、`tools/maintenance-sites.json` の avatar に `wasm-dev` の環境として持たせた**(`workflows.wasm-dev` = `deploy.yml` / `migration/wasm`、`workers.wasm-dev` = `fara-avatar-wasm-dev`)。理由:

- ほかの対象と同じく「ブランチで反映先が決まる」ので、入力の形(`target_branch`)が変わらず、使い方が一貫する。別の job や別の入力を足すより、仕組みが増えない
- avatar だけの環境なので、`sites=all` のままでも、`migration/wasm` のときは avatar だけが対象になる(ほかのサイトは自動で飛ばす)。`sites` に avatar 以外を名指しすると、入力の誤りで止まる
- `--env all`(dev と production)には含めない。`--env wasm-dev` と明示したときだけ使うので、既存の dev / 本番の一括変更に影響しない
- 注意: Cloudflare 側の Worker `fara-avatar-wasm-dev` と、`migration/wasm` に入力つきの `deploy.yml` ができるまでは、`migration/wasm` を選ぶと失敗する(上の注意点 1 と同じ表示)

### 登録するもの(ユーザー向けの手順)

**トークンはチャットや issue に貼らない**。次の画面に直接入力する。

PAT は repository secret ではなく、**Environment のシークレット**に置く。理由: `workflow_dispatch` は「実行時に選んだ ref(ブランチ)」のワークフローを使う。repository secret にすると、書き込み権限のある人が別ブランチで書き換えたワークフローから、PAT を読めてしまう。Environment のシークレットは、Deployment branches を決めておけば、そのブランチのワークフローでしか使えない(`develop-maintenance` = `develop`、`production-maintenance` = `master`)。

1. fine-grained PAT を作る: GitHub → 右上のアイコン → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Resource owner: 自分(`fara1991`)
   - Repository access: **Only select repositories** → `fara-pokemon-battle-assistant`、`fara-avatar-modding-guide`、`fara-bot-moderator`、`fara-portfolio-site` の **4 つだけ**
   - Repository permissions: **Actions: Read and write**(Metadata: Read-only は自動で付く)。あわせて **Contents: Read-only を付けることを推奨**する。起動した run が各ブランチの先頭のコミットのものかまで照合でき、別の実行との取り違えを防げる(付けなくても動くが、その照合だけ飛ばす)
   - 有効期限(Expiration): 必ず付ける(短めにして、切れたら作り直す)
2. Environment を **2 つ**作る: **fara-site-kit → Settings → Environments → New environment**

   | Environment | Deployment branches and tags(Selected branches and tags) | Required reviewers |
   | --- | --- | --- |
   | `develop-maintenance` | `develop`(`migration/wasm` を kit の ref として使うなら、それも追加) | 任意。付けない運用でも、付ける運用(dev でも承認が要る)でも動く |
   | `production-maintenance` | `master` だけ | **必須**(自分を追加) |

   - 自分だけがレビュワーで、自分が実行する運用なら、**Prevent self-review は OFF** にする(ON のままだと、自分では承認できず動かない)
   - 注意: `develop-maintenance` の PAT は、`develop` 上のワークフローから使われる。`develop` に書き込める人は、ワークフローを書き換えれば、同じ PAT で各サイトの本番のワークフローを dispatch できてしまう(PAT は 4 リポジトリの Actions 全体に効くため)。ブランチごとの権限は付けられない。対策: `develop-maintenance` にも必須レビュワーを付ける(承認画面で、実行されるワークフローの内容を確認できる)、`develop` にも ruleset(PR 必須)を設定する、のどちらか(両方でもよい)。個人リポジトリで書き込み権限者が自分だけなら、許容範囲
3. それぞれの Environment のシークレットとして登録する: 各 Environment のページ → **Environment secrets → Add environment secret** → 名前 `SITES_DISPATCH_TOKEN`、値に PAT を貼る(2 つの Environment に同じ値)。**repository secret(Settings → Secrets and variables → Actions)には置かない**
4. **kit の master(できれば develop も)を保護する(ruleset)**: 現状、kit の `master` にはブランチ保護が無い。保護が無いと、書き込み権限のある人が、`master` のワークフローを直接 push で書き換えて、Environment のシークレットを読める。**Settings → Rules → Rulesets → New ruleset → New branch ruleset** → Target branches に `master`(Default)(`develop` も同様に設定するとよい) → **Require a pull request before merging** を有効にして保存する。個人のリポジトリで書き込み権限者が自分だけなら、保護が無くても許容範囲だが、その場合は**アカウントの 2FA と、短い PAT の期限が前提**になる(個人リポジトリの無料プランでは、ruleset に自分を例外にできない・レビュー必須にできないなど限界がある)
5. **最初の試行(実機で確認する項目)**: まず `target_branch=develop` で、`sites` を 1 サイトに絞って試す。サマリーの run の URL と、そのサイトの dev の表示を確かめる。同時に次を確認する
   - `gh api user`(起動した人の特定)が、fine-grained PAT で通ること
   - `gh run list` / `gh run watch` が、PAT の権限(Actions)で通ること
   - Environment の承認画面(本番。`develop-maintenance` にレビュワーを付けたなら dev も)が出て、承認後に動くこと
   - `develop` ブランチ上のワークフローから(Use workflow from: develop)、`target_branch=develop` が動き、`target_branch=master` が拒否されること
   - 問題がなければ `master` を使う

### 安全性(kit は公開リポジトリ)

- トリガは `workflow_dispatch` だけ(issue・PR・コメント・push では動かない)。テストが、`on:` が `workflow_dispatch` だけであることを検査している
- fork からの PR では、リポジトリのシークレットは渡されない(そもそもこのワークフローは PR で動かない)。実行できるのは、kit のリポジトリに**書き込み権限のある人だけ**
- `SITES_DISPATCH_TOKEN` は Environment のシークレットで、`dev` / `production` job の最後の step(gh を動かす step)の `GH_TOKEN` にだけ渡す。`validate` job には渡さない。各 Environment の Deployment branches(`develop-maintenance` = `develop`、`production-maintenance` = `master`)に合うブランチのワークフローからしか読めない。PAT は 4 リポジトリの Actions にしか効かないので、漏れても被害は限られる。画面・サマリーには出さない
- `production` job の Environment(`production-maintenance`)には必須レビュワーを付ける。承認しなければ、本番には何も起動されない。`dev` job の Environment(`develop-maintenance`)は、PAT を置くためのもので、レビュワーを付けるかは任意
- `actions/checkout` と `actions/setup-node` は GitHub 公式の action で、タグ指定(`@v4`)のまま使っている(ほかのワークフローと同じ。PAT は最後の step にしか渡さないので、これらの step からは見えない)
- 入力はシェルに埋め込まず、環境変数で渡して、`tools/maintenance-all.mjs` が検査する(`sites` は 4 サイトの名前だけ、`maintenance_mode` は 3 値、文面は 200 文字・制御文字なし)。`gh` には引数配列として渡す(シェルを通さない)。テストで、記号入りの文面・不正な `sites` を確かめている

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
