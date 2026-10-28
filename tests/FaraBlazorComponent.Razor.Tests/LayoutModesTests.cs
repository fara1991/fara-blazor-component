#pragma warning disable MUD0012
using Bunit;
using FaraBlazorComponent.Core;
using FaraBlazorComponent.Razor.Components;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

/// <summary>上部ナビだけの構成、検索の欄の Esc、起動時の設定の確認、フッターの位置、リンクの安全さ。</summary>
public class LayoutModesTests : BlazorComponentTestContext
{
    private static RenderFragment TopNavFragment => builder =>
    {
        builder.OpenElement(0, "a");
        builder.AddAttribute(1, "class", "fbc-topnav-link");
        builder.AddAttribute(2, "href", "./");
        builder.AddContent(3, "ホーム");
        builder.CloseElement();
        builder.OpenElement(4, "a");
        builder.AddAttribute(5, "class", "fbc-topnav-link");
        builder.AddAttribute(6, "href", "works");
        builder.AddContent(7, "作品");
        builder.CloseElement();
    };

    private IRenderedComponent<SiteLayout> RenderTopNavOnly(bool mobile, bool collapse)
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(mobile);
        return Render<SiteLayout>(p =>
        {
            p.Add(c => c.Body, builder => builder.AddMarkupContent(0, "<p class=\"body-text\">本文</p>"));
            p.Add(c => c.ShowDrawer, false);
            p.Add(c => c.CollapseTopNavOnMobile, collapse);
            p.Add(c => c.TopNav, TopNavFragment);
        });
    }

    [Fact]
    public void WithoutADrawerThereIsNoSidebarAndNoMenuButton()
    {
        var cut = RenderTopNavOnly(mobile: false, collapse: false);

        Assert.Empty(cut.FindAll(".fbc-sidebar"));
        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Contains("fbc-no-drawer", cut.Find("div.mud-layout").ClassName);
    }

    [Fact]
    public void TopNavIsShownInTheHeaderOnDesktop()
    {
        var cut = RenderTopNavOnly(mobile: false, collapse: false);

        var links = cut.FindAll("header .fbc-topnav-link");
        Assert.Equal(2, links.Count);
        Assert.Equal("作品", links[1].TextContent);
    }

    [Fact]
    public void OnAPhoneTheTopNavStaysInTheHeaderWhenNotCollapsed()
    {
        var cut = RenderTopNavOnly(mobile: true, collapse: false);

        Assert.Equal(2, cut.FindAll("header .fbc-topnav-link").Count);
        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
    }

    [Fact]
    public void OnAPhoneWithCollapseTheTopNavBecomesAMenuDrawer()
    {
        var cut = RenderTopNavOnly(mobile: true, collapse: true);

        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
        Assert.Empty(cut.FindAll("header .fbc-topnav-link"));
        var drawer = cut.FindComponent<MudDrawer>().Instance;
        Assert.Equal(DrawerVariant.Temporary, drawer.Variant);
        Assert.False(drawer.Open);
        cut.Find(".fbc-menu-toggle").Click();
        Assert.True(cut.FindComponent<MudDrawer>().Instance.Open);
        Assert.Equal(2, cut.FindAll(".fbc-sidebar .fbc-topnav-link").Count);
    }

    [Fact]
    public void OnDesktopWithCollapseStillNoMenuAndTopNavInHeader()
    {
        var cut = RenderTopNavOnly(mobile: false, collapse: true);

        Assert.Empty(cut.FindAll(".fbc-menu-toggle"));
        Assert.Equal(2, cut.FindAll("header .fbc-topnav-link").Count);
    }

    [Fact]
    public void DrawerIsStillShownByDefault()
    {
        var cut = Render<SiteLayout>();

        Assert.Single(cut.FindAll(".fbc-menu-toggle"));
        Assert.NotNull(cut.Find(".fbc-sidebar"));
    }

    [Fact]
    public void EscapeInsideTheSearchSheetClosesItAndPutsFocusBackOnTheButton()
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(true);
        var cut = Render<SiteLayout>(p =>
        {
            p.Add(c => c.SearchSheet, (EventCallback _) => builder => builder.AddMarkupContent(0, "<input class=\"sheet-input\" />"));
        });
        cut.Find(".fbc-search-toggle").Click();
        Assert.Equal("true", cut.Find(".fbc-search-toggle").GetAttribute("aria-expanded"));

        cut.Find("#fbc-search-sheet .sheet-input").KeyDown(new KeyboardEventArgs { Key = "Escape" });

        Assert.Equal("false", cut.Find(".fbc-search-toggle").GetAttribute("aria-expanded"));
        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.searchSheet" && i.Arguments[0] is false);
    }

    [Fact]
    public void OtherKeysDoNotCloseTheSearchSheet()
    {
        JSInterop.Setup<bool>("faraBlazorComponent.watchMobile", _ => true).SetResult(true);
        var cut = Render<SiteLayout>(p => p.Add(c => c.SearchSheet, (EventCallback _) => builder => builder.AddMarkupContent(0, "<input class=\"sheet-input\" />")));
        cut.Find(".fbc-search-toggle").Click();

        cut.Find("#fbc-search-sheet .sheet-input").KeyDown(new KeyboardEventArgs { Key = "Enter" });

        Assert.Equal("true", cut.Find(".fbc-search-toggle").GetAttribute("aria-expanded"));
    }

    [Fact]
    public void TheLayoutAsksTheScriptToCheckTheStorageKeysOnceAfterTheFirstRender()
    {
        var cut = Render<SiteLayout>();

        var calls = JSInterop.Invocations.Where(i => i.Identifier == "faraBlazorComponent.checkConfig").ToList();
        Assert.Single(calls);
        Assert.Equal(Services.GetRequiredService<SiteOptions>().StorageKey, calls[0].Arguments[0]);
        Assert.Equal(Services.GetRequiredService<SiteOptions>().SidebarKey, calls[0].Arguments[1]);
        cut.Render();
        Assert.Single(JSInterop.Invocations.Where(i => i.Identifier == "faraBlazorComponent.checkConfig"));
    }

    [Fact]
    public void MovingToAPageMovesFocusToTheMainButTheFirstLoadDoesNot()
    {
        var cut = Render<SiteLayout>();
        Assert.DoesNotContain(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusMain");

        Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/report");
        cut.Render();

        Assert.Contains(JSInterop.Invocations, i => i.Identifier == "faraBlazorComponent.focusMain");
    }

    [Fact]
    public void TheFooterIsOutsideTheMainContentAsAContentInfo()
    {
        var cut = Render<SiteLayout>();

        Assert.Empty(cut.FindAll("main footer"));
        Assert.NotNull(cut.Find("footer.fbc-footer"));
    }
}

