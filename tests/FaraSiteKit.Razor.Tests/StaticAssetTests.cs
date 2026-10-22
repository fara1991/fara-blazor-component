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
}
