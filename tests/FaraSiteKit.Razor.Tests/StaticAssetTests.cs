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
        Assert.Contains("sidebar-hidden", js);
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

    [Theory]
    [InlineData("fsk-page")]
    [InlineData("app-header")]
    [InlineData("sidebar")]
    [InlineData("sidebar-toggle")]
    [InlineData("app-brand")]
    [InlineData("fsk-search-toggle")]
    [InlineData("fsk-search-sheet")]
    [InlineData("scroll-progress")]
    [InlineData("skip-link")]
    [InlineData("nav-section")]
    [InlineData("pane-scroll")]
    [InlineData("page-pane")]
    [InlineData("page-column")]
    [InlineData("page-card")]
    [InlineData("report-card")]
    [InlineData("report-trap")]
    [InlineData("app-field")]
    [InlineData("app-select")]
    [InlineData("site-footer")]
    [InlineData("site-footer-line")]
    [InlineData("site-footer-sep")]
    [InlineData("site-footer-socials")]
    [InlineData("site-footer-social")]
    [InlineData("maintenance-notice")]
    [InlineData("maintenance-screen")]
    [InlineData("maintenance-link")]
    public void TheStylesheetDefinesEveryClassTheComponentsUse(string className)
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains("." + className, css);
    }

    [Fact]
    public void TheHoneypotIsMovedOffScreenAndHiddenInTheStylesheet()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains(".report-trap {", css);
        Assert.Contains("left: -10000px;", css);
    }

    [Fact]
    public void TheDarkThemeOverridesTheTokensOnTheHtmlElement()
    {
        var css = File.ReadAllText(Path.Combine(RepoRoot(), "src", "FaraSiteKit.Razor", "wwwroot", "css", "fara-site-kit.css"));

        Assert.Contains(":root[data-bs-theme=\"dark\"]", css);
        Assert.Contains("--fsk-body-bg: #0c0616;", css);
    }
}
