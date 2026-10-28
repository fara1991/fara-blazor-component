#pragma warning disable MUD0012 // テストでは、部品の状態（IsDarkMode など）を直接読んで確かめる
using Bunit;
using FaraBlazorComponent.Razor.Components;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

public class ThemeSwitchTests : SiteKitTestContext
{
    [Fact]
    public void SwitchIsOnWhenTheSavedThemeIsDark()
    {
        SetStoredTheme("{\"Theme\":\"dark\"}");

        var cut = Render<ThemeSwitch>();

        Assert.True(cut.FindComponent<MudSwitch<bool>>().Instance.Value);
    }

    [Fact]
    public void SwitchingTurnsDarkOnAndSavesIt()
    {
        var cut = Render<ThemeSwitch>();

        cut.FindComponent<MudSwitch<bool>>().Find("input").Change(true);

        Assert.True(Services.GetRequiredService<SiteThemeState>().IsDark);
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "localStorage.setItem" && i.Arguments.Count > 1 && i.Arguments[1]?.ToString()?.Contains("\"Theme\":\"dark\"") == true);
    }

    [Fact]
    public void ButtonShowsTheLabelForTheOtherTheme()
    {
        var cut = Render<ThemeSwitch>(p => p.Add(c => c.AsButton, true));

        Assert.Contains("🌙 ダークモード", cut.Markup);
        cut.Find("button").Click();
        Assert.Contains("☀ ライトモード", cut.Markup);
    }
}
