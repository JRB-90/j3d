using System.Text.Json;

namespace J3D.E2E.Tests;

/// <summary>
/// The Move tool, its fields and the origin frames (M13, D148â€“D150, D165â€“D171) through the real mouse,
/// keys and panel. <c>assembly.step</c> is the bracket: an assembly at the origin (node 0) holding the
/// bottom plate (1), the top plate (2) and the pin (3), whose placement in the assembly is (25, 25, 0).
/// </summary>
public sealed class MoveTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int Pin = 3;
    private const int TopPlate = 2;
    private const int Model = -1;

    [Fact]
    public async Task Dragging_an_arrow_moves_the_part_as_one_undoable_step_and_the_fields_follow()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("w");
        await Expect(Page.GetByTestId("move-title")).ToHaveTextAsync("Pin");
        await Page.GetByTestId("move-frame-parent").ClickAsync();
        await Expect(Page.GetByTestId("move-x")).ToHaveValueAsync("25.000");

        await DragHandleAsync("X", 25, 25, 0, 80);

        var moved = (await PlacementAsync(id, Pin)).Local;
        Assert.True(Math.Abs(moved[12] - 25) > 1, $"the pin moves along x: {moved[12]}");
        Assert.Equal(25, moved[13], 6);
        Assert.Equal(0, moved[14], 6);
        await Expect(Page.GetByTestId("move-x")).ToHaveValueAsync(moved[12].ToString("0.000", System.Globalization.CultureInfo.InvariantCulture));

        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPlacementAsync(id, Pin, 25, 25, 0);
        await Expect(Page.GetByTestId("move-x")).ToHaveValueAsync("25.000");
        await Page.Keyboard.PressAsync("Control+y");
        await WaitForPlacementAsync(id, Pin, moved[12], 25, 0);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Ctrl_snaps_a_drag_to_whole_millimetres()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("w");
        await Expect(Page.GetByTestId("move-title")).ToHaveTextAsync("Pin");

        await Page.Keyboard.DownAsync("Control");
        await DragHandleAsync("Y", 25, 25, 0, 70);
        await Page.Keyboard.UpAsync("Control");

        var y = (await PlacementAsync(id, Pin)).Local[13];
        Assert.True(Math.Abs(y - 25) >= 1, $"the pin moves along y: {y}");
        Assert.Equal(Math.Round(y), y, 6);
    }

    [Fact]
    public async Task Typed_values_move_in_each_frame_and_a_model_moves_by_its_own_frame()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("w");
        await Page.GetByTestId("move-frame-parent").ClickAsync();

        await TypeAsync("move-x", "40");
        await WaitForPlacementAsync(id, Pin, 40, 25, 0);
        await TypeAsync("move-rz", "90");
        var turned = (await PlacementAsync(id, Pin)).Local;
        Assert.Equal(0, turned[0], 6); // the pin's x axis now points along y
        Assert.Equal(1, turned[1], 6);

        // Local: 5 along the pin's own x, which now points along the parent's y.
        await Page.GetByTestId("move-frame-local").ClickAsync();
        await Expect(Page.GetByTestId("move-x")).ToHaveValueAsync("0.000");
        await TypeAsync("move-x", "5");
        await WaitForPlacementAsync(id, Pin, 40, 30, 0);

        // A whole model (Model mode, D169): its frame starts at the file's origin.
        await Page.Mouse.ClickAsync(5, 300); // the panel's input has focus: give it back to the page first
        await Page.Keyboard.PressAsync("1");
        await ClickPartAsync(id, TopPlate);
        await Expect(Page.GetByTestId("move-title")).ToHaveTextAsync("assembly.step");
        await Page.GetByTestId("move-frame-world").ClickAsync();
        await Expect(Page.GetByTestId("move-x")).ToHaveValueAsync("0.000");
        await TypeAsync("move-x", "100");
        await WaitForPlacementAsync(id, Model, 100, 0, 0);
        Assert.Equal(100, (await PlacementAsync(id, Pin)).ParentWorld[12], 6);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Moves_are_kept_across_a_reload()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("w");
        await Page.GetByTestId("move-frame-parent").ClickAsync();
        await TypeAsync("move-z", "12");
        await WaitForPlacementAsync(id, Pin, 25, 25, 12);
        await Page.Mouse.ClickAsync(5, 300);
        await Page.Keyboard.PressAsync("1");
        await ClickPartAsync(id, TopPlate);
        await TypeAsync("move-y", "-50");
        await WaitForPlacementAsync(id, Model, 0, -50, 0);

        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(1);
        await Page.WaitForFunctionAsync("id => window.__j3dTest.models().some(m => m.id === id && m.status === 'loaded')", id);

        await WaitForPlacementAsync(id, Pin, 25, 25, 12);
        await WaitForPlacementAsync(id, Model, 0, -50, 0);
    }

    [Fact]
    public async Task Origin_frames_mark_the_selection_and_clicks_still_select_while_moving()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("o");
        await WaitForMoveStateAsync("s => s.originFrames === 1");

        await ClickPartAsync(id, TopPlate, ctrl: true);
        await WaitForMoveStateAsync("s => s.originFrames === 2");

        await Page.Keyboard.PressAsync("w");
        await Expect(Page.GetByTestId("move-hint")).ToContainTextAsync("Select one part");

        await ClickPartAsync(id, TopPlate); // a click selects as usual, and the triad follows (D170)
        await WaitForMoveStateAsync($"s => s.active && s.target.node === {TopPlate}");
        await WaitForMoveStateAsync("s => s.originFrames === 1");
        await Expect(Page.GetByTestId("move-title")).ToHaveTextAsync("Plate (top)");

        await Page.Keyboard.PressAsync("Escape"); // ends the tool, keeping the selection
        await WaitForMoveStateAsync("s => !s.active");
        await Expect(Page.GetByTestId("move-panel")).ToHaveCountAsync(0);
        var selected = (await PartStateAsync(id)).Selected;
        Assert.Equal([TopPlate], selected);
    }

    [Fact]
    public async Task A_mesh_model_moves_in_millimetres()
    {
        // part.glb is in metres (D105): 5 mm typed is 0.005 of its units.
        var id = await LoadAsync("part.glb");
        var point = (await PartPointAsync(id, (await PartStateAsync(id)).Parts[0]))!;
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).selected.length === 1", id);
        var part = (await PartStateAsync(id)).Selected[0]; // the part in front there
        await Page.Keyboard.PressAsync("w");
        await Page.GetByTestId("move-frame-parent").ClickAsync();
        var start = (await PlacementAsync(id, part)).Local;

        await TypeAsync("move-x", (start[12] * 1000 + 5).ToString(System.Globalization.CultureInfo.InvariantCulture));

        await WaitForPlacementAsync(id, part, start[12] + 0.005, start[13], start[14], 1e-9);
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

    /// <summary>Types a value in one of the Move fields and presses Enter.</summary>
    private async Task TypeAsync(string field, string value)
    {
        await Page.GetByTestId(field).FillAsync(value);
        await Page.GetByTestId(field).PressAsync("Enter");
    }

    /// <summary>
    /// Drags the triad's handle along an axis: finds it by walking out from the target's origin (given
    /// in world coordinates) along the axis as drawn, then moves a frame at a time, as a mouse does.
    /// </summary>
    private async Task DragHandleAsync(string axis, double x, double y, double z, double pixels)
    {
        var origin = await ProjectAsync(x, y, z);
        var along = await ProjectAsync(x + (axis == "X" ? 1 : 0), y + (axis == "Y" ? 1 : 0), z + (axis == "Z" ? 1 : 0));
        var (dx, dy) = (along.X - origin.X, along.Y - origin.Y);
        var length = Math.Sqrt(dx * dx + dy * dy);
        (dx, dy) = (dx / length, dy / length);

        ScreenPoint? handle = null;
        for (var step = 4; step < 200 && handle is null; step += 2)
        {
            var point = new ScreenPoint(origin.X + dx * step, origin.Y + dy * step);
            if (await Page.EvaluateAsync<string?>("([x, y]) => window.__j3dTest.moveHandleAt(x, y)", new[] { point.X, point.Y }) == axis)
            {
                handle = point;
            }
        }

        Assert.True(handle is not null, $"the {axis} handle should be on screen");
        await Page.Mouse.MoveAsync((float)handle.X, (float)handle.Y);
        await Page.Mouse.DownAsync();
        for (var step = 1; step <= 10; step++)
        {
            await Page.Mouse.MoveAsync((float)(handle.X + dx * pixels * step / 10), (float)(handle.Y + dy * pixels * step / 10));
            await Page.EvaluateAsync("() => new Promise(requestAnimationFrame)");
        }

        await Page.Mouse.UpAsync();
        await WaitForMoveStateAsync("s => !s.dragging");
    }

    private async Task<PlacementState> PlacementAsync(string id, int node) =>
        (await Page.EvaluateAsync<JsonElement>("([id, node]) => window.__j3dTest.placement(id, node)", new object[] { id, node })).Deserialize<PlacementState>(Json)!;

    private async Task WaitForPlacementAsync(string id, int node, double x, double y, double z, double tolerance = 1e-6) =>
        await Page.WaitForFunctionAsync(
            "([id, node, x, y, z, tolerance]) => { const p = window.__j3dTest.placement(id, node); return p && Math.abs(p.local[12] - x) < tolerance && Math.abs(p.local[13] - y) < tolerance && Math.abs(p.local[14] - z) < tolerance; }",
            new object[] { id, node, x, y, z, tolerance });

    private async Task WaitForMoveStateAsync(string predicate) =>
        await Page.WaitForFunctionAsync($"() => ({predicate})(window.__j3dTest.moveState())");

    private sealed record PlacementState(double[] Local, double[] ParentWorld);
}
