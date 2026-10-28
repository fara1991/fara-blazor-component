using Xunit;

namespace FaraBlazorComponent.Core.Tests;

public class SiteOptionsTests
{
    [Fact]
    public void DefaultsDoNotContainSiteSpecificValues()
    {
        var options = new SiteOptions();
        Assert.Equal("", options.Name);
        Assert.Equal("", options.Author);
        Assert.Equal("", options.DevelopHost);
        Assert.Empty(options.Social);
    }

    [Fact]
    public void VisibleSocialSkipsEntriesWithoutUrl()
    {
        var options = new SiteOptions
        {
            Social =
            {
                new SiteSocialLink("github", "https://github.com/example"),
                new SiteSocialLink("twitter", ""),
                new SiteSocialLink("discord", "   "),
                new SiteSocialLink("twitch", "https://twitch.tv/example"),
            },
        };

        var visible = options.VisibleSocial.Select(s => s.Service).ToArray();

        Assert.Equal(new[] { "github", "twitch" }, visible);
    }
}
