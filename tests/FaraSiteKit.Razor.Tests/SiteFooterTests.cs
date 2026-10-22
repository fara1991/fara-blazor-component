#pragma warning disable MUD0012
using Bunit;
using FaraSiteKit.Core;
using FaraSiteKit.Razor.Components;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FaraSiteKit.Razor.Tests;

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

        var text = cut.Find(".site-footer").TextContent;
        Assert.Contains("テストサイト", text);
        Assert.Contains("© 2026", text);
        Assert.Equal("テスト作者", cut.Find(".site-footer a[href='https://example.test/']").TextContent);
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

        var links = cut.FindAll("a.site-footer-social");
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
    public void AuthorWithoutAHomepageIsPlainText()
    {
        Services.GetRequiredService<SiteOptions>().AuthorHomeUrl = "";

        var cut = RenderAt("");

        Assert.Empty(cut.FindAll(".site-footer a[href^='https://']"));
        Assert.Contains("テスト作者", cut.Find(".site-footer").TextContent);
    }
}
