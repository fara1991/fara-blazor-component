#pragma warning disable MUD0012
using Bunit;
using FaraBlazorComponent.Core;
using FaraBlazorComponent.Razor.Components;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

public class SiteFooterTests : SiteKitTestContext
{
    private IRenderedComponent<SiteFooter> RenderAt(string path)
    {
        Services.GetRequiredService<NavigationManager>().NavigateTo("http://localhost/" + path);
        return Render<SiteFooter>();
    }

    [Fact]
    public void ShowsTheSiteNameAuthorAndYear()
    {
        var cut = RenderAt("");

        var text = cut.Find(".fbc-footer").TextContent;
        Assert.Contains("テストサイト", text);
        Assert.Contains("© 2026", text);
        Assert.Equal("テスト作者", cut.Find(".fbc-footer a[href='https://example.test/']").TextContent);
    }

    [Fact]
    public void ReportLinkCarriesTheCurrentPageAsFrom()
    {
        var cut = RenderAt("damage-calculator");

        Assert.Equal("report?from=%2Fdamage-calculator", cut.Find("a[href^='report']").GetAttribute("href"));
    }

    [Fact]
    public void ReportLinkOnTheReportOrPrivacyPageHasNoFrom()
    {
        Assert.Equal("report", RenderAt("report").Find("a[href^='report']").GetAttribute("href"));
        Assert.Equal("report", RenderAt("privacy").Find("a[href^='report']").GetAttribute("href"));
    }

    [Fact]
    public void ReportLinkWithAnUnsafePathHasNoFrom()
    {
        var cut = RenderAt("a%20b?x=<script>");

        Assert.Equal("report", cut.Find("a[href^='report']").GetAttribute("href"));
    }

    [Fact]
    public void PrivacyLinkUsesTheSitePath()
    {
        Services.GetRequiredService<SiteOptions>().PrivacyPath = "policy";

        var cut = RenderAt("");

        Assert.Equal("policy", cut.Find("a[href='policy']").GetAttribute("href"));
    }

    [Fact]
    public void SocialLinksOnlyShowServicesWithAUrl()
    {
        var options = Services.GetRequiredService<SiteOptions>();
        options.Social.Add(new SiteSocialLink("github", "https://github.com/example"));
        options.Social.Add(new SiteSocialLink("twitter", ""));

        var cut = RenderAt("");

        var links = cut.FindAll("a.fbc-footer-social");
        Assert.Single(links);
        Assert.Equal("GitHub", links[0].GetAttribute("aria-label"));
        Assert.Equal("noopener noreferrer", links[0].GetAttribute("rel"));
        Assert.Equal("_blank", links[0].GetAttribute("target"));
        Assert.Contains("--brand: #6e40c9", links[0].GetAttribute("style"));
        Assert.Equal("true", links[0].QuerySelector("svg")!.GetAttribute("aria-hidden"));
    }

    [Fact]
    public void SocialIconFallsBackToTheGitHubShapeForAnUnknownName()
    {
        var cut = Render<SocialIcon>(p => p.Add(c => c.Name, "unknown"));

        Assert.NotEmpty(cut.Find("svg path").GetAttribute("d") ?? "");
    }

    [Fact]
    public void EveryFooterTextLinkIsInTheLineThatThePhoneHitAreaRuleCovers()
    {
        // スマホの当たり判定（kit の CSS: .fbc-footer a:not(.fbc-footer-social)::after）は、.fbc-footer-line の中の文字リンクに掛ける。
        // 問い合わせ・プライバシーポリシー・作者の 3 つが、すべてその中にある（外に出すと CSS の規則から外れる）
        var cut = RenderAt("");

        var textLinks = cut.FindAll(".fbc-footer a:not(.fbc-footer-social)");
        Assert.Equal(3, textLinks.Count);
        Assert.All(textLinks, link => Assert.NotNull(link.Closest(".fbc-footer-line")));
    }

    [Fact]
    public void AuthorWithoutAHomepageIsPlainText()
    {
        Services.GetRequiredService<SiteOptions>().AuthorHomeUrl = "";

        var cut = RenderAt("");

        Assert.Empty(cut.FindAll(".fbc-footer a[href^='https://']"));
        Assert.Contains("テスト作者", cut.Find(".fbc-footer").TextContent);
    }
}
