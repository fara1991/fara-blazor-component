#pragma warning disable MUD0012 // テストでは、部品の状態（IsDarkMode など）を直接読んで確かめる
using Bunit;
using Microsoft.Extensions.DependencyInjection;
using FaraBlazorComponent.Razor.Components;
using MudBlazor;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

public class ThemeStateTests
{
    [Fact]
    public void ReadThemeDefaultsToLightWhenNothingIsSaved()
    {
        Assert.Equal("light", SiteThemeState.ReadTheme(null));
        Assert.Equal("light", SiteThemeState.ReadTheme(""));
        Assert.Equal("light", SiteThemeState.ReadTheme("{}"));
    }

    [Fact]
    public void ReadThemeReadsDarkFromTheSavedJson()
    {
        Assert.Equal("dark", SiteThemeState.ReadTheme("{\"Theme\":\"dark\"}"));
        // プロパティ名は大文字小文字を問わない（pokemon の設定と、手で書いた値の両方を読めるように）
        Assert.Equal("dark", SiteThemeState.ReadTheme("{\"theme\":\"dark\"}"));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1,2]")]
    [InlineData("{\"Theme\":\"blue\"}")]
    [InlineData("{\"Theme\":5}")]
    public void ReadThemeFallsBackToLight(string json)
    {
        Assert.Equal("light", SiteThemeState.ReadTheme(json));
    }

    [Fact]
    public void WriteThemeKeepsOtherSettings()
    {
        var json = SiteThemeState.WriteTheme("{\"DataSetKey\":\"gen9\",\"Format\":\"Doubles\",\"Theme\":\"light\"}", "dark");

        Assert.Equal("dark", SiteThemeState.ReadTheme(json));
        Assert.Contains("\"DataSetKey\":\"gen9\"", json);
        Assert.Contains("\"Format\":\"Doubles\"", json);
    }

    [Fact]
    public void WriteThemeStartsFreshWhenTheSavedJsonIsBroken()
    {
        var json = SiteThemeState.WriteTheme("{broken", "dark");

        Assert.Equal("{\"Theme\":\"dark\"}", json);
    }

    [Fact]
    public void WriteThemeNormalizesUnknownValuesToLight()
    {
        Assert.Equal("light", SiteThemeState.ReadTheme(SiteThemeState.WriteTheme(null, "blue")));
    }
}

public class MudProvidersTests : BlazorComponentTestContext
{
    [Fact]
    public void DarkSavedThemeIsAppliedBeforeTheFirstRender()
    {
        SetStoredTheme("{\"Theme\":\"dark\"}");

        var cut = Render<MudProviders>();

        Assert.True(cut.FindComponent<MudThemeProvider>().Instance.IsDarkMode);
    }

    [Fact]
    public void WithoutASavedThemeTheLightThemeIsUsed()
    {
        var cut = Render<MudProviders>();

        Assert.False(cut.FindComponent<MudThemeProvider>().Instance.IsDarkMode);
    }

    [Fact]
    public void ProvidersForPopoverDialogAndSnackbarAreRendered()
    {
        var cut = Render<MudProviders>();

        Assert.NotNull(cut.FindComponent<MudPopoverProvider>());
        Assert.NotNull(cut.FindComponent<MudDialogProvider>());
        Assert.NotNull(cut.FindComponent<MudSnackbarProvider>());
    }

    [Fact]
    public async Task TogglingTheThemeSavesItAndSwitchesTheProvider()
    {
        var cut = Render<MudProviders>();
        var state = Services.GetRequiredService<SiteThemeState>();

        await cut.InvokeAsync(() => state.ToggleAsync());
        cut.Render();

        Assert.True(cut.FindComponent<MudThemeProvider>().Instance.IsDarkMode);
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "localStorage.setItem");
    }
}
