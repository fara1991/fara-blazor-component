# 変更履歴（バージョン）

kit は SemVer のタグ（`vX.Y.Z`）で切る。各サイトは、タグのコミットに固定して使う。破壊的変更（API・名前空間・ファイル名）はメジャーを上げる。

## 0.5.1

2026-10-28。
0.5.0 の 2 回目のレビュー指摘の修正。公開 API（部品のパラメータ・CSS のクラス名・Worker の入出力）は変えない。**挙動が変わる点**: (1) スマホ（768px 未満）のメニューが Esc で閉じ、フォーカスがメニューボタンに戻る。(2) 報告フォームの送信ボタンと入力欄が、600px 未満で 44px になる（見た目の幅・色は同じ）。(3) `worker/text.js` を足した（`worker/report.js`・`worker/maintenance.js` が使う）。submodule で `worker/*.js` を import しているサイトは、上げるだけでよい。ファイルを**コピーして**持っているサイトは、`worker/text.js` も一緒に入れる。

- レイアウト（レビュー指摘）: 報告フォームの送信ボタン（`.fsk-report-submit`）と入力欄（`.fsk-select input`・`.fsk-field input`・`#report-category`・`#report-contact`）を、600px 未満で高さ 44px にした。フッターの文字リンク・本文中の小さなリンク（`.fsk-small a`）の当たり判定を、1024px 以下で 44px 近くに広げた（padding と負の margin。見た目の大きさは変えない）。SNS アイコンは、当たり判定（44px）が隣と重ならないよう、1024px 以下で間隔を 22px にした。
- Esc（レビュー指摘）: スマホのメニューが開いているとき、Esc で閉じ、フォーカスをメニューボタン（`.fsk-menu-toggle`）に戻す（`SiteLayout.OnEscape`。JS の `watchMobile` が文書の keydown を知らせる）。MudDrawer は Esc で閉じないため、kit が閉じる。
- JS・Razor（レビュー指摘）: `faraSiteKit.watchMobile(ref, key)` は、登録の名前（key）を受け取る（戻り値は今の幅のまま）。`faraSiteKit.unwatchMobile(key)` を足した。`SiteLayout` は Dispose で外す（外さないと、画面を移るたびに古い参照へ送り続けて警告が増えていた）。`ReportFormView` の題名の見出しは 1 か所（`TitleHeading`）にまとめた（見た目・レベルは変えない）。
- Worker（レビュー指摘）: 対になっていないサロゲートを取る文字列の整えを `worker/text.js`（`cleanText`）に 1 か所にまとめた。`report.js` の `clean` はそのまま（`cleanText` の別名で export）。`maintenance.js` の文は同じ規則。`worker/text.test.mjs` が両方を同じ入力で確かめる。
- ツール（レビュー指摘）: `tools/maintenance.mjs` の `dispatchInputNames` は、`run: |` などのブロックスカラーと、複数行の文字列の続き行を、キーとして数えない。リストの項目（`- run: ...`）の桁も数える。依存は増やしていない。
- docs: `ALLOW_MISSING_WORKER` の判定は `1` か `true`（大文字小文字を区別しない）と統一して書いた（各サイトの `require-maintenance.mjs` の判定が違う場合は、サイト側を合わせる。album は `1` のみ）。
- テスト: スマホの入力・送信ボタンの高さ、1024px 以下の当たり判定、Esc（JS・bUnit）、unwatch の登録と解除、`dispatchInputNames` のブロックスカラー・複数行・インデントの違い、`worker/text.test.mjs`、docs の表記。

## 0.5.0

2026-10-28。レビュー指摘の修正。**挙動が変わる点**: (1) `ReportFormView` の題名が h1 になった（従来は h3。サイトが既にページの h1 を持つ場合は `HeadingLevel="2"` 以上を指定する）。(2) `worker/report.js` の最小文字数の判定が、絵文字を 1 文字として数えるようになった（クライアントの数え方と同じ）。(3) `worker/maintenance.js` のメッセージの除去規則が `report.js` と同じになった。各サイトの `worker/` のコピーも同じ内容に揃える。


