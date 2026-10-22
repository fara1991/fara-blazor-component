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

## 3. 確認

- サイトの `wrangler deploy --dry-run`（本番と確認用の両方）
- サイトの Worker のテスト（`/api/report`・`/api/maintenance` の挙動）
- 確認用サイトで表示を確かめてから、本番へ（サイトの運用どおり）

## 4. サブモジュールを上げる（kit の変更を取り込む）

1. kit で変更を PR → develop にマージ → タグ（`vX.Y.Z`）
2. 各サイトで、サブモジュールをそのタグのコミットに上げる PR（develop 向け）
   - `cd external/fara-site-kit && git fetch --tags && git checkout vX.Y.Z && cd ../.. && git add external/fara-site-kit`
3. 確認用サイトで確認 → master への反映はユーザーが判断
