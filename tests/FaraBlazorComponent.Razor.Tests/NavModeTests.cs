#pragma warning disable MUD0012 // テストでは、部品の状態（Open・Variant など）を直接読んで確かめる
using Bunit;
using FaraBlazorComponent.Razor.Components;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

/// <summary>v1.1.0 で足した、ナビの出し方（NavMode）・下のタブバー（BottomBar）・サイドバーの高さ（DrawerClipMode）。既定の値が従来と同じことも確かめる。</summary>
public class NavModeTests : BlazorComponentTestContext
{
    private const string SidebarKey = "fara-blazor-component.sidebar-hidden";

    private static RenderFragment BottomBarFragment => builder => builder.AddMarkupContent(0, "<a class=\"tab-item\" href=\"./\">ホーム</a>");

    private static RenderFragment TopNavFragment => builder => builder.AddMarkupContent(0, "<a class=\"fbc-topnav-link\" href=\"./\">ホーム</a>");

    private IRenderedComponent<SiteLayout> RenderLayout(bool mobile, Action<ComponentParameterCollectionBuilder<SiteLayout>>? configure = null)
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(mobile);
        return Render<SiteLayout>(p =>
        {
            p.Add(c => c.Body, builder => builder.AddMarkupContent(0, "<p class=\"body-text\">本文</p>"));
            configure?.Invoke(p);
        });
    }

    // ---- 既定（従来と同じ） ----

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DefaultsKeepTheDrawerBehaviourAndAddNoNewElements(bool mobile)
    {
        var cut = RenderLayout(mobile);

        var drawer = cut.FindComponent<MudDrawer>().Instance;
        Assert.Equal(mobile ? DrawerVariant.Temporary : DrawerVariant.Mini, drawer.Variant);
        Assert.Equal(mobile ? DrawerClipMode.Never : DrawerClipMode.Always, drawer.ClipMode);
        Assert.True(drawer.OpenMiniOnHover);
        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
        Assert.Empty(cut.FindAll(".fbc-bottombar"));
        var classes = cut.Find("div.mud-layout").ClassName!;
        Assert.DoesNotContain("fbc-nav-rail", classes);
        Assert.DoesNotContain("fbc-clip-full", classes);
        Assert.DoesNotContain("fbc-has-bottombar", classes);
        Assert.Equal("fbc-sidebar", cut.Find(".fbc-sidebar").ClassName!.Split(' ').First(c => c.StartsWith("fbc-", StringComparison.Ordinal)));
        Assert.DoesNotContain("fbc-sidebar-rail", cut.Find(".fbc-sidebar").ClassName);
    }

    [Fact]
    public void DefaultDesktopDrawerStillReadsTheSavedOpenState()
    {
        RenderLayout(mobile: false);

        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "localStorage.getItem" && Equals(i.Arguments[0], SidebarKey));
    }

    // ---- Rail ----

    [Fact]
    public void RailOnDesktopIsAnAlwaysVisibleNarrowColumnWithoutAHamburger()
    {
        var cut = RenderLayout(mobile: false, p => p.Add(c => c.NavMode, NavMode.Rail));

        var drawer = cut.FindComponent<MudDrawer>().Instance;
        Assert.Equal(DrawerVariant.Mini, drawer.Variant);
        Assert.False(drawer.Open);
        Assert.False(drawer.OpenMiniOnHover);
        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Contains("fbc-nav-rail", cut.Find("div.mud-layout").ClassName);
        Assert.Contains("fbc-sidebar-rail", cut.Find(".fbc-sidebar").ClassName);
    }

    [Fact]
    public void RailIgnoresTheSavedOpenStateAndNeverWritesIt()
    {
        JSInterop.Setup<string?>("localStorage.getItem", _ => true).SetResult("1");

        var cut = RenderLayout(mobile: false, p => p.Add(c => c.NavMode, NavMode.Rail));

        Assert.DoesNotContain(JSInterop.Invocations, i => i.Identifier == "localStorage.getItem" && Equals(i.Arguments[0], SidebarKey));
        Assert.DoesNotContain(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.sidebarChanged");
        Assert.False(cut.FindComponent<MudDrawer>().Instance.Open);
    }

    [Fact]
    public void RailWithABottomBarOnAPhoneHasNoHamburgerAndNoDrawer()
    {
        var cut = RenderLayout(mobile: true, p =>
        {
            p.Add(c => c.NavMode, NavMode.Rail);
            p.Add(c => c.BottomBar, BottomBarFragment);
        });

        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Empty(cut.FindAll(".fbc-sidebar"));
        Assert.Single(cut.FindAll(".fbc-bottombar .tab-item"));
    }

    [Fact]
    public void RailWithoutABottomBarOnAPhoneKeepsTheHamburgerAndATemporaryDrawer()
    {
        var cut = RenderLayout(mobile: true, p => p.Add(c => c.NavMode, NavMode.Rail));

        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
        Assert.Equal(DrawerVariant.Temporary, cut.FindComponent<MudDrawer>().Instance.Variant);
        Assert.DoesNotContain("fbc-sidebar-rail", cut.Find(".fbc-sidebar").ClassName);
        Assert.Empty(cut.FindAll(".fbc-bottombar"));
    }

    [Fact]
    public async Task ResizingFromPhoneToDesktopSwitchesBetweenTheBottomBarAndTheRail()
    {
        var cut = RenderLayout(mobile: true, p =>
        {
            p.Add(c => c.NavMode, NavMode.Rail);
            p.Add(c => c.BottomBar, BottomBarFragment);
        });
        Assert.Single(cut.FindAll(".fbc-bottombar"));

        await cut.InvokeAsync(() => cut.Instance.OnMobileChanged(false));

        Assert.Empty(cut.FindAll(".fbc-bottombar"));
        Assert.Contains("fbc-sidebar-rail", cut.Find(".fbc-sidebar").ClassName);
        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
    }

    // ---- BottomBar ----

    [Fact]
    public void BottomBarIsRenderedOutsideTheMainContentAndMarksThePage()
    {
        var cut = RenderLayout(mobile: true, p => p.Add(c => c.BottomBar, BottomBarFragment));

        Assert.Empty(cut.FindAll("main .fbc-bottombar"));
        Assert.Empty(cut.FindAll(".mud-main-content .fbc-bottombar"));
        Assert.NotNull(cut.Find("div.mud-layout > .fbc-bottombar"));
        Assert.Contains("fbc-has-bottombar", cut.Find("div.mud-layout").ClassName);
        // フッターは本文の外のまま（下のタブバーに隠れないよう、余白は CSS が持つ）
        Assert.NotNull(cut.Find("footer.fbc-footer"));
    }

    [Fact]
    public void BottomBarIsPhoneOnly()
    {
        var cut = RenderLayout(mobile: false, p => p.Add(c => c.BottomBar, BottomBarFragment));

        Assert.Empty(cut.FindAll(".fbc-bottombar"));
        Assert.DoesNotContain("fbc-has-bottombar", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void BottomBarWithTheDrawerModeKeepsTheHamburger()
    {
        var cut = RenderLayout(mobile: true, p => p.Add(c => c.BottomBar, BottomBarFragment));

        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
        Assert.NotNull(cut.Find(".fbc-sidebar"));
    }

    [Fact]
    public void BottomBarWorksWithMobilePageScroll()
    {
        var cut = RenderLayout(mobile: true, p =>
        {
            p.Add(c => c.BottomBar, BottomBarFragment);
            p.Add(c => c.MobilePageScroll, true);
        });

        var classes = cut.Find("div.mud-layout").ClassName!;
        Assert.Contains("fbc-page-scroll", classes);
        Assert.Contains("fbc-has-bottombar", classes);
    }

    // ---- NavMode と ShowDrawer ----

    [Fact]
    public void NavModeTopBehavesLikeShowDrawerFalse()
    {
        var cut = RenderLayout(mobile: false, p =>
        {
            p.Add(c => c.NavMode, NavMode.Top);
            p.Add(c => c.TopNav, TopNavFragment);
        });

        Assert.Empty(cut.FindAll(".fbc-sidebar"));
        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Single(cut.FindAll("header .fbc-topnav-link"));
        Assert.Contains("fbc-no-drawer", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void NavModeDrawerWinsOverShowDrawerFalse()
    {
        var cut = RenderLayout(mobile: false, p =>
        {
            p.Add(c => c.NavMode, NavMode.Drawer);
            p.Add(c => c.ShowDrawer, false);
        });

        Assert.NotNull(cut.Find(".fbc-sidebar"));
        Assert.DoesNotContain("fbc-no-drawer", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void NavModeTopWinsOverShowDrawerTrue()
    {
        var cut = RenderLayout(mobile: false, p =>
        {
            p.Add(c => c.NavMode, NavMode.Top);
            p.Add(c => c.ShowDrawer, true);
        });

        Assert.Empty(cut.FindAll(".fbc-sidebar"));
    }

    [Fact]
    public void ShowDrawerFalseAloneStillMeansTop()
    {
        var cut = RenderLayout(mobile: false, p =>
        {
            p.Add(c => c.ShowDrawer, false);
            p.Add(c => c.TopNav, TopNavFragment);
        });

        Assert.Empty(cut.FindAll(".fbc-sidebar"));
        Assert.Single(cut.FindAll("header .fbc-topnav-link"));
    }

    [Fact]
    public void NavModeTopOnAPhoneStillCollapsesTheTopNavIntoTheMenu()
    {
        var cut = RenderLayout(mobile: true, p =>
        {
            p.Add(c => c.NavMode, NavMode.Top);
            p.Add(c => c.CollapseTopNavOnMobile, true);
            p.Add(c => c.TopNav, TopNavFragment);
        });

        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
        Assert.Single(cut.FindAll(".fbc-sidebar .fbc-topnav-link"));
    }

    [Fact]
    public void NavModeNoneDrawsNeitherTheSidebarNorTheTopNav()
    {
        var cut = RenderLayout(mobile: false, p =>
        {
            p.Add(c => c.NavMode, NavMode.None);
            p.Add(c => c.TopNav, TopNavFragment);
        });

        Assert.Empty(cut.FindAll(".fbc-sidebar"));
        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Empty(cut.FindAll(".fbc-topnav-link"));
        Assert.Contains("fbc-no-drawer", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void NavModeNoneOnAPhoneHasNoMenuEvenWithCollapse()
    {
        var cut = RenderLayout(mobile: true, p =>
        {
            p.Add(c => c.NavMode, NavMode.None);
            p.Add(c => c.CollapseTopNavOnMobile, true);
            p.Add(c => c.TopNav, TopNavFragment);
        });

        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Empty(cut.FindAll(".fbc-sidebar"));
    }

    // ---- DrawerClipMode ----

    [Fact]
    public void FullHeightMakesTheDesktopSidebarClipNeverAndMarksThePage()
    {
        var cut = RenderLayout(mobile: false, p => p.Add(c => c.DrawerClipMode, SiteDrawerClipMode.FullHeight));

        var drawer = cut.FindComponent<MudDrawer>().Instance;
        Assert.Equal(DrawerClipMode.Never, drawer.ClipMode);
        Assert.Equal(DrawerVariant.Mini, drawer.Variant);
        // 広げたサイドバーがハンバーガーを覆わないよう、マウスを乗せて広げる動きは使わない
        Assert.False(drawer.OpenMiniOnHover);
        Assert.Contains("fbc-clip-full", cut.Find("div.mud-layout").ClassName);
        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
    }

    [Fact]
    public void FullHeightDoesNotChangeThePhone()
    {
        var cut = RenderLayout(mobile: true, p => p.Add(c => c.DrawerClipMode, SiteDrawerClipMode.FullHeight));

        var drawer = cut.FindComponent<MudDrawer>().Instance;
        Assert.Equal(DrawerVariant.Temporary, drawer.Variant);
        Assert.Equal(DrawerClipMode.Never, drawer.ClipMode);
        Assert.DoesNotContain("fbc-clip-full", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void FullHeightWithoutADrawerDoesNothing()
    {
        var cut = RenderLayout(mobile: false, p =>
        {
            p.Add(c => c.NavMode, NavMode.Top);
            p.Add(c => c.DrawerClipMode, SiteDrawerClipMode.FullHeight);
        });

        Assert.DoesNotContain("fbc-clip-full", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void FullHeightKeepsTheSavedOpenStateAndToggles()
    {
        var cut = RenderLayout(mobile: false, p => p.Add(c => c.DrawerClipMode, SiteDrawerClipMode.FullHeight));
        Assert.True(cut.FindComponent<MudDrawer>().Instance.Open);

        cut.Find(".fbc-menu-toggle").Click();

        Assert.False(cut.FindComponent<MudDrawer>().Instance.Open);
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.sidebarChanged" && i.Arguments[0] is true);
    }
}

public class SiteRailNavTests : BlazorComponentTestContext
{
    private static readonly IReadOnlyList<SiteNavGroup> Groups = new[]
    {
        new SiteNavGroup(null, new[]
        {
            new SiteNavItem("", "ホーム", Icons.Material.Filled.Home),
            new SiteNavItem("commands", "コマンド", Icons.Material.Filled.Terminal),
            new SiteNavItem("speed", "素早さ", Icons.Material.Filled.Speed, Disabled: true, Title: "未対応です"),
        }),
        new SiteNavGroup("サポート", new[] { new SiteNavItem("report", "連絡") }),
    };

    private void NavigateTo(string relative) => Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/" + relative);

    [Fact]
    public void RendersALabelledNavWithIconAndLabelPerItem()
    {
        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));

        Assert.Equal("メインメニュー", cut.Find("nav").GetAttribute("aria-label"));
        var links = cut.FindAll("a.fbc-rail-link");
        Assert.Equal(3, links.Count);
        Assert.Equal("ホーム", links[0].QuerySelector(".fbc-rail-label")!.TextContent);
        Assert.Equal("true", links[0].QuerySelector(".fbc-rail-icon")!.GetAttribute("aria-hidden"));
        Assert.NotNull(links[0].QuerySelector(".fbc-rail-icon svg"));
        // 見出しは出さない
        Assert.DoesNotContain("サポート", cut.Markup);
    }

    [Fact]
    public void TheAriaLabelCanBeChanged()
    {
        var cut = Render<SiteRailNav>(p =>
        {
            p.Add(c => c.Groups, Groups);
            p.Add(c => c.AriaLabel, "タブ");
        });

        Assert.Equal("タブ", cut.Find("nav").GetAttribute("aria-label"));
    }

    [Fact]
    public void OnlyTheCurrentPageGetsAriaCurrentAndActive()
    {
        NavigateTo("commands");

        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));

        var current = cut.FindAll("[aria-current='page']");
        Assert.Single(current);
        Assert.Equal("コマンド", current[0].QuerySelector(".fbc-rail-label")!.TextContent);
        Assert.Contains("active", current[0].ClassName);
        Assert.Single(cut.FindAll(".fbc-rail-link.active"));
    }

    [Fact]
    public void HomeIsCurrentOnlyOnTheHomePage()
    {
        NavigateTo("");
        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));
        Assert.Equal("ホーム", cut.Find("[aria-current='page'] .fbc-rail-label").TextContent);

        NavigateTo("commands");
        cut.Render();
        Assert.Equal("コマンド", cut.Find("[aria-current='page'] .fbc-rail-label").TextContent);
    }

    [Fact]
    public void ADeeperPageKeepsItsSectionCurrent()
    {
        NavigateTo("commands/ban?x=1#top");

        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));

        Assert.Equal("コマンド", cut.Find("[aria-current='page'] .fbc-rail-label").TextContent);
    }

    [Fact]
    public void AnExactItemIsCurrentOnlyOnItsOwnPage()
    {
        var groups = new[] { new SiteNavGroup(null, new[] { new SiteNavItem("guide", "ガイド", null, Exact: true), new SiteNavItem("guide/basics", "基本") }) };
        NavigateTo("guide/basics");

        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, groups));

        var current = cut.FindAll("[aria-current='page']");
        Assert.Single(current);
        Assert.Equal("基本", current[0].QuerySelector(".fbc-rail-label")!.TextContent);
    }

    [Fact]
    public void ASiblingWithTheSamePrefixIsNotCurrent()
    {
        NavigateTo("commandsx");

        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));

        Assert.Empty(cut.FindAll("[aria-current]"));
    }

    [Fact]
    public void DisabledItemsAreNotLinks()
    {
        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));

        var disabled = cut.Find(".fbc-rail-link-disabled");
        Assert.Equal("span", disabled.TagName.ToLowerInvariant());
        Assert.Equal("true", disabled.GetAttribute("aria-disabled"));
        Assert.Null(disabled.GetAttribute("href"));
    }

    [Fact]
    public void AnItemWithoutAnIconRendersNoIcon()
    {
        var cut = Render<SiteRailNav>(p => p.Add(c => c.Groups, Groups));

        var link = cut.FindAll("a.fbc-rail-link").Last();
        Assert.Null(link.QuerySelector(".fbc-rail-icon svg"));
    }
}