- レビュー指摘（Worker・ツール・CI・ビルド）: `worker/maintenance.js` のメンテナンスの文を、報告（`report.js`）と同じ規則で整えた（対になっていないサロゲートを取る。以前は取らなかった）。`worker/report.js` の本文の最小の長さを文字（コードポイント）で数えた（絵文字 3 個は、画面と同じく拒否する。以前は UTF-16 の長さで通していた。**挙動の変更**）。`tools/maintenance.mjs` の事前確認は、ワークフローを YAML として読み、`on.workflow_dispatch.inputs` のキーを確かめる（`run` の中の文字列では「入力がある」と判定しない）。`MODES` を `tools/maintenance.mjs` の 1 か所に（`maintenance-all.mjs` は import）。マジックナンバーを名前つきの定数に（API の待ち時間・実行の探し方・報告の待ち時間・ページのパターン）。`build/build-pages.mjs` の `#app` を閉じる `</div>` は、入れ子の div を数えて求める（最初の `</div>` で外と判定して、正しい入れ子の中の SEO-BODY を断っていた）。`require-maintenance` の 404（Worker が無い）は、既定で失敗にする扱いを docs に明記（初回の公開だけ `first_publish` と `ALLOW_MISSING_WORKER=1`。各サイトの `require-maintenance.mjs` の直し）。`set-maintenance-all.yml` は既に top-level で `permissions: contents: read` を明示していた（変更なし）。
- 例外の処理（レビュー指摘）: 空の `catch` を、JS の失敗（`JSException`・`JSDisconnectedException`）だけを受ける形に絞った（`SiteLayout`・`SiteThemeState`・`ReportFormView`）。`ReportFormView` は、確認の待ち合わせ（`waitToken`）が失敗したとき「確認が終わっていません」ではなく、確認の部品を読み込めなかったことを案内する。JS の `fara-site-kit.js`・`theme-init.js` は、捨てる例外に console.warn を出す。`OnLocationChanged` は例外を外に出さない。`OnMobileChanged` の Promise の拒否を受ける（回線が切れた後に未処理の拒否を残さない）。`scroll-progress.js` は、外側の候補の一覧を、画面の大きさ・DOM が変わったときだけ作り直す（スクロールのたびに作らない。挙動は同じ）。
- アクセシビリティ（レビュー指摘）: 問い合わせの題名（`ReportFormView`）の見出しを **h1** にした（従来は h3。見た目は同じ）。サイトが既に h1 を持つときは新しいパラメータ `HeadingLevel`（2〜6。既定 1）で下げられる。キーボードのフォーカス枠を、ヘッダーのボタン・ブランド・「本文へ移動」で出るようにした（MudBlazor の reset に負けていた。色は `--fsk-focus`）。スマホ（600px 未満）のタップの大きさを 44px にした（☰・ブランド・テーマのスイッチ・フッターのリンク。見た目の高さは変えず、余白で当たり判定を広げる）。欄の補助の文字（`small.fsk-muted`）を 12px 以上にした。
- `tools/maintenance-sites.json` から album を外し、一括変更の対象を 4 サイト（pokemon・avatar・bot・portfolio）に戻した。fara-vrc-photo-album は、リポジトリをパブリックにするため（2026-10-28）サイトの公開を GitHub Actions では行わなくなり、起動するワークフロー（deploy-develop.yml）が無くなったため。tests・docs・set-maintenance-all.yml の「5 サイト」も 4 に直した。

## 0.4.0

2026-10-25。追加の API のみ（破壊的変更なし）。既存のサイトは、submodule をこのタグに上げるだけで、動作は変わらない。

- 要約: 報告フォーム（`ReportFormView` / `ReportForm`）の**連絡先を必須にするオプション**（`ContactRequired`）と、**X のユーザー名（@○○）の形の検査**（`ContactFormat = XHandle`）、見出し・説明・例の差し替え（`ContactLabel`・`ContactHint`・`ContactPlaceholder`）を追加。既定は従来どおり任意。fara-vrc-photo-album の `/report` で使う。
- そのほか: `docs/new-site-checklist.md` の追加、`tools/maintenance-sites.json` への album（develop）の追加。

