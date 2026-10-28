using Xunit;

namespace FaraSiteKit.Razor.Tests;

/// <summary>
/// 静的ファイル（wwwroot/）と C# の決まりが一致しているか。テーマのキー・形式・属性名・クラス名は、
/// 外部ファイルと C# の両方にあるので、ここで揃っていることを確かめる。
/// </summary>
public class StaticAssetTests
{
    private static string ReadRazorFile(string relative) =>
        File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", relative.Replace('/', Path.DirectorySeparatorChar)));

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src", "FaraSiteKit.Razor")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("リポジトリの場所が見つかりません");
    }

    [Fact]
    public void ThemeInitUsesTheSameAttributeAndPropertyAsTheThemeState()
    {
        var js = ReadRazorFile("wwwroot/js/theme-init.js");

        Assert.Contains("data-bs-theme", js);
        Assert.Contains("\"theme\"", js);
        Assert.Contains("fsk-sidebar-hidden", js);
        Assert.Equal("Theme", SiteThemeState.ThemeProperty);
        Assert.Equal("dark", SiteThemeState.Dark);
    }

    [Fact]
    public void BootIndicatorTimingsMatchTheStylesheetAndTheScript()
    {
        var js = ReadRazorFile("wwwroot/js/boot-indicator.js");
        var template = File.ReadAllText(Path.Combine(RepoRoot(), "docs", "index-template.html"));

        // 60 秒で外れる（JS の RELEASE_MS と、CSS の保険 boot-indicator-release）。45 秒で再読み込みの案内（SLOW_MS）
        Assert.Contains("var RELEASE_MS = 60000;", js);
        Assert.Contains("var SLOW_MS = 45000;", js);
        Assert.Contains("boot-indicator-release 0s linear 60s", template);
    }

    [Fact]
    public void TemplateScriptAttributesMatchTheSiteOptionsDefaults()
    {
        var options = new FaraSiteKit.Core.SiteOptions();
        var template = File.ReadAllText(Path.Combine(RepoRoot(), "docs", "index-template.html"));

        Assert.Contains($"data-storage-key=\"{options.StorageKey}\"", template);
        Assert.Contains($"data-sidebar-key=\"{options.SidebarKey}\"", template);
    }

    [Fact]
    public void FocusRingsAndTapTargetsAreInTheStylesheetWithEnoughSpecificity()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");

        // MudBlazor の reset（a:focus-visible の outline: none）に負けない詳細度で、キーボードの枠を出す
        Assert.Contains(".fsk-header :is(a, button):focus-visible", css);
        Assert.Contains(".fsk-skip-link:focus-visible", css);
        // スマホの当たり判定（44px）と、ラベルの中の補助の文字（12px 以上）
        Assert.Contains("@media (max-width: 599.98px)", css);
        Assert.Contains("small.fsk-muted", css);
    }

    [Fact]
    public void PageWideFocusRingCoversLinksButtonsAndTheSidebarWithoutFormFields()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");

        // ページ全体の既定（MudBlazor の reset に負けない詳細度で html を足す）。サイドバーの .mud-nav-link も含む
        var rule = Between(css, "html a:focus-visible", "}");
        Assert.Contains("html button:focus-visible", rule);
        Assert.Contains("html [role=\"button\"]:focus-visible", rule);
        Assert.Contains("html [tabindex]:focus-visible", rule);
        Assert.Contains("html .mud-nav-link:focus-visible", rule);
        Assert.Contains("html .fsk-nav :is(a, button):focus-visible", rule);
        Assert.Contains("outline: 2px solid var(--fsk-focus, #e9d5ff)", rule);
        Assert.Contains("outline-offset: 2px", rule);
        // 入力欄は MudBlazor が枠線の色で示すので、二重の枠は出さない
        Assert.DoesNotContain("input", rule);
        Assert.DoesNotContain("textarea", rule);
        Assert.DoesNotContain("select", rule);
    }

    [Fact]
    public void UnavailableReportNoticeMeetsContrastOnBothThemes()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");
        var razor = ReadRazorFile("Components/ReportFormView.razor");

        // 受付停止の文（MudAlert の警告）は、白地で 4.5:1 以上の文字色（既定の橙 #d68100 は 3:1 未満）
        Assert.Contains("fsk-report-unavailable", razor);
        Assert.Contains(".fsk-report-unavailable.mud-alert", css);
        Assert.Contains("--fsk-warning-text: #9a5b00", css);
        Assert.Contains(":root[data-bs-theme=\"dark\"]", css);
        Assert.Contains("--fsk-warning-text: #ffb74d", css);
        Assert.True(ContrastRatio("#9a5b00", "#ffffff") >= 4.5);
        Assert.True(ContrastRatio("#9a5b00", "#f7f4fd") >= 4.5);
        Assert.True(ContrastRatio("#ffb74d", "#1a1030") >= 4.5);
    }

    [Fact]
    public void NoBareCatchBlocksAreLeftInTheRazorOrCoreSources()
    {
        // 空の catch { } は、JS の失敗（JSException・JSDisconnectedException）以外も黙って飲む。型を絞るか、理由のコメントつきで書く
        var root = RepoRoot();
        var files = Directory.EnumerateFiles(Path.Combine(root, "src"), "*.*", SearchOption.AllDirectories)
            .Where(f => f.EndsWith(".razor", StringComparison.Ordinal) || f.EndsWith(".cs", StringComparison.Ordinal))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));
        foreach (var file in files)
        {
            var text = File.ReadAllText(file);
            Assert.False(System.Text.RegularExpressions.Regex.IsMatch(text, @"catch\s*\{"), $"{file} に型のない catch があります");
        }
    }

    private static double ContrastRatio(string a, string b)
    {
        static double Luminance(string hex)
        {
            double Channel(int i)
            {
                var c = int.Parse(hex.Substring(1 + i * 2, 2), System.Globalization.NumberStyles.HexNumber) / 255.0;
                return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
            }
            return 0.2126 * Channel(0) + 0.7152 * Channel(1) + 0.0722 * Channel(2);
        }
        var la = Luminance(a);
        var lb = Luminance(b);
        return (Math.Max(la, lb) + 0.05) / (Math.Min(la, lb) + 0.05);
    }

    [Fact]
    public void PhoneFormControlsAreAtLeast44PxHigh()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");

        // ドロワーの文字のボタン（テーマ切替）も 44px（見た目は変えない）
        var phone = Between(css, "@media (max-width: 599.98px)", "/* タブレット");
        Assert.Contains(".fsk-theme-button", phone);
        // 報告フォームの送信ボタン（既定の 37px）と入力欄（input 40px）は、1024px 以下（768〜1440 でも小さいままにしない）で 44px
        var tablet = Between(css, "@media (max-width: 1024px) {\n    .fsk-report-card", "/* ---- 内容の列");
        Assert.Contains(".fsk-report-submit", tablet);
        Assert.Contains(".fsk-report-card #report-contact", tablet);
        Assert.Contains("min-height: 44px", tablet);
    }

    [Fact]
    public void HeaderSearchInputGetsAKeyboardFocusRingWithoutChangingTheFieldFrame()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");

        // 検索入力（サイトが SearchBox に置く）にも、ボタンと同じ淡い紫の枠。欄の枠線（.mud-focused）は変えない
        Assert.Contains(".fsk-header :is(input, textarea):focus-visible", css);
        var rule = Between(css, ".fsk-header :is(input, textarea):focus-visible", "}");
        Assert.Contains("outline: 2px solid var(--fsk-focus, #e9d5ff)", rule);
        Assert.DoesNotContain("border", rule);
    }

    [Fact]
    public void FooterAndInlineLinkTapTargetsGrowUpToTabletWidth()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");

        // フッターの文字リンク（問い合わせ・プライバシー）は全幅で当たり判定を広げる（1440px でも 22px 高にしない）。1024px の @media の外にある
        var footerLink = Between(css, ".fsk-footer a:not(.fsk-footer-social) {", "}");
        Assert.Contains("padding-block: 13px", footerLink);
        Assert.Contains("margin-block: -13px", footerLink);
        // 1024px 以下: 本文中の小さなリンク・SNS の間隔（44px の当たり判定が重ならない 22px）
        var tablet = Between(css, "@media (max-width: 1024px) {\n    .fsk-small a", "}\n}");
        Assert.Contains(".fsk-small a", tablet);
        Assert.Contains("gap: 22px", tablet);
        Assert.DoesNotContain("fsk-footer a:not", tablet);
        // .fsk-footer-socials の既定の gap より後に書く（同じ詳細度の後勝ち）
        Assert.True(css.IndexOf("@media (max-width: 1024px) {\n    .fsk-small a", StringComparison.Ordinal) > css.IndexOf(".fsk-footer-socials {", StringComparison.Ordinal));
    }

    [Fact]
    public void PhoneFooterLinksGet44PxHitAreasWithoutStackingOnTheFullWidthPadding()
    {
        var css = ReadRazorFile("wwwroot/css/fara-site-kit.css");

        // スマホ（600px 未満）: 文字リンクは ::after の 44px の判定を持つ（作者名が短くても 44px）。全幅の padding・負の margin は打ち消す
        var phone = Between(css, "@media (max-width: 599.98px) {\n    .fsk-footer {", "/* ---- メンテナンス");
        Assert.Contains(".fsk-footer a:not(.fsk-footer-social)::after", phone);
        Assert.Contains("width: max(100%, 44px)", phone);
        Assert.Contains("height: 44px", phone);
        Assert.Contains("padding-block: 0", phone);
        Assert.Contains("margin-block: 0", phone);
        // 行と行の中心どうしを 44px 以上離す（上の行の判定が下の行の判定に重ならない）。行の高さ 22px ＋ 行間 22px
        Assert.Contains("row-gap: 22px", phone);
        Assert.Contains("line-height: 22px", phone);
        // 作者名の判定が右の SNS に重ならないよう、SNS の前の間隔を足す
        Assert.Contains("margin-left: 0.5rem", phone);

        // PC・タブレット（600px 以上）の規則は変えない（全幅の規則が残る）
        var fullWidth = Between(css, ".fsk-footer a:not(.fsk-footer-social) {", "}");
        Assert.Contains("padding-block: 13px", fullWidth);
        Assert.Contains("margin-block: -13px", fullWidth);
        Assert.DoesNotContain("padding-block: 0", Between(css, "@media (max-width: 1024px) {\n    .fsk-small a", "}\n}"));
    }

    private static string Between(string text, string start, string end)
    {
        var from = text.IndexOf(start, StringComparison.Ordinal);
        Assert.True(from >= 0, $"{start} が見つかりません");
        var to = text.IndexOf(end, from, StringComparison.Ordinal);
        Assert.True(to > from, $"{end} が見つかりません");
        return text.Substring(from, to - from);
    }

    [Theory]
    [InlineData("fsk-page")]
    [InlineData("fsk-header")]
    [InlineData("fsk-sidebar")]
    [InlineData("fsk-menu-toggle")]
    [InlineData("fsk-brand")]
    [InlineData("fsk-search-toggle")]
    [InlineData("fsk-search-sheet")]
    [InlineData("fsk-scroll-progress")]
    [InlineData("fsk-skip-link")]
    [InlineData("fsk-nav-section")]
    [InlineData("fsk-pane-scroll")]
    [InlineData("fsk-page-pane")]
    [InlineData("fsk-card")]
    [InlineData("fsk-card-body")]
    [InlineData("fsk-form-group")]
    [InlineData("fsk-form-label")]
    [InlineData("fsk-mb-0")]
    [InlineData("fsk-mb-1")]
    [InlineData("fsk-mb-3")]
    [InlineData("fsk-mt-3")]
    [InlineData("fsk-small")]
    [InlineData("fsk-muted")]
    [InlineData("fsk-page-scroll")]
    [InlineData("fsk-page-column")]
    [InlineData("fsk-page-card")]
    [InlineData("fsk-report-card")]
    [InlineData("fsk-report-trap")]
    [InlineData("fsk-field")]
    [InlineData("fsk-select")]
    [InlineData("fsk-footer")]
    [InlineData("fsk-footer-line")]
    [InlineData("fsk-footer-sep")]
    [InlineData("fsk-footer-socials")]
    [InlineData("fsk-footer-social")]
    [InlineData("fsk-notice")]
    [InlineData("fsk-maintenance")]
    [InlineData("fsk-maintenance-link")]
    public void TheStylesheetDefinesEveryClassTheComponentsUse(string className)
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains("." + className, css);
    }

    [Fact]
    public void EveryFskClassUsedByTheComponentsHasARuleOrIsAKnownHook()
    {
        // 部品が使う fsk- の class は、CSS に規則があるか、サイトが自由に使う目印（規則なし）として許可した名前だけ
        var hooks = new HashSet<string> { "fsk-main", "fsk-nav", "fsk-footer-name", "fsk-notice-text", "fsk-report-turnstile", "fsk-service-" };
        var root = RepoRoot();
        var css = File.ReadAllText(Path.Combine(root, "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));
        var used = Directory.GetFiles(Path.Combine(root, "src", "FaraSiteKit.Razor", "Components"), "*.razor")
            .SelectMany(f => System.Text.RegularExpressions.Regex.Matches(File.ReadAllText(f), "fsk-[a-z0-9-]+").Select(m => m.Value))
            .Distinct();

        foreach (var name in used.Where(n => !hooks.Contains(n)))
            Assert.True(css.Contains("." + name), $"{name} の規則が CSS に無い");
    }

    [Fact]
    public void ThePhonePageScrollRulesAreOnlyForTheOptInClass()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains(".fsk-page.fsk-page-scroll.mud-layout {", css);
        Assert.Contains("html:has(.fsk-page-scroll)", css);
    }

    [Fact]
    public void TheHoneypotIsMovedOffScreenAndHiddenInTheStylesheet()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains(".fsk-report-trap {", css);
        Assert.Contains("left: -10000px;", css);
    }

    [Fact]
    public void TheDarkThemeOverridesTheTokensOnTheHtmlElement()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains(":root[data-bs-theme=\"dark\"]", css);
        Assert.Contains("--fsk-body-bg: #0c0616;", css);
    }

    [Fact]
    public void EveryViewportHeightFallsBackToVhBeforeDvh()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));
        var lines = css.Split('\n').Select(l => l.Trim()).ToArray();

        for (var i = 0; i < lines.Length; i++)
        {
            if (lines[i] != "height: 100vh;" && lines[i] != "min-height: 100vh;") continue;
            var next = i + 1 < lines.Length ? lines[i + 1] : "";
            Assert.True(next.Contains("100dvh"), $"{i + 1} 行目の 100vh の次は 100dvh にする（古い端末は 100vh を使う）");
        }
    }

    [Fact]
    public void TheFooterHeightIsFlexOnlyWithoutAVariableOrScriptMeasuring()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));
        var js = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "js", "fara-site-kit.js"));

        Assert.DoesNotContain("footer-height", css);
        Assert.DoesNotContain("footer-height", js);
    }

    [Fact]
    public void ComponentsDoNotUseTheGenericClassNames()
    {
        var generic = new[] { "content", "page-header", "page-column", "card", "card-body", "nowrap", "sidebar", "app-header", "app-brand", "site-footer", "pane-scroll", "page-pane" };
        var root = Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor");
        foreach (var file in Directory.EnumerateFiles(root, "*.razor", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            foreach (var attribute in text.Split(new[] { "class=\"", "Class=\"" }, StringSplitOptions.None).Skip(1))
            {
                var value = attribute.Split('"')[0];
                foreach (var name in value.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                    Assert.DoesNotContain(name, generic);
            }
        }
    }
}
