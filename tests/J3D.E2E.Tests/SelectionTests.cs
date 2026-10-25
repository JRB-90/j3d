using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M6: selecting parts in the viewport and the tree, hover, hiding, isolating, showing and undo
/// (decisions D77–D79, D87, D89, D93–D99), through the real mouse, keyboard, tree and toolbar.
/// <c>assembly.step</c>'s tree: Bracket assembly (0) holds Plate (bottom) (1), Plate (top) (2) and Pin (3).
/// <c>part.glb</c>'s: Scene (0) → Assembly (1) → Base (2) and Post (3).
/// </summary>
public sealed class SelectionTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int Bottom = 1;
    private const int Top = 2;
    private const int Pin = 3;

    [Fact]
    public async Task A_click_selects_a_part_highlights_it_names_it_and_reveals_it_in_the_tree()
    {
        var id = await LoadAsync("assembly.step");
        var pin = (await PartPointAsync(id, Pin))!;
        var before = (await SamplePixelsAsync(pin))[0];

        await ClickAsync(pin);

        await WaitForPartStateAsync(id, [], [Pin]);
        await Expect(Page.GetByTestId("selection-title")).ToHaveTextAsync("Pin");
        await Expect(Page.GetByTestId("selection-detail")).ToHaveTextAsync("assembly.step › Bracket assembly");
        await Expect(TreeNode(id, Pin)).ToHaveAttributeAsync("data-selected", "true");
        await Expect(TreeNode(id, Pin)).ToBeInViewportAsync();

        var after = (await SamplePixelsAsync(pin))[0];
        await AssertRenderedAsync(after.B - after.R > before.B - before.R + 30, $"the selected pin is tinted blue ({before} → {after})");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Ctrl_click_adds_and_removes_parts_and_Esc_or_empty_space_clears()
    {
        var id = await LoadAsync("assembly.step");
        var pin = (await PartPointAsync(id, Pin))!;
        var bottom = (await PartPointAsync(id, Bottom))!;

        await ClickAsync(pin);
        await ClickAsync(bottom, ctrl: true);
        await WaitForPartStateAsync(id, [], [Bottom, Pin]);
        await Expect(Page.GetByTestId("selection-title")).ToHaveTextAsync("2 parts selected");

        await ClickAsync(pin, ctrl: true);
        await WaitForPartStateAsync(id, [], [Bottom]);

        await Page.Keyboard.PressAsync("Escape");
        await WaitForPartStateAsync(id, [], []);
        await Expect(Page.GetByTestId("selection-panel")).ToHaveCountAsync(0);

        await ClickAsync(pin);
        await WaitForPartStateAsync(id, [], [Pin]);
        var empty = await EmptyPointAsync();
        await ClickAsync(empty);
        await WaitForPartStateAsync(id, [], []);
    }

    [Fact]
    public async Task A_drag_pans_without_selecting()
    {
        var id = await LoadAsync("assembly.step");
        var pin = (await PartPointAsync(id, Pin))!;
        var before = await CameraAsync();

        await Page.Mouse.MoveAsync((float)pin.X, (float)pin.Y);
        await Page.Mouse.DownAsync();
        for (var step = 1; step <= 10; step++)
        {
            await Page.Mouse.MoveAsync((float)pin.X + step * 6, (float)pin.Y);
            await Page.EvaluateAsync("() => new Promise(requestAnimationFrame)");
        }

        await Page.Mouse.UpAsync();
        await WaitForCameraRestAsync();

        Assert.NotEqual(before.Target, (await CameraAsync()).Target);
        Assert.Empty((await PartStateAsync(id)).Selected);
    }

    [Fact]
    public async Task The_part_under_the_pointer_is_highlighted_before_it_is_clicked()
    {
        var id = await LoadAsync("assembly.step");
        var pin = (await PartPointAsync(id, Pin))!;

        await Page.Mouse.MoveAsync((float)pin.X, (float)pin.Y);
        await Page.WaitForFunctionAsync($"() => window.__j3dTest.hoveredPart()?.node === {Pin}");
        Assert.Equal(new PartRef(id, Pin), await HoveredPartAsync());

        var empty = await EmptyPointAsync();
        await Page.Mouse.MoveAsync((float)empty.X, (float)empty.Y);
        await Page.WaitForFunctionAsync("() => window.__j3dTest.hoveredPart() === null");
        Assert.Empty((await PartStateAsync(id)).Selected);
    }

    [Fact]
    public async Task Keys_hide_isolate_and_show_parts_and_undo_and_redo_it()
    {
        var id = await LoadAsync("assembly.step");
        var pin = (await PartPointAsync(id, Pin))!;

        await ClickAsync(pin);
        await Page.Keyboard.PressAsync("h");
        await WaitForPartStateAsync(id, [Pin], []);
        Assert.NotEqual(new PartRef(id, Pin), await PartAtAsync(pin)); // whatever was behind it, if anything
        await Expect(Page.GetByTestId("selection-panel")).ToHaveCountAsync(0);

        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPartStateAsync(id, [], []);
        await Page.Keyboard.PressAsync("Control+y");
        await WaitForPartStateAsync(id, [Pin], []);
        await Page.Keyboard.PressAsync("Shift+H");
        await WaitForPartStateAsync(id, [], []);

        await ClickAsync((await PartPointAsync(id, Pin))!);
        var before = await CameraAsync();
        await Page.Keyboard.PressAsync("i");
        await WaitForPartStateAsync(id, [Bottom, Top], [Pin]);

        // Isolate fits the view to what's left, with no Fit all needed.
        await WaitForCameraRestAsync();
        Assert.True((await CameraAsync()).VisibleHeight < before.VisibleHeight * 0.8, "Isolate frames only the visible pin");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Escape_closes_an_open_menu_and_keeps_the_selection()
    {
        var id = await LoadAsync("assembly.step");
        await ClickAsync((await PartPointAsync(id, Pin))!);
        await WaitForPartStateAsync(id, [], [Pin]);

        await Page.GetByTestId("export-menu").Locator("button").First.ClickAsync();
        await Expect(Page.GetByTestId("export-scope")).ToBeVisibleAsync();
        await Page.Keyboard.PressAsync("Escape");

        await Expect(Page.GetByTestId("export-scope")).ToBeHiddenAsync();
        var selected = (await PartStateAsync(id)).Selected;
        Assert.Equal(new[] { Pin }, selected); // the Escape was the menu's, not the selection's
        await Page.Keyboard.PressAsync("Escape");
        await WaitForPartStateAsync(id, [], []);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_toolbar_hides_isolates_shows_and_steps_through_the_history()
    {
        var id = await LoadAsync("assembly.step");
        await Expect(Page.GetByTestId("hide-button")).ToBeDisabledAsync();
        await Expect(Page.GetByTestId("undo-button")).ToBeDisabledAsync();

        await ClickAsync((await PartPointAsync(id, Bottom))!);
        await Page.GetByTestId("isolate-button").ClickAsync();
        await WaitForPartStateAsync(id, [Top, Pin], [Bottom]);
        await Page.GetByTestId("hide-button").ClickAsync();
        await WaitForPartStateAsync(id, [Bottom, Top, Pin], []);
        await Expect(Page.GetByTestId("model-eye")).ToHaveAttributeAsync("data-visibility", "hidden");

        await Page.GetByTestId("undo-button").ClickAsync();
        await WaitForPartStateAsync(id, [Top, Pin], []);
        await Page.GetByTestId("redo-button").ClickAsync();
        await WaitForPartStateAsync(id, [Bottom, Top, Pin], []);
        await Page.GetByTestId("show-all-button").ClickAsync();
        await WaitForPartStateAsync(id, [], []);
        await Expect(Page.GetByTestId("show-all-button")).ToBeDisabledAsync();
    }

    [Fact]
    public async Task The_tree_selects_nodes_and_its_eyes_hide_and_show_them()
    {
        var id = await LoadAsync("assembly.step");
        await Page.GetByTestId("model-tree-toggle").ClickAsync();

        await TreeNode(id, 0).Locator(".j3d-tree-node-name").First.ClickAsync();
        await WaitForPartStateAsync(id, [], [Bottom, Top, Pin]);
        await Expect(Page.GetByTestId("selection-title")).ToHaveTextAsync("3 parts selected");

        await TreeNode(id, 0).Locator(".mud-treeview-item-arrow button").First.ClickAsync();
        await TreeNode(id, Top).Locator(".j3d-tree-node-name").ClickAsync(new LocatorClickOptions { Modifiers = [KeyboardModifier.Control] });
        await WaitForPartStateAsync(id, [], [Bottom, Pin]);

        await TreeNode(id, Pin).GetByTestId("tree-node-eye").ClickAsync();
        await WaitForPartStateAsync(id, [Pin], [Bottom]);
        await Expect(TreeNode(id, Pin).GetByTestId("tree-node-eye")).ToHaveAttributeAsync("data-visibility", "hidden");
        await Expect(TreeNode(id, 0).GetByTestId("tree-node-eye").First).ToHaveAttributeAsync("data-visibility", "mixed");

        await Page.GetByTestId("model-eye").ClickAsync(); // partly hidden: hides the rest
        await WaitForPartStateAsync(id, [Bottom, Top, Pin], []);
        await Page.GetByTestId("model-eye").ClickAsync();
        await WaitForPartStateAsync(id, [], []);
    }

    [Fact]
    public async Task Mesh_models_select_and_hide_by_node()
    {
        var id = await LoadAsync("part.glb");
        const int post = 3;
        var point = (await PartPointAsync(id, post))!;

        await ClickAsync(point);
        await WaitForPartStateAsync(id, [], [post]);
        await Expect(Page.GetByTestId("selection-detail")).ToHaveTextAsync("part.glb › Scene › Assembly");

        await Page.Keyboard.PressAsync("h");
        await WaitForPartStateAsync(id, [post], []);
        Assert.NotEqual(new PartRef(id, post), await PartAtAsync(point));
        AssertNoConsoleErrors();
    }

    /// <summary>Imports one fixture through the toolbar and waits until it's listed as loaded and the view has fitted it.</summary>
    private async Task<string> LoadAsync(string fixture)
    {
        await ImportWithToolbarAsync(fixture);
        var model = Assert.Single(await WaitForImportsAsync(1));
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(1);
        await WaitForCameraRestAsync();
        return model.Id;
    }

    private ILocator TreeNode(string id, int node) => Page.Locator($"[data-tree-node=\"{id}:{node}\"]");

    /// <summary>A mouse click; the mouse API takes no modifiers, so Ctrl is held on the keyboard.</summary>
    private async Task ClickAsync(ScreenPoint point, bool ctrl = false)
    {
        if (ctrl)
        {
            await Page.Keyboard.DownAsync("Control");
        }

        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        if (ctrl)
        {
            await Page.Keyboard.UpAsync("Control");
        }
    }

    /// <summary>A point in the viewport, away from the view cube, with no part under it.</summary>
    private async Task<ScreenPoint> EmptyPointAsync()
    {
        var box = (await Page.GetByTestId("viewport").BoundingBoxAsync())!;
        var point = new ScreenPoint(box.X + 16, box.Y + box.Height / 2);
        Assert.Null(await PartAtAsync(point));
        return point;
    }
}