詳細:

- 報告フォームの連絡先を、サイトごとに**必須**にできるようにした（既定は従来どおり任意・自由な文字列で、既存のサイトの動作は変わらない）。`ReportFormView` に `ContactRequired`・`ContactFormat`・`ContactLabel`・`ContactPlaceholder` を追加し、`ContactHint` は未指定（null）のとき必須か任意かに合わせた既定の文を出す（文字列で渡していたサイトはそのまま動く）。`ReportForm`（Core）に `ContactRequired`・`ContactFormat`（`ReportContactFormat.Any` / `XHandle`）・`ContactName`・`IsXHandle`（`@` + 英数字とアンダースコア 1〜15 文字）を追加し、`Validate` が検査する。必須のとき、連絡先の入力欄に `aria-required="true"` を付ける（支援技術の読み上げ。`MudTextField.Required` は英語の「Required」が出るので使わない）。Worker は変更なし（検査は画面側だけ）。テスト（Core・Razor）・docs/usage.md を追加。想定する使い方: fara-vrc-photo-album の `/report`（X のユーザー名を必須）。
- `docs/new-site-checklist.md` を追加（新しいサイトを立ち上げる手順。fara-vrc-photo-album の M0 で実際に踏んだ順序と、落とし穴）。コードの変更なし。
- `tools/maintenance-sites.json` に album（`fara1991/fara-vrc-photo-album`）を追加し、一括変更の対象を 5 サイトにした。**album は develop（確認用。deploy.yml・Worker `fara-vrc-album-dev`）だけ**を載せる: 本番は初回公開がメンテナンス画面（`MAINTENANCE_MODE=true`）のままなので、本番を含む一括切替（`notice` / `false`）が、意図せず公開してしまうのを防ぐ。**公開準備ができたら**、`workflows.production`（`deploy.yml`・`master`）と `workers.production`（`fara-vrc-album`）を足す（docs/maintenance-cli.md）。マージは album の deploy.yml が develop に入ってから（無いブランチは事前確認で警告つきで飛ばされる）。`SITES_DISPATCH_TOKEN` の PAT の対象リポジトリにも追加が要る。テストの期待値（サイト数・dispatch 数）、docs・コメントを更新。

## 0.3.5

報告フォーム(`worker/report.js`・`ReportForm`・`report.js`)のレビュー指摘の修正。各サイトは submodule をこのタグに上げて取り込む。

- `worker/report.js`(**挙動の変更**):
  - Turnstile の siteverify が 2xx 以外、結果を読めない(JSON でない・形が違う)、または `error-codes` に `invalid-input-secret` / `missing-input-secret` / `internal-error` があるときは、利用者の失敗(400)ではなく **503**(`verify_unavailable`)にして、サーバー側のログ(`console.error`。状態コードと error-codes だけ。シークレット・Webhook の URL は出さない)に残す。トークンの不正・期限切れ(`timeout-or-duplicate`・`invalid-input-response` など)は従来どおり 400。通信できない・時間切れは従来どおり 502(ログにも残す)。以前は siteverify の 5xx を 502、4xx を 400 にしていた。
  - 本文は、読みながらバイト数を数え、**32 KB** を超えたらそこで読むのをやめて 413(Content-Length が無い・うそでも全部は読まない。宣言が超えていれば読む前に断る)。以前は文字数 8192 の上限で、`\uXXXX` に直す送り手(旧 `ReportForm.ToJson`)では日本語が約 1300 文字で弾かれていた。32 KB は、`\uXXXX` の最悪値(メッセージ 2000 文字×12 + 連絡先 200 文字×12 + トークン 2048 + ページ 300 + 余白 ≒ 29 KB)が通る大きさ。文字数の別の上限(`MAX_BODY_CHARS`)は廃止。
  - Discord への送信の失敗(非 2xx・例外)も、状態コード(例外は名前)だけを `console.error` に残す(Webhook の URL・本文・連絡先は出さない)。応答は従来どおり 502。
  - Turnstile の結果の `hostname` が無い(文字列でない)ときも、400(`turnstile_failed`)。以前は確かめずに通していた。**各サイトの確認**: Turnstile のテスト用キー(ローカル)は本番のホスト名と違う `hostname` を返すことがある。ローカルで試すときは注意。
  - ファイル先頭の「3 つのリポジトリに同じファイル」の記述を、kit の共有ファイルである旨に直した。
