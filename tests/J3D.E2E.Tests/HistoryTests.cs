using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M17 (D208–D224) through the real mouse, keys and buttons: Rotate beside Move, selections in the undo
/// history, and the camera's own Previous view and Next view. <c>assembly.step</c> is the bracket: an
/// assembly holding the bottom plate (1), the top plate (2) and the pin (3).
/// </summary>
public sealed class HistoryTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int BottomPlate = 1;
    private const int TopPlate = 2;
    private const int Pin = 3;

    [Fact]
    public async Task Rotate_shows_the_rings_from_the_toolbar_the_panel_and_the_menu()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);

        await Page.GetByTestId("rotate-button").ClickAsync();
        await WaitForAsync("() => window.__j3dTest.moveState().mode === 'rotate'");
        await Expect(Page.GetByTestId("rotate-button")).ToHaveAttributeAsync("aria-pressed", "true");
        await Expect(Page.GetByTestId("move-button")).ToHaveAttributeAsync("aria-pressed", "false");

        // The panel's switch, at its top, changes the triad and keeps all six fields (D223).
        await Page.GetByTestId("move-mode-translate").ClickAsync();
        await WaitForAsync("() => window.__j3dTest.moveState().mode === 'translate'");
        await Expect(Page.GetByTestId("move-button")).ToHaveAttributeAsync("aria-pressed", "true");
        await Expect(Page.Locator("[data-testid=move-panel] .j3d-move-field input")).ToHaveCountAsync(6);

        // Esc ends it; the context menu's Rotate starts it with the rings (D222).
        await Page.Keyboard.PressAsync("Escape");
        await WaitForAsync("() => !window.__j3dTest.moveState().active");
        var pin = (await PartPointAsync(id, Pin))!;
        await Page.Mouse.ClickAsync((float)pin.X, (float)pin.Y, new MouseClickOptions { Button = MouseButton.Right });
        await Page.GetByTestId("context-rotate").ClickAsync();
        await WaitForAsync("() => window.__j3dTest.moveState().mode === 'rotate'");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Selections_undo_and_redo_one_step_at_a_time_without_moving_the_camera()
    {
        var id = await LoadAsync("assembly.step");
        var camera = await CameraAsync();
        await ClickPartAsync(id, TopPlate);
        await ClickPartAsync(id, Pin, ctrl: true);

        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPartStateAsync(id, [], [TopPlate]);
        await Page.GetByTestId("undo-button").HoverAsync();
        await Expect(Page.GetByText("Undo selecting 1 part (Ctrl+Z)")).ToBeVisibleAsync(); // D224
        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPartStateAsync(id, [], []);
        await Page.Keyboard.PressAsync("Control+y");
        await WaitForPartStateAsync(id, [], [TopPlate]);

        // Esc clears, and that's a step too (D219); a hide in between stays undoable.
        await Page.Keyboard.PressAsync("h");
        await WaitForPartStateAsync(id, [TopPlate], []);
        await ClickPartAsync(id, BottomPlate);
        await Page.Keyboard.PressAsync("Escape");
        await WaitForPartStateAsync(id, [TopPlate], []);
        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPartStateAsync(id, [TopPlate], [BottomPlate]);
        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPartStateAsync(id, [TopPlate], []);
        await Page.Keyboard.PressAsync("Control+z"); // the hide, which doesn't select again (D98)
        await WaitForPartStateAsync(id, [], []);

        var after = await CameraAsync();
        Assert.Equal(camera.Position, after.Position); // undo never moves the camera (D209)
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Feature_selections_come_back_on_undo_with_their_mode()
    {
        var id = await LoadAsync("assembly.step");
        await Page.Keyboard.PressAsync("3");
        await Expect(Page.GetByTestId("mode-feature")).ToHaveAttributeAsync("aria-pressed", "true");
        var top = (await PartPointAsync(id, TopPlate))!;
        var pin = (await PartPointAsync(id, Pin))!;
        await Page.Mouse.ClickAsync((float)top.X, (float)top.Y);
        await WaitForAsync("() => window.__j3dTest.selectionState().features.length === 1");
        var first = (await FeaturesAsync())[0].GetRawText();
        await Page.Keyboard.DownAsync("Control");
        await Page.Mouse.ClickAsync((float)pin.X, (float)pin.Y);
        await Page.Keyboard.UpAsync("Control");
        await WaitForAsync("() => window.__j3dTest.selectionState().features.length === 2");

        await Page.Keyboard.PressAsync("Control+z");
        await WaitForAsync("() => window.__j3dTest.selectionState().features.length === 1");
        Assert.Equal(first, (await FeaturesAsync())[0].GetRawText());
        await Expect(Page.GetByTestId("selection-panel")).ToContainTextAsync("Plate (top)");

        // Switching to Object mode clears them; undoing the switch brings back the mode and the face.
        await Page.Keyboard.PressAsync("2");
        await WaitForAsync("() => window.__j3dTest.selectionState().features.length === 0");
        await Page.Keyboard.PressAsync("Control+z");
        await WaitForAsync("() => window.__j3dTest.selectionState().mode === 'feature' && window.__j3dTest.selectionState().features.length === 1");
        Assert.Equal(first, (await FeaturesAsync())[0].GetRawText());
        await Expect(Page.GetByTestId("mode-feature")).ToHaveAttributeAsync("aria-pressed", "true");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Previous_and_next_view_step_through_where_the_camera_came_to_rest()
    {
        await LoadAsync("assembly.step");
        var home = await CameraAsync();
        var views = await ViewCountAsync();
        await Expect(Page.GetByTestId("next-view")).ToBeDisabledAsync();

        var top = (await ViewCubePointAsync("top"))!;
        await Page.Mouse.ClickAsync((float)top.X, (float)top.Y);
        await WaitForViewsAsync(views + 1);
        Assert.True((await CameraAsync()).Polar < 0.01, "the view cube's top looks straight down");

        await Page.GetByTestId("previous-view").ClickAsync();
        await WaitForAsync($"() => Math.abs(window.__j3dTest.camera().polar - {home.Polar.ToString(System.Globalization.CultureInfo.InvariantCulture)}) < 1e-3");
        await WaitForCameraRestAsync();
        Assert.Equal(views + 1, await ViewCountAsync()); // going back isn't a view of its own
        await Expect(Page.GetByTestId("next-view")).ToBeEnabledAsync();

        await Page.Keyboard.PressAsync("]");
        await WaitForAsync("() => window.__j3dTest.camera().polar < 0.01");
        await WaitForCameraRestAsync();
        await Expect(Page.GetByTestId("next-view")).ToBeDisabledAsync();

        // A burst of wheel steps is one view (D220).
        var centre = (await Page.GetByTestId("viewer-canvas").BoundingBoxAsync())!;
        await Page.Mouse.MoveAsync(centre.X + (centre.Width / 2), centre.Y + (centre.Height / 2));
        for (var i = 0; i < 3; i++)
        {
            await Page.Mouse.WheelAsync(0, -120);
        }

        await WaitForViewsAsync(views + 2);
        await WaitForCameraRestAsync();
        Assert.Equal(views + 2, await ViewCountAsync());

        // The projection switch is a view; going back to the orthographic one moves the switch too.
        await SetProjectionAsync("perspective");
        await WaitForViewsAsync(views + 3);
        await Page.Keyboard.PressAsync("[");
        await WaitForAsync("() => window.__j3dTest.camera().projection === 'orthographic'");
        await Expect(Page.GetByTestId("projection-orthographic")).ToHaveAttributeAsync("aria-pressed", "true");
        AssertNoConsoleErrors();
    }

    /// <summary>Imports a fixture through the toolbar, waits until it's loaded, then Home, so the view is known.</summary>
    private async Task<string> LoadAsync(string fixture)
    {
        await ImportWithToolbarAsync(fixture);
        var model = Assert.Single(await WaitForImportsAsync(1));
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(1);
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
        return model.Id;
    }

    private async Task ClickPartAsync(string id, int node, bool ctrl = false)
    {
        var point = await PartPointAsync(id, node);
        Assert.True(point is not null, $"part {node} should be in view");
        if (ctrl)
        {
            await Page.Keyboard.DownAsync("Control");
        }

        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        if (ctrl)
        {
            await Page.Keyboard.UpAsync("Control");
        }

        await Page.WaitForFunctionAsync(
            "([id, node]) => window.__j3dTest.partState(id).selected.includes(node)",
            new object[] { id, node });
    }

    private Task<int> ViewCountAsync() => Page.EvaluateAsync<int>("() => window.__j3dTest.viewHistory().count");

    private async Task WaitForViewsAsync(int count) =>
        await Page.WaitForFunctionAsync("count => window.__j3dTest.viewHistory().count >= count", count, new PageWaitForFunctionOptions { Timeout = 30_000 });

    private async Task<JsonElement[]> FeaturesAsync() =>
        [.. (await Page.EvaluateAsync<JsonElement>("() => window.__j3dTest.selectionState().features")).EnumerateArray()];
}
