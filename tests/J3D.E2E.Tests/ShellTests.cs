using Microsoft.Playwright;
using Microsoft.Playwright.Xunit.v3;

namespace J3D.E2E.Tests;

public sealed class ShellTests(J3DAppFixture app) : PageTest, IClassFixture<J3DAppFixture>
{
    [Fact]
    public async Task Shell_loads_cross_origin_isolated_and_starts_the_viewer()
    {
        await Page.GotoAsync(app.BaseAddress.ToString());

        await Expect(Page).ToHaveTitleAsync("J3D");
        // A cold Blazor WebAssembly start can take longer than Playwright's default 5 s on a CI runner
        // that is also running the other test classes in parallel.
        await Expect(Page.GetByTestId("viewport")).ToHaveAttributeAsync(
            "data-viewer-ready", "true", new LocatorAssertionsToHaveAttributeOptions { Timeout = 30_000 });
        Assert.True(await Page.EvaluateAsync<bool>("() => self.crossOriginIsolated"));
    }

    /// <summary>D135: below about 1,100 px, Import, Export and Fit all keep only their icons, so the app bar stays one line.</summary>
    [Theory]
    [InlineData(1280, true)]
    [InlineData(1000, false)]
    public async Task The_app_bar_stays_on_one_line(int width, bool labelled)
    {
        await Page.SetViewportSizeAsync(width, 800);
        await Page.GotoAsync(app.BaseAddress.ToString());
        var fitAll = Page.GetByTestId("fit-all-button");
        await Expect(fitAll).ToBeEnabledAsync(new LocatorAssertionsToBeEnabledOptions { Timeout = 30_000 });

        var box = (await fitAll.BoundingBoxAsync())!;
        Assert.True(box.Height < 45, $"Fit all should be one line high: {box.Height} px");
        var labelSize = await fitAll.Locator(".mud-button-label").EvaluateAsync<string>("label => getComputedStyle(label).fontSize");
        Assert.Equal(labelled, labelSize != "0px");
        var bar = (await Page.Locator(".j3d-appbar").BoundingBoxAsync())!;
        Assert.True(bar.Height < 70, $"the app bar should be one row: {bar.Height} px");
    }
}
