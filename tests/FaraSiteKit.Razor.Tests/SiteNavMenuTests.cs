#pragma warning disable MUD0012
using Bunit;
using FaraSiteKit.Razor.Components;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Routing;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using Xunit;

namespace FaraSiteKit.Razor.Tests;

public class SiteNavMenuTests : SiteKitTestContext
{
    private static IReadOnlyList<SiteNavGroup> SampleGroups() => new[]
    {
        new SiteNavGroup(null, new[] { new SiteNavItem("", "ホーム", Icons.Material.Filled.Home) }),
        new SiteNavGroup("計算", new[]
        {
            new SiteNavItem("damage-calculator", "ダメージ計算機", Icons.Material.Filled.Calculate),
            new SiteNavItem("speed", "素早さ比較", Icons.Material.Filled.Speed, Disabled: true, Title: "未対応です"),
        }),
    };

    private IRenderedComponent<SiteNavMenu> Render(IReadOnlyList<SiteNavGroup>? groups = null) =>
        Render<SiteNavMenu>(p => p.Add(c => c.Groups, groups ?? SampleGroups()));

    [Fact]
    public void RendersTheSectionTitlesAndTheItems()
    {
        var cut = Render();

        Assert.Single(cut.FindAll(".nav-section"));
        Assert.Equal("計算", cut.Find(".nav-section").TextContent);
        Assert.Equal("ダメージ計算機", cut.Find("a[href='damage-calculator']").TextContent.Trim());
    }

    [Fact]
    public void DisabledItemHasNoLinkAndIsMarkedDisabled()
    {
        var cut = Render();

        var disabled = cut.Find(".mud-nav-link-disabled");
        Assert.Equal("素早さ比較", disabled.TextContent.Trim());
        Assert.Empty(cut.FindAll("a[href='speed']"));
    }

    [Fact]
    public void TheCurrentPageIsActive()
    {
        Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/damage-calculator");

        var cut = Render();

        Assert.Contains("active", cut.Find("a[href='damage-calculator']").ClassName);
    }

    [Fact]
    public void HomeIsActiveOnlyOnTheHomePage()
    {
        var cut = Render();
        Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/damage-calculator");
        Assert.DoesNotContain("active", cut.Find("a[href='']").ClassName ?? "");
    }

    [Fact]
    public void ItemWithoutATitleOrGroupTitleStillRenders()
    {
        var cut = Render(new[] { new SiteNavGroup(null, new[] { new SiteNavItem("x", "") }) });

        Assert.Empty(cut.FindAll(".nav-section"));
        Assert.NotNull(cut.Find("a[href='x']"));
    }

    [Fact]
    public void LongLabelIsRenderedWhole()
    {
        var label = new string('長', 120);
        var cut = Render(new[] { new SiteNavGroup(null, new[] { new SiteNavItem("long", label) }) });

        Assert.Equal(label, cut.Find("a[href='long']").TextContent.Trim());
    }

    [Fact]
    public void TopContentIsRenderedFirst()
    {
        var cut = Render<SiteNavMenu>(p =>
        {
            p.Add(c => c.Groups, SampleGroups());
            p.Add(c => c.Top, builder => builder.AddMarkupContent(0, "<div class=\"top-settings\">設定</div>"));
        });

        Assert.Equal("top-settings", cut.Find(".side-nav > *:first-child").ClassName);
    }

    [Fact]
    public void ItemsStayRealLinksSoBlazorNavigatesAndTheBrowserKnowsTheTarget()
    {
        var cut = Render();

        var link = cut.Find("a[href='damage-calculator']");
        Assert.Equal("damage-calculator", link.GetAttribute("href"));
    }
}
