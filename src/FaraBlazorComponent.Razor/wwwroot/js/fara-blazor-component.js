// Fara のサイト共通の振る舞い（SiteLayout.razor が使う）。名前は window.faraBlazorComponent の下にまとめる（サイトの他の JS と重ならないように）。
// - watchMobile(ref, key): 768px 未満（スマホ）かどうかを返す。変わったら ref.OnMobileChanged(matches) を呼ぶ。Esc キーで ref.OnEscape() を呼ぶ。key は呼び出し側の一意の文字列
// - unwatchMobile(key): watchMobile の登録（matchMedia の変化と Esc）を外す。Dispose で呼ぶ（外さないと、画面を移るたびに古い参照へ送り続ける）
// - focusMenu(): スマホのメニューボタン（.fbc-menu-toggle）にフォーカスを戻す（メニューを Esc で閉じたとき）
// - sidebarChanged(hidden, key): PC のサイドバーの開閉を html のクラス（fbc-sidebar-hidden）と localStorage（key）に反映する
// - searchSheet(open, focus): スマホの検索欄の開閉（html の fbc-search-open クラス）。閉じるときは、フォーカスを検索ボタンへ移す
// - focusMain(): 「本文へ移動」（スキップリンク）の先の main にフォーカスを移す
// - checkConfig(storageKey, sidebarKey): index.html の theme-init.js の data-storage-key・data-sidebar-key と、SiteOptions の値が同じかを確かめる（違えば警告）
// - watchWidth(ref, key, px) / unwatchWidth(key): 画面の幅が px より狭いかを返す。変わったら ref.OnCollapsedChanged(matches) を呼ぶ（SiteTopNav の CollapseBelowPx）
// - dropdownOpen(rootId, toggleId, panelId, ref, key) / dropdownClose(key): SiteTopNav の「もっと見る」が開いているあいだ、パネルをボタンの下に置き（fixed）、
//   外のクリック・フォーカスの移動で ref.CloseFromOutside() を呼び、↑↓・Home・End で項目を移す
// - focusById(id): 指定の要素にフォーカスを移す
// 検索ボタン（.fbc-search-toggle）の click は、Blazor を待たずに欄を開く（iOS は、タップの流れの中でフォーカスしないとキーボードが出ないため）
// フッターの高さは CSS（flex）だけで決める。JS では測らない。
(function () {
    "use strict";
    var MOBILE_QUERY = "(max-width: 767.98px)";
    var api = window.faraBlazorComponent = window.faraBlazorComponent || {};
    // 登録中の監視（key → 外すための情報）
    var watchers = {};

    // key を渡したときだけ、Esc の監視を登録する（unwatchMobile(key) で外せる）。key を渡さない古い呼び出し（watchMobile(ref)）は、
    // 従来どおり matchMedia の変化だけを送る（OnEscape を、受けられない参照へ送らない）
    api.watchMobile = function (ref, key) {
        if (key && watchers[key]) api.unwatchMobile(key);
        var mq = window.matchMedia(MOBILE_QUERY);
        var onMedia = function (e) {
            // 回線が切れた後は、送れない（拒否された Promise が残らないように受ける）。画面は再読み込みで戻る
            Promise.resolve(ref.invokeMethodAsync("OnMobileChanged", e.matches)).catch(function (err) {
                console.warn("[fara-blazor-component] OnMobileChanged を送れませんでした。", err);
            });
        };
        if (mq.addEventListener) mq.addEventListener("change", onMedia); else if (mq.addListener) mq.addListener(onMedia);
        if (key) {
            var onKey = function (e) {
                if (e.key !== "Escape" && e.key !== "Esc") return;
                Promise.resolve(ref.invokeMethodAsync("OnEscape")).catch(function (err) {
                    console.warn("[fara-blazor-component] OnEscape を送れませんでした。", err);
                });
            };
            document.addEventListener("keydown", onKey, false);
            watchers[key] = { mq: mq, onMedia: onMedia, onKey: onKey };
        }
        return mq.matches;
    };

    api.unwatchMobile = function (key) {
        var w = watchers[key];
        if (!w) return;
        delete watchers[key];
        if (w.mq.removeEventListener) w.mq.removeEventListener("change", w.onMedia); else if (w.mq.removeListener) w.mq.removeListener(w.onMedia);
        document.removeEventListener("keydown", w.onKey, false);
    };

    var widthWatchers = {};

    api.watchWidth = function (ref, key, px) {
        if (key && widthWatchers[key]) api.unwatchWidth(key);
        var mq = window.matchMedia("(max-width: " + (px - 0.02) + "px)");
        var onMedia = function (e) {
            Promise.resolve(ref.invokeMethodAsync("OnCollapsedChanged", e.matches)).catch(function (err) {
                console.warn("[fara-blazor-component] OnCollapsedChanged を送れませんでした。", err);
            });
        };
        if (mq.addEventListener) mq.addEventListener("change", onMedia); else if (mq.addListener) mq.addListener(onMedia);
        if (key) widthWatchers[key] = { mq: mq, onMedia: onMedia };
        return mq.matches;
    };

    api.unwatchWidth = function (key) {
        var w = widthWatchers[key];
        if (!w) return;
        delete widthWatchers[key];
        if (w.mq.removeEventListener) w.mq.removeEventListener("change", w.onMedia); else if (w.mq.removeListener) w.mq.removeListener(w.onMedia);
    };

    api.focusById = function (id) {
        var el = document.getElementById(id);
        if (el) el.focus();
    };

    // ドロップダウン（key → 外すための情報）。開いているあいだだけ登録する
    var dropdowns = {};

    api.dropdownOpen = function (rootId, toggleId, panelId, ref, key) {
        api.dropdownClose(key);
        var root = document.getElementById(rootId);
        var toggle = document.getElementById(toggleId);
        var panel = document.getElementById(panelId);
        if (!root || !toggle || !panel) return;
        // ヘッダーの overflow に切られないよう、パネルは fixed でボタンの下に置く（画面の端にはみ出さないよう右に寄せる）
        // 開いた直後は、まだパネルが表示される前（幅 0）なので、次のフレームで置く。画面の大きさが変わったときも置き直す
        var place = function () {
            var rect = toggle.getBoundingClientRect();
            panel.style.position = "fixed";
            panel.style.top = Math.round(rect.bottom + 4) + "px";
            panel.style.left = Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - panel.offsetWidth - 8)) + "px";
        };
        place();
        window.requestAnimationFrame(place);
        var items = function () { return Array.prototype.slice.call(panel.querySelectorAll("a[href]")); };
        var close = function () {
            api.dropdownClose(key);
            Promise.resolve(ref.invokeMethodAsync("CloseFromOutside")).catch(function (err) {
                console.warn("[fara-blazor-component] CloseFromOutside を送れませんでした。", err);
            });
        };
        var onPointer = function (e) { if (!root.contains(e.target)) close(); };
        var onFocusIn = function (e) { if (!root.contains(e.target)) close(); };
        var onKey = function (e) {
            var list = items();
            if (!list.length) return;
            var index = list.indexOf(document.activeElement);
            var next = -1;
            if (e.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % list.length;
            else if (e.key === "ArrowUp") next = index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length;
            else if (e.key === "Home" && index >= 0) next = 0;
            else if (e.key === "End" && index >= 0) next = list.length - 1;
            else if (e.key === "Tab" && !e.shiftKey && index === list.length - 1) { close(); return; }
            if (next < 0) return;
            e.preventDefault();
            list[next].focus();
        };
        document.addEventListener("pointerdown", onPointer, true);
        document.addEventListener("focusin", onFocusIn, true);
        root.addEventListener("keydown", onKey, false);
        window.addEventListener("resize", place, false);
        dropdowns[key] = { root: root, onPointer: onPointer, onFocusIn: onFocusIn, onKey: onKey, place: place };
    };

    api.dropdownClose = function (key) {
        var d = dropdowns[key];
        if (!d) return;
        delete dropdowns[key];
        document.removeEventListener("pointerdown", d.onPointer, true);
        document.removeEventListener("focusin", d.onFocusIn, true);
        d.root.removeEventListener("keydown", d.onKey, false);
        window.removeEventListener("resize", d.place, false);
    };

    api.focusMenu = function () {
        var btn = document.querySelector(".fbc-menu-toggle");
        if (btn) btn.focus();
    };

    api.sidebarChanged = function (hidden, key) {
        document.documentElement.classList.toggle("fbc-sidebar-hidden", !!hidden);
        try { localStorage.setItem(key, hidden ? "1" : "0"); } catch (err) {
            // 保存できない（プライベートブラウズ・容量の上限など）ときは、この表示だけ有効
            console.warn("[fara-blazor-component] サイドバーの設定を保存できませんでした。", err);
        }
        // 隠す・開くで、ページの幅が変わるので、測り直させる（fbc-scroll-progress.js など）
        window.dispatchEvent(new Event("resize"));
    };

    api.searchSheet = function (open, focus) {
        var sheet = document.getElementById("fbc-search-sheet");
        var active = document.activeElement;
        var inside = !!(sheet && active && sheet.contains(active));
        var btn = document.querySelector(".fbc-search-toggle");
        if (!open && (focus || inside) && btn) btn.focus();
        else if (!open && inside && active.blur) active.blur();
        document.documentElement.classList.toggle("fbc-search-open", !!open);
        // 入力欄は、サイトが置いた検索部品の中の最初の input（ID は決め打ちにしない）
        if (open && focus && sheet) {
            var input = sheet.querySelector("input");
            if (input) input.focus();
        }
    };

    api.focusMain = function () {
        var main = document.getElementById("fbc-main");
        if (main) main.focus();
    };

    // theme-init.js の script タグの data 属性と、SiteOptions の値（StorageKey・SidebarKey）が同じかを見る。
    // 食い違うと、テーマの反映（描画の前）と保存（C#）が別の場所を見るので、警告を出す。戻り値は、同じなら true
    api.checkConfig = function (storageKey, sidebarKey) {
        var script = document.querySelector('script[src*="theme-init.js"]');
        if (!script) {
            console.warn("[fara-blazor-component] index.html に theme-init.js が無いため、テーマの反映が描画の前に行われません（docs/usage.md の index.html の断片を入れてください）。");
            return false;
        }
        var ok = true;
        if (script.dataset.storageKey !== storageKey) {
            console.warn("[fara-blazor-component] theme-init.js の data-storage-key（" + script.dataset.storageKey + "）と SiteOptions.StorageKey（" + storageKey + "）が違います。どちらかを合わせてください。");
            ok = false;
        }
        if (script.dataset.sidebarKey !== sidebarKey) {
            console.warn("[fara-blazor-component] theme-init.js の data-sidebar-key（" + script.dataset.sidebarKey + "）と SiteOptions.SidebarKey（" + sidebarKey + "）が違います。どちらかを合わせてください。");
            ok = false;
        }
        return ok;
    };

    document.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".fbc-search-toggle")) api.searchSheet(true, true);
    }, false);
})();