- `ReportForm.ToJson`: `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` で作る(日本語を `\uXXXX` にしない。2000 文字が約 6 KB)。JSON は `application/json` の本文としてだけ使い HTML には埋め込まないので安全。引用符・バックスラッシュ・制御文字は従来どおり escape される。絵文字は escape されることがある(最悪でも 32 KB 以内)。
- `ReportForm.DescribeFailure`: Worker が返さない 429 専用の文を削除(429 は既定の文になる)。
- `report.js`(クライアント): CSP のコメントを実態に合わせた(script-src だけでなく frame-src・connect-src も必要。`presets.turnstile`)。
- 報告フォームの色の直書き: kit の CSS には無く(トークンのみ)、変更なし。
- テスト: `worker/report.test.mjs`(siteverify の非 2xx・読めない・秘密の不正→503 とログ、トークン不正→400、ストリームでの 413、hostname 無し→400、Discord 失敗のログに秘密が出ない、トークンを 2048 文字で切る、`\uXXXX` 形式の最悪値(日本語 2000+連絡先 200+トークン 2048、絵文字 2000 個)が通る、32 KB ちょうど・+1 バイトの境界)、`ReportFormTests`(429、`ToJson` の escape と読み戻し)。

## 0.3.4

avatar の WASM 移行(Phase 5)が develop に統合され、確認用 Worker `fara-avatar-wasm-dev` と avatar の `deploy-wasm-dev.yml`・wrangler の `env.wasm-dev` が廃止されたことに合わせた整理。

- kit の Actions「Set maintenance (all sites)」の入力 `migration_wasm`(boolean)を廃止。入力は `develop` / `master` / `maintenance_mode` / `maintenance_message` になる。
- `tools/maintenance.mjs` / `tools/maintenance-all.mjs` / `tools/maintenance-sites.json` から `wasm-dev` 環境(avatar の `deploy.yml` / `migration/wasm` / `fara-avatar-wasm-dev`)を削除。`--env` は dev・production・all。
- avatar の dev(develop の `deploy.yml`)には入力つきの版が入ったので、事前確認で飛ばされず反映される。docs の「avatar の dev は未対応で飛ばされる」旨の記述を直した。
- テスト・docs(maintenance-cli.md・README・CLAUDE.md)を更新。

## 0.3.3

v0.3.2 の初回実行で見つかった不具合の修正。

- 事前確認のパスのバグ: ワークフローのファイルを `repos/{repo}/contents/{file}` と**ファイル名だけ**で GET していたため、実在するファイルが 404(見つからない)になり、pokemon と bot が誤って飛ばされた。`.github/workflows/{file}` に修正。テストの gh のモックが、呼ばれる URL に `.github/workflows/` が含まれることを検査するようにした(以前はモックが通ってしまい検出できなかった)。
- 事前確認できない場合(PAT に Contents: Read が無い 403)に dispatch して返る **HTTP 422 `Unexpected inputs provided`**(そのサイトのその ref のワークフローが入力を受け取れない版)は、失敗で中断せず、**警告つきで飛ばして続行**する(サマリーに明記。dev でも本番でも同じ)。422 以外のエラー(認証・ワークフロー不在・その他)は従来どおり失敗で中断。すべて飛ばされたら失敗(`maintenance-all` の dev の段階では、あとで本番が実行できるなら失敗にしない)。
- docs: Contents: Read-only が必要なリポジトリ(非公開の avatar と portfolio)、403 のときは 422 で判定して飛ばす動作、最初の試行に今回の失敗例と対処を追記。

## 0.3.2