public class LinkSafetyTests : BlazorComponentTestContext
{
    [Theory]
    [InlineData("https://github.com/example", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("data:text/html,<script>x</script>", false)]
    [InlineData("http://example.com/", false)]
    [InlineData("mailto:someone@example.com", false)]
    [InlineData("//example.com/", false)]
    [InlineData("", false)]
    [InlineData("  ", false)]
    public void OnlyHttpsUrlsAreRendered(string url, bool expected)
    {
        Assert.Equal(expected, SocialLinks.IsSafeUrl(url));
    }

    [Fact]
    public void AJavascriptSocialUrlIsNotRenderedAtAll()
    {
        Services.GetRequiredService<SiteOptions>().Social.Add(new SiteSocialLink("github", "javascript:alert(1)"));

        var cut = Render<SocialLinks>();

        Assert.Empty(cut.FindAll("a"));
    }

    [Fact]
    public void FooterAuthorLinkFollowsTheRunningDevelopHost()
    {
        var options = Services.GetRequiredService<SiteOptions>();
        options.AuthorHomeUrl = "https://fara-labs.com/";
        options.DevelopHost = "localhost";
        try
        {
            var cut = Render<SiteFooter>();

            Assert.NotNull(cut.Find("a[href='https://dev.fara-labs.com/']"));
        }
        finally
        {
            SiteLinks.DevelopHost = "";
            SiteLinks.CurrentHost = "";
        }
    }
}

public class NavAccessibilityTests : BlazorComponentTestContext
{
    [Fact]
    public void DisabledItemsAreMarkedAriaDisabled()
    {
        var cut = Render<SiteNavMenu>(p => p.Add(c => c.Groups, new[]
        {
            new SiteNavGroup(null, new[] { new SiteNavItem("speed", "素早さ比較", null, Disabled: true) }),
        }));

        Assert.Equal("true", cut.Find(".mud-nav-link-disabled").GetAttribute("aria-disabled"));
    }
}
