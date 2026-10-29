#pragma warning disable MUD0012 // テストでは、部品の状態（Open・Variant など）を直接読んで確かめる
using Bunit;
using FaraBlazorComponent.Core;
using FaraBlazorComponent.Razor.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using MudBlazor;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

public class SiteLayoutTests : BlazorComponentTestContext
{
    private const string SidebarKey = "fara-blazor-component.sidebar-hidden";

    private IRenderedComponent<SiteLayout> RenderLayout(bool mobile = false, bool withSearchSheet = false)
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(mobile);
        return Render<SiteLayout>(p =>
        {
            p.Add(c => c.Body, builder => builder.AddMarkupContent(0, "<p class=\"body-text\">本文</p>"));
            p.Add(c => c.SearchBox, builder => builder.AddMarkupContent(0, "<input class=\"desktop-search\" />"));
            p.Add(c => c.HeaderEnd, builder => builder.AddMarkupContent(0, "<span class=\"header-end\">設定</span>"));
            p.Add(c => c.MobileHeaderActions, builder => builder.AddMarkupContent(0, "<span class=\"mobile-actions\">切替</span>"));
            p.Add(c => c.DrawerContent, (EventCallback _) => builder => builder.AddMarkupContent(0, "<a class=\"nav-item\">項目</a>"));
            if (withSearchSheet)
                p.Add(c => c.SearchSheet, (EventCallback _) => builder => builder.AddMarkupContent(0, "<input class=\"sheet-input\" />"));
        });
    }

    [Fact]
    public void ThePageDoesNotScrollOnPhonesByDefault()
    {
        var cut = RenderLayout(mobile: true);

        Assert.DoesNotContain("fbc-page-scroll", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public async Task EscapeClosesThePhoneMenuAndReturnsFocusToTheMenuButton()
    {
        var cut = RenderLayout(mobile: true);
        cut.Find(".fbc-menu-toggle").Click();
        Assert.Equal("true", cut.Find(".fbc-menu-toggle").GetAttribute("aria-expanded"));

        // JS の文書の keydown（Escape）から呼ばれる入口
        await cut.InvokeAsync(() => cut.Instance.OnEscape());

        Assert.Equal("false", cut.Find(".fbc-menu-toggle").GetAttribute("aria-expanded"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusMenu");
    }

    [Fact]
    public async Task EscapeDoesNothingWhenThePhoneMenuIsClosed()
    {
        var cut = RenderLayout(mobile: true);

        await cut.InvokeAsync(() => cut.Instance.OnEscape());

        Assert.DoesNotContain(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusMenu");
    }

    [Fact]
    public void DisposingTheLayoutRemovesTheMobileWatchWithTheSameKey()
    {
        var cut = RenderLayout(mobile: false);
        var key = JSInterop.Invocations.Single(i => i.Identifier == "faraBlazorComponent.watchMobile").Arguments[1];

        ((IDisposable)cut.Instance).Dispose();

        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.unwatchMobile" && Equals(i.Arguments[0], key));
    }

    [Fact]
    public void MobilePageScrollAddsTheClassAndKeepsTheOthers()
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(true);
        var cut = Render<SiteLayout>(p =>
        {
            p.Add(c => c.Body, builder => builder.AddMarkupContent(0, "<p>本文</p>"));
            p.Add(c => c.MobilePageScroll, true);
            p.Add(c => c.PageClass, "site-extra");
        });

        var classes = cut.Find("div.mud-layout").ClassName!.Split(' ');
        Assert.Contains("fbc-page", classes);
        Assert.Contains("fbc-page-scroll", classes);
        Assert.Contains("site-extra", classes);
    }

    [Fact]
    public void OnAPhoneTheDrawerIsClosedOnTheFirstRender()
    {
        var cut = RenderLayout(mobile: true);

        var drawer = cut.FindComponent<MudDrawer>().Instance;
        Assert.Equal(DrawerVariant.Temporary, drawer.Variant);
        Assert.False(drawer.Open);
    }

    [Fact]
    public void OnDesktopASavedHiddenSidebarStaysHidden()
    {
        JSInterop.Setup<string?>("localStorage.getItem", _ => true).SetResult("1");

        var cut = RenderLayout(mobile: false);

        Assert.False(cut.FindComponent<MudDrawer>().Instance.Open);
        Assert.Equal(DrawerVariant.Mini, cut.FindComponent<MudDrawer>().Instance.Variant);
    }

    [Fact]
    public void DesktopSidebarIsOpenByDefault()
    {
        var cut = RenderLayout(mobile: false);

        Assert.True(cut.FindComponent<MudDrawer>().Instance.Open);
    }

    [Fact]
    public void DrawerBreakpointIsSmSoTheMiniDrawerDoesNotDisappearAtTabletWidth()
    {
        var cut = RenderLayout();

        Assert.Equal(Breakpoint.Sm, cut.FindComponent<MudDrawer>().Instance.Breakpoint);
    }

    [Fact]
    public void SkipLinkPointsToTheMainOfTheCurrentPageNotToTheSiteRoot()
    {
        var cut = RenderLayout();

        var skip = cut.Find("a.fbc-skip-link");
        Assert.Equal("本文へ移動", skip.TextContent.Trim());
        Assert.EndsWith("#fbc-main", skip.GetAttribute("href"));
        var main = cut.Find("main#fbc-main");
        Assert.Equal("-1", main.GetAttribute("tabindex"));
    }

    [Fact]
    public void HeaderShowsTheSiteNameAndHomeLink()
    {
        var cut = RenderLayout();

        var brand = cut.Find("a.fbc-brand");
        Assert.Equal("テストサイト", brand.TextContent);
        Assert.Equal("./", brand.GetAttribute("href"));
    }

    [Fact]
    public void VeryLongSiteNameIsRenderedWhole()
    {
        var name = new string('名', 200);
        Services.GetRequiredService<SiteOptions>().Name = name;

        var cut = RenderLayout();

        Assert.Equal(name, cut.Find("a.fbc-brand").TextContent);
    }

    [Fact]
    public void DesktopShowsSearchAndHeaderControlsButNotTheMobileParts()
    {
        var cut = RenderLayout(mobile: false, withSearchSheet: true);

        Assert.NotNull(cut.Find(".desktop-search"));
        Assert.NotNull(cut.Find(".header-end"));
        Assert.Empty(cut.FindAll(".mobile-actions"));
        Assert.Empty(cut.FindAll(".fbc-search-toggle"));
        Assert.Empty(cut.FindAll("#fbc-search-sheet"));
    }

    [Fact]
    public void PhoneShowsTheMobileActionsAndTheSearchButtonInsteadOfTheDesktopSearch()
    {
        var cut = RenderLayout(mobile: true, withSearchSheet: true);

        Assert.NotNull(cut.Find(".mobile-actions"));
        Assert.NotNull(cut.Find(".fbc-search-toggle"));
        Assert.Empty(cut.FindAll(".desktop-search"));
        Assert.Equal("false", cut.Find(".fbc-search-toggle").GetAttribute("aria-expanded"));
    }

    [Fact]
    public void PhoneWithoutASearchSheetHasNoSearchButton()
    {
        var cut = RenderLayout(mobile: true, withSearchSheet: false);

        Assert.Empty(cut.FindAll(".fbc-search-toggle"));
    }

    [Fact]
    public void SearchButtonOpensTheSheet()
    {
        var cut = RenderLayout(mobile: true, withSearchSheet: true);

        cut.Find(".fbc-search-toggle").Click();

        Assert.Equal("true", cut.Find(".fbc-search-toggle").GetAttribute("aria-expanded"));
        Assert.NotNull(cut.Find("#fbc-search-sheet .sheet-input"));
    }

    [Fact]
    public void HamburgerTogglesTheDesktopSidebarAndSavesIt()
    {
        var cut = RenderLayout(mobile: false);

        cut.Find("button.fbc-menu-toggle").Click();

        Assert.False(cut.FindComponent<MudDrawer>().Instance.Open);
        Assert.Equal("false", cut.Find("button.fbc-menu-toggle").GetAttribute("aria-expanded"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.sidebarChanged" && i.Arguments[1]?.ToString() == SidebarKey);
    }

    [Fact]
    public void DrawerContentAndBodyAreRendered()
    {
        var cut = RenderLayout();

        Assert.Equal("項目", cut.Find(".fbc-sidebar .nav-item").TextContent);
        Assert.Equal("本文", cut.Find("main article .body-text").TextContent);
    }

    [Fact]
    public void DarkSavedThemeIsPassedToTheProviders()
    {
        SetStoredTheme("{\"Theme\":\"dark\"}");

        var cut = RenderLayout();

        Assert.True(cut.FindComponent<MudThemeProvider>().Instance.IsDarkMode);
    }

    [Fact]
    public void ScrollProgressLineIsRenderedInTheHeaderAndHiddenFromScreenReaders()
    {
        var cut = RenderLayout();

        var line = cut.Find("header .fbc-scroll-progress");
        Assert.Equal("true", line.GetAttribute("aria-hidden"));
    }

    [Fact]
    public void OnAPhoneOpeningTheMenuAndMovingToAPageClosesIt()
    {
        var cut = RenderLayout(mobile: true);
        cut.Find("button.fbc-menu-toggle").Click();
        Assert.True(cut.FindComponent<MudDrawer>().Instance.Open);

        Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/damage-calculator");

        Assert.False(cut.FindComponent<MudDrawer>().Instance.Open);
    }

    [Fact]
    public void ClosedPhoneDrawerIsInertSoItsLinksAreNotTabStops()
    {
        var cut = RenderLayout(mobile: true);

        var drawer = cut.Find("#fbc-sidebar");
        Assert.True(drawer.HasAttribute("inert"));
        Assert.Single(cut.FindAll("#fbc-sidebar .nav-item"));   // 中身は残す（閉じている間も DOM にある）
    }

    [Fact]
    public async Task OpeningThePhoneDrawerRemovesInertAndEscapePutsItBack()
    {
        var cut = RenderLayout(mobile: true);

        cut.Find(".fbc-menu-toggle").Click();
        Assert.False(cut.Find("#fbc-sidebar").HasAttribute("inert"));

        await cut.InvokeAsync(() => cut.Instance.OnEscape());

        Assert.True(cut.Find("#fbc-sidebar").HasAttribute("inert"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusMenu");
    }

    [Fact]
    public void ThePhoneDrawerHasACloseButtonThatClosesItAndReturnsFocusToTheMenuButton()
    {
        // ドロワーが左上（ハンバーガーの位置）を覆うため、閉じる手段はドロワーの中にある
        var cut = RenderLayout(mobile: true);
        cut.Find(".fbc-menu-toggle").Click();
        var close = cut.Find("#fbc-sidebar .fbc-drawer-close");
        Assert.Equal("メニューを閉じる", close.GetAttribute("aria-label"));

        close.Click();

        Assert.Equal("false", cut.Find(".fbc-menu-toggle").GetAttribute("aria-expanded"));
        Assert.True(cut.Find("#fbc-sidebar").HasAttribute("inert"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusMenu");
    }

    [Fact]
    public void ThePcDrawerHasNoCloseButton()
    {
        var cut = RenderLayout(mobile: false);

        Assert.Empty(cut.FindAll(".fbc-drawer-close"));
    }

    [Fact]
    public void ThePcDrawerIsNeverInert()
    {
        var cut = RenderLayout(mobile: false);

        Assert.False(cut.Find("#fbc-sidebar").HasAttribute("inert"));
    }
}