kit の Actions「Set maintenance (all sites)」の入力を変更(0.3.1 の入力 `target_branch` / `sites` は廃止)。

- 入力を、反映先ブランチのチェックボックス(boolean)に変更: `develop`(各サイトの dev。既定 ON)、`master`(各サイトの本番。既定 OFF)、`migration_wasm`(avatar の wasm-dev。既定 OFF)。サイトは常に 4 つすべて(`migration_wasm` は avatar のみ)。複数チェックできる。`maintenance_mode`・`maintenance_message` は変更なし(本番は mode 必須)。1 つも選ばなければ拒否。順序は dev 系(develop → migration_wasm)を先に全部、全成功後に本番(master)を 1 サイトずつ。
- 実行元(Use workflow from)は **master のみ**に単純化(`validate` が `github.ref` を検査。develop 上からは実行できない)。Environment `develop-maintenance` と `production-maintenance` は、**どちらも Deployment branches を master のみ**にする(`develop-maintenance` を develop にしていた場合は master に変更する。手順は `docs/maintenance-cli.md` の 3)。
- 事前確認(計画): 対象ブランチのワークフローが入力 `maintenance_mode` を受け取れる版かを、`GET /repos/{repo}/contents/{file}?ref={branch}` で見て、受け取れないサイト(入力が無い・ファイルが無い)は dispatch せず警告つきで飛ばす。飛ばしたサイトと理由は、本番の承認画面より前(dev job の計画)にジョブサマリーに出る。選んだ対象がすべて飛ばされたら失敗。PAT に Contents: Read が無く確かめられないときは、従来どおり dispatch して失敗時に案内する。
- CLI: `set` に `--plan`(事前確認だけして計画を表示)と `--allow-empty`、事前確認を追加。`--site` / `--env` は CLI 用に残す。

## 0.3.1

追加のみ(破壊的変更なし)。

- kit の Actions「Set maintenance (all sites)」(`.github/workflows/set-maintenance-all.yml`、`workflow_dispatch` のみ)を追加。入力 `target_branch`(develop = 各サイトの dev / master = 各サイトの本番 / migration/wasm = avatar の確認用)・`maintenance_mode`・`maintenance_message`・`sites` で、4 サイトの deploy ワークフローをまとめて起動する(`tools/maintenance-all.mjs` → `tools/maintenance.mjs set`)。Environment を 2 つ(`develop-maintenance` は Deployment branches = develop でレビュワーは任意、`production-maintenance` は Deployment branches = master で必須レビュワー。実行 ref と target_branch の組み合わせ(master の ref はすべて可、develop の ref は develop / migration/wasm だけ)を検査する)使い、`SITES_DISPATCH_TOKEN`(4 リポジトリ限定の fine-grained PAT)は Environment のシークレットとして置いて、各 job の最後の step にだけ渡す。登録手順と注意点は `docs/maintenance-cli.md` の 3。
- CLI: 環境 `wasm-dev`(avatar の `fara-avatar-wasm-dev`、`migration/wasm`。`--env all` には含めず明示したときだけ)。全サイト対象のとき、その環境のワークフローが無いサイトは飛ばす(名指ししたときは誤り)。入力を受け取らない版のワークフローに dispatch して失敗したときは、サイト名と対処(`--site` で除く)を出す。コミットを読む権限が無いときは、起動 run の `headSha` 照合だけ飛ばす。

## 0.3.0

**破壊的変更**: Worker の変数名 `MAINTENANCE` を **`MAINTENANCE_MODE`** に変更した。値（`true` / `notice` / `false`）と挙動（true = 全体 503 のメンテナンス画面、notice = お知らせ帯、false = 通常）は同じ。`MAINTENANCE_MESSAGE` は変えない。**旧名 `MAINTENANCE` は読まない**（フォールバックなし）。旧名だけが設定されている Worker は、通常動作になる（メンテナンス画面もお知らせも出ない）。

