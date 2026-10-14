using J3D.Web.Client.Components;
using J3D.Web.Client.Layout;
using Microsoft.AspNetCore.Components;

namespace J3D.Web.Client.Tests.Components;

public sealed class AboutDialogTests : BunitTestBase
{
    [Fact]
    public void The_app_bar_opens_About_with_every_third_party_component()
    {
        var cut = Render<MainLayout>(parameters => parameters.Add(layout => layout.Body, (RenderFragment)(_ => { })));

        cut.Find("[data-testid=about-button]").Click();

        var dialog = cut.WaitForElement("[data-testid=about-dialog]");
        Assert.Contains("CAD files never leave your machine", dialog.TextContent, StringComparison.Ordinal);
        var rows = dialog.QuerySelectorAll("[data-testid=third-party] tbody tr");
        Assert.Equal(
            ThirdParty.Components.Select(static c => $"{c.Name}|{c.Version}|{c.Licence}"),
            rows.Select(static row => string.Join('|', row.QuerySelectorAll("td").Select(static td => td.TextContent.Trim()))));
        Assert.Equal(
            ThirdParty.Components.Select(static c => c.Url),
            rows.Select(static row => row.QuerySelector("a")!.GetAttribute("href")));

        var links = dialog.QuerySelectorAll("a").Select(static a => a.GetAttribute("href")).ToList();
        Assert.Contains(AboutDialog.OcctRecipeUrl, links);
        Assert.Contains(AboutDialog.NoticesUrl, links);
        Assert.Contains(AboutDialog.RepositoryUrl, links);
    }

    [Fact]
    public void Close_closes_it()
    {
        var cut = Render<MainLayout>(parameters => parameters.Add(layout => layout.Body, (RenderFragment)(_ => { })));
        cut.Find("[data-testid=about-button]").Click();

        cut.WaitForElement("[data-testid=about-close]").Click();

        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=about-dialog]")));
    }

    [Theory]
    [InlineData("1.0.0+55092bbf1e2d3c4b5a6978", "55092bb")]
    [InlineData("1.0.0+abc", "abc")]
    [InlineData("1.0.0+", null)]
    [InlineData("1.0.0", null)]
    [InlineData(null, null)]
    public void The_build_is_the_short_commit_from_the_informational_version(string? version, string? build) =>
        Assert.Equal(build, AboutDialog.CommitOf(version));
}
