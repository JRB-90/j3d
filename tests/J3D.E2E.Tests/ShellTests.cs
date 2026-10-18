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

    /// <summary>
    /// D135: below about 1,100 px, Import, Export and Fit all keep only their icons, so the app bar stays
    /// one line. Since M11 also at 900 px, with the projection toggle's labels unclipped; since M12 nothing
    /// in the bar is clipped and the toolbar ends before the About button.
    /// </summary>
    [Theory]
    [InlineData(1280, true)]
    [InlineData(1000, false)]
    [InlineData(900, false)]
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
        var clipped = await Page.Locator(".j3d-appbar .mud-toggle-item, .j3d-appbar button, .j3d-appbar label").EvaluateAllAsync<string[]>(
            "items => items.filter(item => item.scrollWidth > item.clientWidth + 1).map(item => item.dataset.testid || item.getAttribute('aria-label') || item.innerText)");
        Assert.Empty(clipped);

        // The toolbar ends before the About button (M12: at 900 px Redo had slid under it).
        var toolbarEnd = await Page.Locator(".j3d-toolbar > *").EvaluateAllAsync<double>("items => Math.max(...items.map(item => item.getBoundingClientRect().right))");
        var about = (await Page.GetByTestId("about-button").BoundingBoxAsync())!;
        Assert.True(toolbarEnd <= about.X, $"the toolbar should end before About: {toolbarEnd} > {about.X}");

        // The viewport fills the rest of the window: in M12 the context menu's inline anchor pushed the page
        // down a line, clipping the viewport's bottom and moving its centre off a whole pixel.
        var viewport = (await Page.GetByTestId("viewport").BoundingBoxAsync())!;
        Assert.Equal(800, viewport.Y + viewport.Height);
    }
}
