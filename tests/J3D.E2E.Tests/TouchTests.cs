using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M19 by touch (D239, D242, D237), in Chromium's emulation of a Pixel 7 (a touch screen, a mobile user
/// agent, 412 px wide): 48 px targets and the bar's folds for a finger, a long press for the context
/// menu in the view and the tree (whose rows don't drag), a tap that may move a little, and Add. Long
/// presses go through the DevTools protocol's touch events, as a finger's would. Playwright can't make
/// Firefox a mobile device, so there these are skipped and <see cref="CompactLayoutTests"/> stands in (D211).
/// </summary>
public sealed class TouchTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const string FirefoxReason = "Playwright can't emulate a phone in Firefox; CompactLayoutTests checks the layout there (D211).";
    private const int Bracket = 0;
    private const int TopPlate = 2;
    private const int Pin = 3;

    private ICDPSession? _cdp;

    public override BrowserNewContextOptions ContextOptions() =>
        BrowserName == "firefox" ? new() { ViewportSize = new() { Width = 412, Height = 839 } } : Playwright.Devices["Pixel 7"];

    /// <summary>
    /// A finger's 48 px tools fold sooner (D235, D239): icons below 1,600 px, Files and view below 1,100,
    /// Visibility below 960, Tools below 800, About and the wordmark below 600, and Add below 410, leaving
    /// the drawer button, Model, Object and Feature, Undo, Redo and ⋮ on a 360 px phone.
    /// </summary>
    [Theory]
    [InlineData(1600, "")]
    [InlineData(1599, "")]
    [InlineData(1100, "")]
    [InlineData(1099, "files")]
    [InlineData(960, "files")]
    [InlineData(959, "files visibility")]
    [InlineData(800, "files visibility")]
    [InlineData(799, "files visibility tools")]
    [InlineData(600, "files visibility tools")]
    [InlineData(599, "files visibility tools about")]
    [InlineData(412, "files visibility tools about")]
    [InlineData(409, "files visibility tools about add")]
    [InlineData(360, "files visibility tools about add")]
    public async Task The_bar_fits_a_finger_at_every_width(int width, string folded)
    {
        Assert.SkipWhen(BrowserName == "firefox", FirefoxReason);
        await Page.SetViewportSizeAsync(width, 900);
        await Expect(Page.GetByTestId("undo-button")).ToBeVisibleAsync(new LocatorAssertionsToBeVisibleOptions { Timeout = 30_000 });

        foreach (var (group, testId) in CompactLayoutTests.Groups.Append(("add", "add-button")))
        {
            var expected = folded.Split(' ').Contains(group);
            Assert.True(expected != await Page.GetByTestId(testId).IsVisibleAsync(), $"{group} should {(expected ? "" : "not ")}be folded at {width} px");
        }

        Assert.Equal(width >= 1600, await Page.GetByTestId("measure-button").Locator(".j3d-tool-label").IsVisibleAsync());
        Assert.Equal(folded.Length > 0 || width < 900, await Page.GetByTestId("more-menu").IsVisibleAsync());
        var small = await Page.Locator(".j3d-appbar button").EvaluateAllAsync<string[]>(
            "items => items.filter(item => item.offsetParent !== null && item.getBoundingClientRect().height < 46).map(item => item.dataset.testid || item.getAttribute('aria-label'))");
        Assert.Empty(small);
        await CompactLayoutTests.AssertBarFitsAsync(Page, width);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_long_press_on_a_part_opens_the_context_menu_which_stays_open()
    {
        Assert.SkipWhen(BrowserName == "firefox", FirefoxReason);
        var id = await LoadAsync("assembly.step");
        var point = (await PartPointAsync(id, TopPlate))!;

        await LongPressAsync(point.X, point.Y);

        var hide = Page.GetByTestId("context-hide");
        await Expect(hide).ToBeVisibleAsync();
        await Page.WaitForTimeoutAsync(500); // the finger lifting doesn't close it
        await Expect(hide).ToBeVisibleAsync();
        await WaitForPartStateAsync(id, [], [TopPlate]);
        await hide.TapAsync();
        await WaitForPartStateAsync(id, [TopPlate], []);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_long_press_on_a_tree_row_opens_its_menu_whose_Copy_and_Paste_stand_in_for_a_drag()
    {
        Assert.SkipWhen(BrowserName == "firefox", FirefoxReason);
        var id = await LoadAsync("assembly.step");
        await Page.GetByTestId("drawer-button").TapAsync();
        await Page.GetByTestId("model-tree-toggle").TapAsync();
        await TreeNode(id, Bracket).GetByTestId("tree-node-toggle").TapAsync();
        await Expect(TreeNode(id, Pin)).ToHaveAttributeAsync("draggable", "false");
        Assert.Equal(48, (await TreeNode(id, Pin).BoundingBoxAsync())!.Height, 1);

        await LongPressAsync(TreeNode(id, Pin));
        await Page.GetByTestId("context-copy").TapAsync();
        await LongPressAsync(TreeNode(id, Bracket));
        await Page.GetByTestId("context-paste").TapAsync();

        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).parts.length === 4", id);
        await Expect(Page.GetByTestId("drawer")).ToBeVisibleAsync(); // only a tap on a row closes it
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task With_Add_on_taps_add_parts_and_a_tap_may_move_a_little()
    {
        Assert.SkipWhen(BrowserName == "firefox", FirefoxReason);
        var id = await LoadAsync("assembly.step");
        var add = Page.GetByTestId("add-button");

        await add.TapAsync();
        await Expect(add).ToHaveAttributeAsync("aria-pressed", "true");
        await Expect(Page.GetByTestId("sheet-add")).ToContainTextAsync("Adding to the selection");
        var plate = (await PartPointAsync(id, TopPlate))!;
        await Page.Touchscreen.TapAsync((float)plate.X, (float)plate.Y);
        await WaitForPartStateAsync(id, [], [TopPlate]);
        var pin = (await PartPointAsync(id, Pin))!;
        await TouchAsync(("touchStart", pin.X, pin.Y), ("touchMove", pin.X + 6, pin.Y + 5), ("touchEnd", 0, 0));
        await WaitForPartStateAsync(id, [], [TopPlate, Pin]);

        await Page.GetByTestId("sheet-add-stop").TapAsync();
        await Expect(add).ToHaveAttributeAsync("aria-pressed", "false");
        await Page.Touchscreen.TapAsync((float)plate.X, (float)plate.Y);
        await WaitForPartStateAsync(id, [], [TopPlate]);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_tablet_keeps_the_drawer_beside_the_view_on_its_side_and_goes_compact_upright()
    {
        Assert.SkipWhen(BrowserName == "firefox", FirefoxReason);
        await Page.SetViewportSizeAsync(1138, 712);
        await Expect(Page.GetByTestId("drawer")).ToBeVisibleAsync(new LocatorAssertionsToBeVisibleOptions { Timeout = 30_000 });
        await ViewStartsAtAsync(320); // once the drawer's margin has slid in from the phone's layout
        await Expect(Page.GetByTestId("view-controls")).ToBeVisibleAsync();
        Assert.Equal(48, (await Page.GetByTestId("fit-all-button").BoundingBoxAsync())!.Height, 1);
        Assert.Equal(48, (await Page.GetByTestId("home-button").BoundingBoxAsync())!.Height, 1);

        await Page.SetViewportSizeAsync(712, 1138);
        await Expect(Page.GetByTestId("drawer")).ToBeHiddenAsync();
        await Expect(Page.GetByTestId("view-controls")).ToBeHiddenAsync();
        await ViewStartsAtAsync(0);
        AssertNoConsoleErrors();
    }

    private async Task ViewStartsAtAsync(int x) =>
        await Page.WaitForFunctionAsync("x => Math.abs(document.querySelector('[data-testid=viewport]').getBoundingClientRect().x - x) < 1", x);

    private ILocator TreeNode(string id, int node) => Page.Locator($"[data-tree-node=\"{id}:{node}\"]");

    private async Task<string> LoadAsync(string fixture)
    {
        await ImportWithToolbarAsync(fixture);
        var model = Assert.Single(await WaitForImportsAsync(1));
        await Page.GetByTestId("home-button").TapAsync();
        await WaitForCameraRestAsync();
        return model.Id;
    }

    private async Task LongPressAsync(ILocator target)
    {
        var box = (await target.BoundingBoxAsync())!;
        await LongPressAsync(box.X + box.Width / 2, box.Y + box.Height / 2);
    }

    /// <summary>A finger held still for most of a second, then lifted (D242's long press is half a second).</summary>
    private async Task LongPressAsync(double x, double y)
    {
        await TouchAsync(("touchStart", x, y));
        await Page.WaitForTimeoutAsync(800);
        await TouchAsync(("touchEnd", 0, 0));
    }

    /// <summary>One finger's touch events, through the DevTools protocol (Chromium only), in one session so a touch's end follows its start.</summary>
    private async Task TouchAsync(params (string Type, double X, double Y)[] events)
    {
        _cdp ??= await Context.NewCDPSessionAsync(Page);
        foreach (var (type, x, y) in events)
        {
            object[] points = type == "touchEnd" ? [] : [new Dictionary<string, object> { ["x"] = x, ["y"] = y }];
            await _cdp.SendAsync("Input.dispatchTouchEvent", new Dictionary<string, object> { ["type"] = type, ["touchPoints"] = points });
        }
    }
}