- `worker/maintenance.js`: `getMaintenance(env)` が `env.MAINTENANCE_MODE` を読む。旧名だけの設定は通常（テストで固定）。
- コメント・説明文（`MaintenanceInfo`・`MaintenanceBanner`・`MaintenanceScreen`・CSS）の変数名を更新。C# の公開 API・Worker の `/api/maintenance` の JSON の形は変わらない。
- 追加: メンテナンス表示の切り替え。**第一の手段は、各サイトの Actions の「Run workflow」画面（スマホの GitHub アプリも可）で `maintenance_mode` / `maintenance_message` を入力して実行する方法**（Cloudflare のトークンも手元の環境変数も不要）。ワークフローの雛形（入力・`--var` の渡し方・実行後に「設定した値」と「反映後の現在値」をジョブサマリーに出すステップ）は `docs/maintenance-cli.md`。
- 追加（補助）: 4 サイトをまとめたいとき用の CLI `tools/maintenance.mjs`（Node・依存なし）と対象の一覧 `tools/maintenance-sites.json`。`status`（Cloudflare API の GET だけで、現在値の一覧）と `set`（各サイトの deploy ワークフローを `gh workflow run` で手動実行し、入力 `maintenance_mode` / `maintenance_message` を `wrangler deploy --var` で反映）。Cloudflare API への書き込みはしない。既定はドライラン、`--apply` で実行、dev を先に流して成功したら production（本番は `--confirm` にサイト名の再入力が必須。1 つでも失敗したら中断）。使い方とワークフローの雛形は `docs/maintenance-cli.md`。テスト `tests/tools/maintenance-cli.test.mjs`（gh と fetch を差し替え）。
- `docs/usage.md` に 2.1「メンテナンスの変数」を追加。

### 各サイトの移行手順（kit を 0.3.0 に上げるとき）

旧変数 `MAINTENANCE` は新しいコードが読まないので、Cloudflare に残っていても無害（消すのは任意）。新しい変数 `MAINTENANCE_MODE` は、サイトの公開（`wrangler deploy --var MAINTENANCE_MODE:...`）で設定する。

1. サイトの kit（submodule）を `v0.3.0` に上げる。
2. サイトの `require-maintenance.mjs`（本番公開前のゲート）が読む変数名を `MAINTENANCE_MODE` にする（`readMaintenanceValue` の `b.name === "MAINTENANCE_MODE"`。メッセージ・テストも合わせる。`SKIP_MAINTENANCE_CHECK` は変えない）。
3. deploy ワークフローの `--var MAINTENANCE:...` を `--var MAINTENANCE_MODE:...` に変え、`workflow_dispatch` の入力 `maintenance_mode` / `maintenance_message` を足す（雛形は `docs/maintenance-cli.md`）。ワークフローの文字列を調べるテストも合わせる。
4. サイトの README・docs・テスト・コメントの `MAINTENANCE`（変数名としての参照）を `MAINTENANCE_MODE` に直す。`MAINTENANCE_MESSAGE` は直さない。
5. 確認用（dev）: develop に入れて公開されたら、Actions の「Run workflow」（`develop`）で `maintenance_mode` に `notice` などを入れて実行する（または `node tools/maintenance.mjs set --env dev --mode notice --message "..." --apply`）。ジョブサマリーで値を確かめ、`notice` / `true` / `false` の表示を確認する。
6. 本番: ゲートが新名 `MAINTENANCE_MODE` を読むので、本番の Worker に `MAINTENANCE_MODE` が無い間は、通常の公開（push）がゲートで止まる。**お知らせ（`notice`）を先に出す運用は、お知らせの時点でも `wrangler deploy` が master の最新のコードを公開する**ので、本番ではお知らせを出さず、**公開と同時に `true`（メンテナンス画面）で非公開のまま作る**ことを第一にする。
   - Worker が未作成のサイト（pokemon）: 初回は `node tools/maintenance.mjs set --env production --site pokemon --mode true --apply --confirm "production pokemon"`。mode を指定した手動実行はゲートを飛ばし、`--var MAINTENANCE_MODE:true` を付けて公開する。`skip_maintenance_check` だけでは `--var` が付かず変数は作られない。公開してよくなったら `set ... --mode false`。
   - すでに公開済みのサイト: 通常の公開（push）は従来どおり `--var MAINTENANCE_MODE:true` を付けるが、ゲートが `notice` を要求する。`MAINTENANCE_MODE` が無い間は、初回だけ `set --env production --site <名前> --mode notice --apply`（これは master の最新を公開する点に注意）か、ダッシュボードで `MAINTENANCE_MODE=notice` を作ってから公開する。
   - ゲートが Worker の不在（404）をどう扱うかは、各サイトの適用時に確認する（`docs/maintenance-cli.md` の適用手順 4）。
