using Bunit;
using FaraBlazorComponent.Razor.Components;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

public class NotFoundViewTests : BlazorComponentTestContext
{
    [Fact]
    public void ShowsTheCodeTitleLeadAndAHomeButton()
    {
        var cut = Render<NotFoundView>();

        Assert.Equal("404", cut.Find(".fbc-not-found-code").TextContent);
        Assert.Equal("ページが見つかりません", cut.Find("h1").TextContent);
        Assert.Equal("URL が間違っているか、ページが移動した可能性があります。", cut.Find(".fbc-not-found-lead").TextContent);
        var home = cut.Find("a.fbc-btn-primary");
        Assert.Equal("./", home.GetAttribute("href"));
        Assert.Contains("ホームへ戻る", home.TextContent);
    }

    [Fact]
    public void HomeLinkAndTextAreParameters()
    {
        var cut = Render<NotFoundView>(p =>
        {
            p.Add(c => c.HomeHref, "/top/");
            p.Add(c => c.HomeText, "トップへ");
        });

        var home = cut.Find("a.fbc-btn-primary");
        Assert.Equal("/top/", home.GetAttribute("href"));
        Assert.Contains("トップへ", home.TextContent);
    }

    [Fact]
    public void NoIndexIsOnByDefault()
    {
        Assert.True(Render<NotFoundView>().Instance.NoIndex);
    }

    [Fact]
    public void LongTitleIsRenderedWhole()
    {
        var title = new string('長', 150);
        var cut = Render<NotFoundView>(p => p.Add(c => c.Title, title));

        Assert.Equal(title, cut.Find("h1").TextContent);
    }
}
