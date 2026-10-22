pokemon（fara1991/fara-pokemon-battle-assistant）の develop 時点（コミット d3ef26e）のファイルのコピー。
テストの入力・比較の基準として使う（build/build-pages.mjs が pokemon の出力と同じになるかの確認。tests/build/pokemon-equivalence.test.mjs）。
- build-entry-pages.mjs: pokemon の tools/build-entry-pages.mjs（比較の基準を作る。run() と buildBody() を使う）
- entry-pages.json: pokemon の tools/entry-pages.json（入口ページの文言）
- index.html: pokemon の src/FaraPokemonBattleAssistant.Web/wwwroot/index.html（テンプレート）
- _headers.pokemon: pokemon の src/FaraPokemonBattleAssistant.Web/wwwroot/_headers（CSP の基準）
