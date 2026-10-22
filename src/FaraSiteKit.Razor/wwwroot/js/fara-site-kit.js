// Fara のサイト共通の振る舞い（SiteLayout.razor が使う）。名前は window.faraSiteKit の下にまとめる（サイトの他の JS と重ならないように）。
// - watchMobile(ref): 768px 未満（スマホ）かどうかを返し、変わったら ref.OnMobileChanged(matches) を呼ぶ
// - sidebarChanged(hidden, key): PC のサイドバーの開閉を html のクラス（sidebar-hidden）と localStorage（key）に反映する
// - searchSheet(open, focus): スマホの検索欄の開閉（html の search-open クラス）。閉じるときは、フォーカスを検索ボタンへ移す
// - focusMain(): 「本文へ移動」（スキップリンク）の先の main にフォーカスを移す
// - フッターの高さを、CSS 変数 --footer-height に入れる（フッターは画面の下に固定。本文の領域は、その分だけ短い）
// 検索ボタン（.fsk-search-toggle）の click は、Blazor を待たずに欄を開く（iOS は、タップの流れの中でフォーカスしないとキーボードが出ないため）
(function () {
    "use strict";
    var MOBILE_QUERY = "(max-width: 767.98px)";
    var api = window.faraSiteKit = window.faraSiteKit || {};

    api.watchMobile = function (ref) {
        var mq = window.matchMedia(MOBILE_QUERY);
        var handler = function (e) { ref.invokeMethodAsync("OnMobileChanged", e.matches); };
        if (mq.addEventListener) mq.addEventListener("change", handler); else if (mq.addListener) mq.addListener(handler);
        return mq.matches;
    };

    api.sidebarChanged = function (hidden, key) {
        document.documentElement.classList.toggle("sidebar-hidden", !!hidden);
        try { localStorage.setItem(key, hidden ? "1" : "0"); } catch (err) { }
        // 隠す・開くで、ページの幅が変わるので、測り直させる（scroll-progress.js など）
        window.dispatchEvent(new Event("resize"));
    };

    api.searchSheet = function (open, focus) {
        var sheet = document.getElementById("fsk-search-sheet");
        var active = document.activeElement;
        var inside = !!(sheet && active && sheet.contains(active));
        var btn = document.querySelector(".fsk-search-toggle");
        if (!open && (focus || inside) && btn) btn.focus();
        else if (!open && inside && active.blur) active.blur();
        document.documentElement.classList.toggle("search-open", !!open);
        // 入力欄は、サイトが置いた検索部品の中の最初の input（ID は決め打ちにしない）
        if (open && focus && sheet) {
            var input = sheet.querySelector("input");
            if (input) input.focus();
        }
    };

    api.focusMain = function () {
        var main = document.getElementById("fsk-main");
        if (main) main.focus();
    };

    // フッターの高さを --footer-height（CSS 変数）に入れる。フッターは描画の後に出るので、#app の変化を見て付け直す
    if (window.ResizeObserver && window.MutationObserver) {
        var watched = null;
        var footerSize = new ResizeObserver(function () {
            if (watched) document.documentElement.style.setProperty("--footer-height", watched.offsetHeight + "px");
        });
        var watchFooter = function () {
            var footer = document.querySelector(".site-footer");
            if (!footer || footer === watched) return;
            if (watched) footerSize.unobserve(watched);
            watched = footer;
            footerSize.observe(footer);
        };
        watchFooter();
        new MutationObserver(watchFooter).observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
    }

    document.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".fsk-search-toggle")) api.searchSheet(true, true);
    }, false);
})();