7. 旧変数 `MAINTENANCE` は、不要ならダッシュボードで手動で削除する（CLI は消さない）。

## 0.2.1

pokemon の PR-2（kit 採用）で見つかった課題の修正。既存のパラメータ・クラス名は変えない（追加のみ。1 件だけ、下の Worker のお知らせの class 名に注意）。

- `fara-site-kit.css`: `ReportFormView` が使うのに定義が無かった `fsk-mb-0`・`fsk-mb-1`・`fsk-mb-3`・`fsk-mt-3`・`fsk-small`・`fsk-muted`・`fsk-form-group`・`fsk-form-label` と、`fsk-card`・`fsk-card-body` の構造（flex の縦並び・内側の余白）を追加。色は kit のトークン（`--fsk-muted`・`--fsk-border`）。`--fsk-card-spacer`（既定 1rem）で余白を替えられる。サイトが app.css で補う必要はなくなる。
- `SiteLayout`: `MobilePageScroll` パラメータを追加（既定 false = 従来どおり、スマホでもページ全体を画面の高さに固定）。true にすると、スマホ（767.98px 以下）でページ全体がスクロールする（クラス `fsk-page-scroll`）。
- `worker/maintenance.js`: `noticeHtml` の class を `maintenance-notice*` から `fsk-notice`・`fsk-notice-title`・`fsk-notice-text` に変更（Razor の `MaintenanceBanner` と同じ）。**名前の変更**: 旧い class の CSS を自分で書いているサイトは、`fsk-notice*` に読み替える（kit の CSS を読めば、そのまま見た目が付く）。
- `boot-indicator.js`: メンテナンス画面（`.fsk-maintenance`。`.mud-layout` が無い）が描かれたら、読み込み表示を外す（以前は 60 秒のタイムアウトまで残った）。
- `docs/usage.md`: 8.12「導入手順（小規模サイト向け）」を追加。`MobilePageScroll` の説明。
- JS のテストを追加（PR #8）: `tests/js/boot-indicator.test.mjs`（45 秒・60 秒のタイマー、inert の戻し、blazor.webassembly.js の読み込み失敗、MutationObserver が無いとき、メンテナンス画面での解除）・`tests/js/scroll-progress.test.mjs`。pokemon の tests/js（e68d150）から移植。
- テスト: `MobilePageScroll` のクラス、追加した CSS の定義、worker の class 名、読み込み表示の解除。

## 0.2.0 まで

