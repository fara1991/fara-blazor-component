// 描画の前に、保存されたテーマ（ライト／ダーク）と、PC のサイドバーの隠す設定を html に反映する。
// index.html の head で、読み込みを待たせずに（defer も async もなしで）読む。インラインの script は CSP で使えないので、外部ファイルにしている。
// キーは、この script タグの data-storage-key（SiteOptions.StorageKey）と data-sidebar-key（SiteOptions.SidebarKey）から読む。
// 形式は SiteThemeState（C#）と同じ: テーマは JSON のプロパティ "Theme"（大文字小文字を問わない）に "light" か "dark"。
(function () {
    "use strict";
    var script = document.currentScript;
    var storageKey = script && script.dataset.storageKey;
    var sidebarKey = script && script.dataset.sidebarKey;
    var root = document.documentElement;

    // テーマ（data-bs-theme）。読めない・無いときは light
    try {
        var theme = "light";
        var json = storageKey ? localStorage.getItem(storageKey) : null;
        if (json) {
            var saved = JSON.parse(json);
            Object.keys(saved || {}).forEach(function (key) {
                if (key.toLowerCase() === "theme" && saved[key] === "dark") theme = "dark";
            });
        }
        root.setAttribute("data-bs-theme", theme);
    } catch (e) {
        root.setAttribute("data-bs-theme", "light");
    }

    // PC のサイドバーを隠しているとき（"1"）は、描画の前に html のクラスを付ける（開いたときのちらつきを防ぐ。切り替えは SiteLayout）
    try {
        if (sidebarKey && localStorage.getItem(sidebarKey) === "1") root.classList.add("fsk-sidebar-hidden");
    } catch (e) { }
})();
