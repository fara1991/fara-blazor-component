using MudBlazor;
using Xunit;

namespace FaraSiteKit.Razor.Tests;

/// <summary>依存（MudBlazor）の版を確かめる。計画（9.11.0）から外れたら、ここで気づく。</summary>
public class PackageVersionTests
{
    [Fact]
    public void MudBlazorIs_9_11_0()
    {
        var version = typeof(MudThemeProvider).Assembly.GetName().Version;
        Assert.Equal(new Version(9, 11, 0, 0), version);
    }
}
