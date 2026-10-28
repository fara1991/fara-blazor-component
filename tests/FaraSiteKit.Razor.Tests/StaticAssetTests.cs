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
