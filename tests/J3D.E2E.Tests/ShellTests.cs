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
}
