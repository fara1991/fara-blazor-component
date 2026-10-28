using FaraBlazorComponent.Core;
using Xunit;

namespace FaraBlazorComponent.Core.Tests;

public class SiteLinksTests
{
    public SiteLinksTests() => SiteLinks.DevelopHost = "site-dev.fara-labs.com";

    [Theory]
    [InlineData("site-dev.fara-labs.com", "https://fara-labs.com/", "https://dev.fara-labs.com/")]
    [InlineData("SITE-DEV.fara-labs.com", "https://fara-labs.com/", "https://dev.fara-labs.com/")]
    [InlineData("site.fara-labs.com", "https://fara-labs.com/", "https://fara-labs.com/")]
    [InlineData("localhost", "https://fara-labs.com/", "https://fara-labs.com/")]
    [InlineData("", "https://fara-labs.com/", "https://fara-labs.com/")]
    [InlineData("site-dev.fara-labs.com", "https://github.com/fara1991/fara-blazor-component", "https://github.com/fara1991/fara-blazor-component")]
    [InlineData("site-dev.fara-labs.com", "https://twitter.com/game_fara", "https://twitter.com/game_fara")]
    [InlineData("site-dev.fara-labs.com", "https://avatar.fara-labs.com/guide?x=1", "https://avatar-dev.fara-labs.com/guide?x=1")]
    [InlineData("site-dev.fara-labs.com", "https://dev.fara-labs.com/", "https://dev.fara-labs.com/")]
    [InlineData("site-dev.fara-labs.com", "https://avatar-dev.fara-labs.com/", "https://avatar-dev.fara-labs.com/")]
    public void Localize_switches_by_host(string host, string url, string expected)
        => Assert.Equal(expected, SiteLinks.Localize(url, host));

    [Fact]
    public void Nothing_is_switched_when_the_site_has_no_develop_host()
    {
        SiteLinks.DevelopHost = "";
        Assert.False(SiteLinks.IsDevelop("site-dev.fara-labs.com"));
        Assert.Equal("https://fara-labs.com/", SiteLinks.Localize("https://fara-labs.com/", "site-dev.fara-labs.com"));
    }

    [Fact]
    public void A_null_develop_host_does_not_throw_and_switches_nothing()
    {
        SiteLinks.DevelopHost = null!;
        Assert.False(SiteLinks.IsDevelop("site-dev.fara-labs.com"));
        Assert.Equal("https://fara-labs.com/", SiteLinks.Localize("https://fara-labs.com/", "site-dev.fara-labs.com"));
    }

    [Fact]
    public void Localize_uses_the_current_host_when_no_host_is_given()
    {
        var before = SiteLinks.CurrentHost;
        try
        {
            SiteLinks.CurrentHost = "site-dev.fara-labs.com";
            Assert.Equal("https://dev.fara-labs.com/", SiteLinks.Localize("https://fara-labs.com/"));
        }
        finally
        {
            SiteLinks.CurrentHost = before;
        }
    }
}
