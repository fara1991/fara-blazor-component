using Bunit;
using FaraSiteKit.Core;
using FaraSiteKit.Razor.Components;
using Microsoft.AspNetCore.Components;
using Xunit;

namespace FaraSiteKit.Razor.Tests;

public class MaintenanceTests : SiteKitTestContext
{
    private static MaintenanceInfo Notice(string message) => new(MaintenanceState.Notice, message);

    [Fact]
    public void BannerShowsTheNoticeWithItsHeadingAndText()
    {
        var cut = Render<MaintenanceBanner>(p => p.Add(c => c.Info, Notice("6 月 1 日 2:00〜")));

        Assert.Equal("【お知らせ】", cut.Find(".fsk-notice-title").TextContent);
        Assert.Equal("6 月 1 日 2:00〜", cut.Find(".fsk-notice-text").TextContent);
        Assert.Equal("status", cut.Find(".fsk-notice").GetAttribute("role"));
    }

    [Fact]
    public void BannerUsesTheDefaultTextWhenTheMessageIsEmpty()
    {
        var cut = Render<MaintenanceBanner>(p => p.Add(c => c.Info, Notice("   ")));

        Assert.Equal("まもなくメンテナンスを行います。", cut.Find(".fsk-notice-text").TextContent);
    }

    [Theory]
    [InlineData(MaintenanceState.Off)]
    [InlineData(MaintenanceState.On)]
    public void BannerIsHiddenWhenTheStateIsNotNotice(MaintenanceState state)
    {
        var cut = Render<MaintenanceBanner>(p => p.Add(c => c.Info, new MaintenanceInfo(state, "x")));

        Assert.Empty(cut.FindAll(".fsk-notice"));
    }

    [Fact]
    public void BannerIsHiddenWithoutAnInfo()
    {
        var cut = Render<MaintenanceBanner>();

        Assert.Empty(cut.FindAll(".fsk-notice"));
    }

    [Fact]
    public void LongNoticeTextIsRenderedWhole()
    {
        var text = new string('文', 1000);
        var cut = Render<MaintenanceBanner>(p => p.Add(c => c.Info, Notice(text)));

        Assert.Equal(text, cut.Find(".fsk-notice-text").TextContent);
    }

    [Fact]
    public void LayoutShowsTheNoticeAboveTheContent()
    {
        var cut = Render<SiteLayout>(p =>
        {
            p.Add(c => c.Maintenance, Notice("お知らせ本文"));
            p.Add(c => c.Body, builder => builder.AddMarkupContent(0, "<p class=\"body-text\">本文</p>"));
        });

        Assert.Equal("お知らせ本文", cut.Find("main .fsk-notice-text").TextContent);
        Assert.Equal("本文", cut.Find("main article .body-text").TextContent);
        Assert.NotNull(cut.Find("footer.fsk-footer"));
        Assert.Empty(cut.FindAll("main footer"));
    }

    [Fact]
    public void ScreenShowsTheDefaultHeadingAndTheScheduleWhenThereIsOne()
    {
        var cut = Render<MaintenanceScreen>(p => p.Add(c => c.Info, new MaintenanceInfo(MaintenanceState.On, "6 月 1 日 2:00〜 まで")));

        Assert.Equal("ただいまメンテナンス中です", cut.Find("main.fsk-maintenance h1").TextContent);
        Assert.Equal("6 月 1 日 2:00〜 まで", cut.Find(".fsk-maintenance-schedule").TextContent);
    }

    [Fact]
    public void ScreenHasNoScheduleLineWithoutAMessage()
    {
        var cut = Render<MaintenanceScreen>(p => p.Add(c => c.Info, new MaintenanceInfo(MaintenanceState.On, "")));

        Assert.Empty(cut.FindAll(".fsk-maintenance-schedule"));
    }

    [Fact]
    public void ScreenShowsTheSiteContactAndCustomHeading()
    {
        var cut = Render<MaintenanceScreen>(p =>
        {
            p.Add(c => c.Heading, "工事中");
            p.Add(c => c.Contact, builder => builder.AddMarkupContent(0, "<a class=\"fsk-maintenance-link\" href=\"https://example.test/x\">@contact</a>"));
        });

        Assert.Equal("工事中", cut.Find("h1").TextContent);
        Assert.Equal("@contact", cut.Find("a.fsk-maintenance-link").TextContent);
    }

    [Fact]
    public void ScreenLeadIsPlainTextAndOnlyNewlinesBecomeLineBreaks()
    {
        var cut = Render<MaintenanceScreen>(p => p.Add(c => c.Lead, "一行目\n<b>太字にしない</b>"));

        Assert.Single(cut.FindAll("p br"));
        Assert.Empty(cut.FindAll("b"));
        Assert.Contains("&lt;b&gt;太字にしない&lt;/b&gt;", cut.Markup);
    }
}