- K0: 骨格（`worker/`: `maintenance.js`・`report.js` とテスト、CI、利用方法）。pokemon の develop 時点と同一内容を取り込み。
- K0-2: C#（`src/FaraSiteKit.Core`、net8.0）: `SiteLinks`（`DevelopHost` を追加し、サイト固有のホスト名を持たせない）・`MaintenanceInfo`・`ReportForm`。pokemon の同名クラスから移動（名前空間は `FaraSiteKit.Core` に統一。移す前は `FaraPokemonBattleAssistant.*`）。テスト `tests/FaraSiteKit.Core.Tests`（69 件）。CI に `dotnet test` を追加。
- CI: ubuntu と windows の matrix（`test`・`dotnet` の両ジョブ）。ジョブ名が `test (ubuntu-latest)` のように変わる（ブランチ保護の必須チェック名を合わせる）。
- .NET 10 へ移行: C#（`src/FaraSiteKit.Core`・テスト）を net10.0 に、`global.json` を SDK 10.0.100（latestFeature）に。.NET 8 のサイトからは参照できなくなる（破壊的変更）。
- K0-4 / K0-5: Razor 部品（`src/FaraSiteKit.Razor`、net10.0、MudBlazor 9.11.0）: `SiteLayout`（ヘッダー・サイドバー・検索の欄・スキップリンク・フッターの固定）・`MudProviders`・`ThemeSwitch`（テーマの保存は `SiteThemeState`、描画の前の反映は `theme-init.js`）・`SiteNavMenu`（`SiteNavItem`・`SiteNavGroup`）・`SiteFooter`・`SocialLinks`（URL はサイト設定。空は出さない）・`MaintenanceBanner`・`MaintenanceScreen`・`ReportFormView`（タイムアウトを通信エラーとして案内）・`NotFoundView`・`ScrollProgress`。静的ファイル（`wwwroot/`）は `_content/FaraSiteKit.Razor/...`。`SiteOptions`（Core）と `AddFaraSiteKit`。
- Razor のテスト `tests/FaraSiteKit.Razor.Tests`（bUnit 2.12.5。108 件）と、最小のサイト `samples/MinimalSite`（CI のビルド）。
- 利用方法: `docs/usage.md` の 6（Razor の部品）、`docs/index-template.html`（index.html の断片）。
- CI: dotnet ジョブに Razor のテストと、サンプルのビルドを追加（ジョブ名は変えない）。
- 注意: `SocialLinks`・`SiteFooter` の名前は、pokemon の同名の型と衝突する（取り込み時は、pokemon 側の名前を外してから using する）。

- K0-3: `build/build-pages.mjs`（pokemon の `tools/build-entry-pages.mjs` を一般化。本文は呼び出し側が作る）と `csp/render-headers.mjs`（`_headers` の生成。テンプレート `csp/_headers.template`）。テスト `tests/build`・`tests/csp`（pokemon の出力とバイト単位で一致することを含む）。
- PR #7 の独立レビューの対応（未リリース。kit の API と CSS 名の変更は、まだ利用していないサイトが対象）:
  - 報告の文字数を、コードポイント単位に変更（worker/report.js と同じ。絵文字は 1 文字）。`ReportForm.CountCharacters` を追加。**挙動の変更**: UTF-16 の長さで数えていた既存の入力（絵文字を含む）の判定が変わる。
  - `MaintenanceScreen.Lead` は文字として出す（HTML は出さない。改行だけが改行）。**挙動の変更**: HTML の `<br />` を入れていた呼び出しは、改行（`
`）に直す。
  - `SocialLinks` は https:// の URL だけを出す（javascript:・data:・http: は描かない）。
  - `SiteLayout`: `ShowDrawer`・`TopNav`・`CollapseTopNavOnMobile`（上部ナビだけの構成）。Esc で検索の欄を閉じる。ページの移動で本文へフォーカス。起動の後に、theme-init.js のキーと SiteOptions の食い違いを警告（`faraSiteKit.checkConfig`）。フッターは `<footer>`（contentinfo）として本文の外に置き、全幅で固定。
  - `SiteFooter`: 作者のホームページのリンクは、実行中のホスト名で確認用に切り替える（`SiteLinks.CurrentHost` を手で入れない）。
  - `NotFoundView`・長文のページ幅（`fsk-page-column--wide`）。
  - クラス名を `fsk-` の接頭辞に統一（`content`・`page-column`・`card`・`nowrap` など。移行の表は docs/usage.md の 8.9）。**名前の変更**: 旧い名前を使っているサイトは、CSS を読み替える。
  - 100vh の後に 100dvh を書く（iOS の高さ）。フッターの高さは CSS（flex）だけで決める（`--footer-height` と JS の計測は廃止）。
  - `csp/render-headers.mjs` に `presets`（Turnstile・Google Fonts）。
  - テスト: Razor 133 件・Core 73 件・npm 126 件（JS の `tests/js/kit-js.test.mjs` を含む）。
  - 保存のキーの既定（`fara-site-kit.*`）は変えない。移行の手順は docs/usage.md の 8.6。