public class SiteTopNavTests : BlazorComponentTestContext
{
    private static readonly IReadOnlyList<SiteNavItem> Items = new[]
    {
        new SiteNavItem("", "ホーム"),
        new SiteNavItem("guide", "ガイド"),
        new SiteNavItem("tools", "ツール"),
        new SiteNavItem("faq", "よくある質問"),
        new SiteNavItem("future", "準備中", Disabled: true),
    };

    private void NavigateTo(string relative) => Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/" + relative);

    private IRenderedComponent<SiteTopNav> RenderNav(bool collapsed = false, int? visible = null, int? collapseBelow = null)
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchWidth", _ => true).SetResult(collapsed);
        return Render<SiteTopNav>(p =>
        {
            p.Add(c => c.Items, Items);
            if (visible is not null) p.Add(c => c.VisibleCount, visible);
            if (collapseBelow is not null) p.Add(c => c.CollapseBelowPx, collapseBelow.Value);
        });
    }

    [Fact]
    public void ShowsAllItemsInlineByDefaultWithoutAMoreButton()
    {
        var cut = RenderNav();

        Assert.Equal(5, cut.FindAll(".fbc-topnav-list li").Count);
        Assert.Empty(cut.FindAll(".fbc-topnav-more"));
        Assert.Equal("メインメニュー", cut.Find("nav").GetAttribute("aria-label"));
    }

    [Fact]
    public void TheCurrentPageGetsAriaCurrentAutomatically()
    {
        NavigateTo("guide/basics");

        var cut = RenderNav();

        var current = cut.FindAll("[aria-current='page']");
        Assert.Single(current);
        Assert.Equal("ガイド", current[0].TextContent);
        Assert.Contains("active", current[0].ClassName);
    }

    [Fact]
    public void TheHomeItemIsCurrentOnlyOnTheHomePage()
    {
        NavigateTo("");
        var cut = RenderNav();
        Assert.Equal("ホーム", cut.Find("[aria-current='page']").TextContent);

        NavigateTo("tools");
        cut.Render();
        Assert.Equal("ツール", cut.Find("[aria-current='page']").TextContent);
    }

    [Fact]
    public void VisibleCountMovesTheRestIntoTheMoreMenu()
    {
        var cut = RenderNav(visible: 2);

        Assert.Equal(2, cut.FindAll(".fbc-topnav-list a").Count);
        var panel = cut.Find(".fbc-topnav-panel");
        Assert.Equal(3, panel.QuerySelectorAll("li").Length);
        Assert.Equal("もっと見る", cut.Find(".fbc-topnav-more-toggle span").TextContent);
        Assert.Equal("false", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
        Assert.True(panel.HasAttribute("hidden"));
    }

    [Fact]
    public void TheMoreButtonIsMarkedActiveWhenTheCurrentPageIsInsideIt()
    {
        NavigateTo("faq");

        var cut = RenderNav(visible: 2);

        Assert.Contains("active", cut.Find(".fbc-topnav-more-toggle").ClassName);
        Assert.Equal("よくある質問", cut.Find(".fbc-topnav-panel [aria-current='page']").TextContent);
    }

    [Fact]
    public void BelowTheCollapseWidthEverythingIsInTheMoreMenu()
    {
        var cut = RenderNav(collapsed: true, collapseBelow: 900);

        Assert.Empty(cut.FindAll(".fbc-topnav-list"));
        Assert.Equal(5, cut.FindAll(".fbc-topnav-panel li").Count);
        var call = JSInterop.Invocations.Single(i => i.Identifier == "faraBlazorComponent.watchWidth");
        Assert.Equal(900, call.Arguments[2]);
    }

    [Fact]
    public void TheCollapseWidthDefaultsTo768()
    {
        RenderNav();

        Assert.Equal(768, JSInterop.Invocations.Single(i => i.Identifier == "faraBlazorComponent.watchWidth").Arguments[2]);
    }

    [Fact]
    public async Task ResizingAcrossTheWidthSwitchesTheLayoutAndClosesTheMenu()
    {
        var cut = RenderNav(visible: 3);
        cut.Find(".fbc-topnav-more-toggle").Click();
        Assert.Equal("true", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));

        await cut.InvokeAsync(() => cut.Instance.OnCollapsedChanged(true));

        Assert.Empty(cut.FindAll(".fbc-topnav-list"));
        Assert.Equal("false", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
    }

    [Fact]
    public void ClickingTheMoreButtonTogglesTheMenuAndTellsTheScript()
    {
        var cut = RenderNav(visible: 2);
        var toggle = cut.Find(".fbc-topnav-more-toggle");
        Assert.Equal(cut.Find(".fbc-topnav-panel").Id, toggle.GetAttribute("aria-controls"));
        Assert.Equal("true", toggle.GetAttribute("aria-haspopup"));

        toggle.Click();

        Assert.Equal("true", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
        Assert.False(cut.Find(".fbc-topnav-panel").HasAttribute("hidden"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.dropdownOpen");

        cut.Find(".fbc-topnav-more-toggle").Click();

        Assert.Equal("false", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.dropdownClose");
    }

    [Fact]
    public void EscapeClosesTheMenuAndReturnsFocusToTheButton()
    {
        var cut = RenderNav(visible: 2);
        var toggleId = cut.Find(".fbc-topnav-more-toggle").Id;
        cut.Find(".fbc-topnav-more-toggle").Click();

        cut.Find(".fbc-topnav-more").KeyDown(new KeyboardEventArgs { Key = "Escape" });

        Assert.Equal("false", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusById" && Equals(i.Arguments[0], toggleId));
    }

    [Fact]
    public void OtherKeysDoNotCloseTheMenu()
    {
        var cut = RenderNav(visible: 2);
        cut.Find(".fbc-topnav-more-toggle").Click();

        cut.Find(".fbc-topnav-more").KeyDown(new KeyboardEventArgs { Key = "ArrowDown" });

        Assert.Equal("true", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
    }

    [Fact]
    public async Task AnOutsideClickFromTheScriptClosesTheMenu()
    {
        var cut = RenderNav(visible: 2);
        cut.Find(".fbc-topnav-more-toggle").Click();

        await cut.InvokeAsync(() => cut.Instance.CloseFromOutside());

        Assert.Equal("false", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
    }

    [Fact]
    public void MovingToAnotherPageClosesTheMenuAndUpdatesTheCurrentItem()
    {
        var cut = RenderNav(visible: 2);
        cut.Find(".fbc-topnav-more-toggle").Click();

        NavigateTo("tools");
        cut.Render();

        Assert.Equal("false", cut.Find(".fbc-topnav-more-toggle").GetAttribute("aria-expanded"));
        Assert.Equal("ツール", cut.Find("[aria-current='page']").TextContent);
    }

    [Fact]
    public void DisabledItemsAreNotLinks()
    {
        var cut = RenderNav();

        var disabled = cut.Find(".fbc-topnav-link-disabled");
        Assert.Equal("span", disabled.TagName.ToLowerInvariant());
        Assert.Equal("true", disabled.GetAttribute("aria-disabled"));
    }

    [Fact]
    public void DisposingRemovesTheWidthWatchWithTheSameKey()
    {
        var cut = RenderNav();
        var key = JSInterop.Invocations.Single(i => i.Identifier == "faraBlazorComponent.watchWidth").Arguments[1];

        ((IDisposable)cut.Instance).Dispose();

        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.unwatchWidth" && Equals(i.Arguments[0], key));
    }

    [Fact]
    public void WorksInsideTheSiteLayoutTopNavSlot()
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(false);
        JSInterop.Setup<bool>("faraBlazorComponent.watchWidth", _ => true).SetResult(false);
        NavigateTo("guide");

        var cut = Render<SiteLayout>(p =>
        {
            p.Add(c => c.NavMode, NavMode.Top);
            p.Add(c => c.TopNav, builder =>
            {
                builder.OpenComponent<SiteTopNav>(0);
                builder.AddAttribute(1, "Items", Items);
                builder.CloseComponent();
            });
        });

        Assert.Equal("ガイド", cut.Find("header [aria-current='page']").TextContent);
    }
}
