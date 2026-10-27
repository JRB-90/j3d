using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M19's compact layout (D234), below 900 px wide or 500 px tall: the model list is a drawer over the view,
/// closing on a pick in the tree (D238); the panel is a sheet along the bottom that peeks and pulls up
/// (D236); the projection is in ⋮ (D240); and the toolbar's groups fold into ⋮ as the bar runs out of
/// room (D235). It's laid out by size alone, so these run in both browsers, with a mouse, at a phone's size;
/// <see cref="TouchTests"/> has a finger's sizes and gestures, in Chromium's phone and tablet emulation.
/// </summary>
public sealed class CompactLayoutTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int Pin = 3;
    private const int TopPlate = 2;

    public override BrowserNewContextOptions ContextOptions() => new() { ViewportSize = new() { Width = 412, Height = 915 } };

    [Fact]
    public async Task The_drawer_opens_over_the_view_and_a_pick_in_the_tree_closes_it()
    {
        var id = await LoadAsync("assembly.step");
        var drawer = Page.GetByTestId("drawer");
        await Expect(drawer).ToBeHiddenAsync();
        Assert.Equal(0, (await Page.GetByTestId("viewport").BoundingBoxAsync())!.X);

        await Page.GetByTestId("drawer-button").ClickAsync();
        await Expect(drawer).ToBeVisibleAsync();
        await Expect(Page.GetByTestId("drawer-backdrop")).ToBeVisibleAsync();
        Assert.Equal(0, (await Page.GetByTestId("viewport").BoundingBoxAsync())!.X); // over the view, not beside it
        Assert.True((await drawer.BoundingBoxAsync())!.Width <= 320);

        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        await TreeNode(id, 0).GetByTestId("tree-node-toggle").ClickAsync();
        await TreeNode(id, Pin).ClickAsync();
        await WaitForPartStateAsync(id, [], [Pin]);
        await Expect(drawer).ToBeHiddenAsync();

        // The backdrop closes it too.
        await Page.GetByTestId("drawer-button").ClickAsync();
        await Expect(drawer).ToBeVisibleAsync();
        await Page.Mouse.ClickAsync(400, 600);
        await Expect(drawer).ToBeHiddenAsync();
        await WaitForPartStateAsync(id, [], [Pin]); // the backdrop's click didn't reach the view
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_panel_is_a_sheet_that_peeks_and_its_handle_pulls_up_and_down()
    {
        var id = await LoadAsync("assembly.step");
        var point = (await PartPointAsync(id, TopPlate))!;
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await WaitForPartStateAsync(id, [], [TopPlate]);
        await Page.Keyboard.PressAsync("w");
        await Expect(Page.GetByTestId("move-panel")).ToBeVisibleAsync();

        var sheet = Page.GetByTestId("selection-panel");
        var view = (await Page.GetByTestId("viewport").BoundingBoxAsync())!;
        var peek = (await sheet.BoundingBoxAsync())!;
        Assert.Equal(view.Width, peek.Width, 1);
        Assert.Equal(view.Y + view.Height, peek.Y + peek.Height, 1);
        Assert.True(peek.Height <= 105, $"the sheet should peek: {peek.Height} px");
        await Expect(Page.GetByTestId("sheet-tool")).ToContainTextAsync("Moving");

        await Page.GetByTestId("sheet-handle").ClickAsync();
        await Expect(Page.GetByTestId("sheet-handle")).ToHaveAttributeAsync("aria-expanded", "true");
        var open = (await sheet.BoundingBoxAsync())!;
        Assert.True(open.Height > 200 && open.Height <= view.Height / 2 + 1, $"the sheet should open to at most half the view: {open.Height} of {view.Height} px");

        // A drag down closes it, ending wherever the pointer lets go.
        var handle = (await Page.GetByTestId("sheet-handle").BoundingBoxAsync())!;
        await Page.Mouse.MoveAsync(handle.X + handle.Width / 2, handle.Y + handle.Height / 2);
        await Page.Mouse.DownAsync();
        await Page.Mouse.MoveAsync(handle.X + handle.Width / 2, handle.Y + 120, new MouseMoveOptions { Steps = 4 });
        await Page.Mouse.UpAsync();
        await Expect(Page.GetByTestId("sheet-handle")).ToHaveAttributeAsync("aria-expanded", "false");

        await Page.GetByTestId("sheet-stop").ClickAsync();
        await Expect(Page.GetByTestId("move-panel")).ToHaveCountAsync(0);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_projection_is_in_More()
    {
        await LoadAsync("assembly.step");
        await Expect(Page.GetByTestId("view-controls")).ToBeHiddenAsync();

        await Page.GetByTestId("more-menu").ClickAsync();
        await Page.GetByTestId("more-perspective").ClickAsync();

        await Page.WaitForFunctionAsync("() => window.__j3dTest.camera().projection === 'perspective'");
        await Page.GetByTestId("more-menu").ClickAsync();
        await Expect(Page.GetByTestId("more-perspective")).ToHaveAttributeAsync("aria-checked", "true");
        AssertNoConsoleErrors();
    }

    /// <summary>
    /// With a mouse's 32 px tools the groups fold only in the compact layout (D235): Files and view below
    /// 840 px, Visibility below 730, Tools below 620, and About and the wordmark below 480. Nothing in the bar
    /// is clipped or runs off it, in Linux's wider fallback font as in Segoe UI; a short window is compact too.
    /// </summary>
    [Theory]
    [InlineData(899, 915, "")]
    [InlineData(839, 915, "files")]
    [InlineData(729, 915, "files visibility")]
    [InlineData(619, 915, "files visibility tools")]
    [InlineData(479, 915, "files visibility tools about")]
    [InlineData(1280, 480, "")]
    public async Task The_bar_folds_its_groups_into_More_as_it_narrows(int width, int height, string folded)
    {
        await Page.SetViewportSizeAsync(width, height);
        await Expect(Page.GetByTestId("undo-button")).ToBeVisibleAsync(new LocatorAssertionsToBeVisibleOptions { Timeout = 30_000 });
        await Expect(Page.GetByTestId("more-menu")).ToBeVisibleAsync();

        foreach (var (group, testId) in Groups)
        {
            var expected = folded.Split(' ').Contains(group);
            Assert.True(expected != await Page.GetByTestId(testId).IsVisibleAsync(), $"{group} should {(expected ? "" : "not ")}be folded at {width} px");
        }

        await AssertBarFitsAsync(Page, width);
        await Expect(Page.GetByTestId("drawer")).ToBeHiddenAsync();
        AssertNoConsoleErrors();
    }

    /// <summary>A group's folding, told by a control in it that the bar shows only while it isn't folded.</summary>
    internal static readonly (string Group, string TestId)[] Groups =
    [
        ("files", "fit-all-button"),
        ("visibility", "hide-button"),
        ("tools", "measure-button"),
        ("about", "about-button"),
    ];

    /// <summary>Nothing in the app bar is clipped, and its last control ends inside the window.</summary>
    internal static async Task AssertBarFitsAsync(IPage page, int width)
    {
        var clipped = await page.Locator(".j3d-appbar .mud-toggle-item, .j3d-appbar button, .j3d-appbar label").EvaluateAllAsync<string[]>(
            "items => items.filter(item => item.offsetParent !== null && item.scrollWidth > item.clientWidth + 1).map(item => item.dataset.testid || item.getAttribute('aria-label') || item.innerText)");
        Assert.Empty(clipped);
        var end = await page.Locator(".j3d-appbar button").EvaluateAllAsync<double>(
            "items => Math.max(...items.filter(item => item.offsetParent !== null).map(item => item.getBoundingClientRect().right))");
        Assert.True(end <= width, $"the bar should end inside the window: {end} > {width} px");
        var bar = (await page.Locator(".j3d-appbar").BoundingBoxAsync())!;
        Assert.True(bar.Height < 70, $"the app bar should be one row: {bar.Height} px");
    }

    private ILocator TreeNode(string id, int node) => Page.Locator($"[data-tree-node=\"{id}:{node}\"]");

    private async Task<string> LoadAsync(string fixture)
    {
        await ImportWithToolbarAsync(fixture);
        var model = Assert.Single(await WaitForImportsAsync(1));
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
        return model.Id;
    }
}
