using System.Text.Json;

namespace J3D.E2E.Tests;

/// <summary>
/// M7: the Measure tool (decisions D79–D81, D101–D108) through the real mouse, keys and panel, on
/// geometry with known answers. <c>box.brep</c> is 10 × 20 × 30 from the origin, seen from Home's
/// front-right-top view, so its top (z = 30), front (y = 0) and right (x = 10) faces show.
/// </summary>
public sealed class MeasureTests(J3DAppFixture app) : ViewerPageTest(app)
{
    [Fact]
    public async Task A_face_shows_its_properties_and_a_second_face_keeps_the_pair()
    {
        await LoadAsync("box.brep");
        await Page.Keyboard.PressAsync("m");
        await Expect(Page.GetByTestId("measure-hint")).ToHaveTextAsync("Pick a face, edge or vertex.");

        await ClickWorldAsync(5, 10, 30); // the top face
        var pending = Page.GetByTestId("measure-pending");
        await Expect(pending).ToContainTextAsync("Face (plane) of box.brep");
        await Expect(pending).ToContainTextAsync("200.000 mm²");
        await Expect(pending).ToContainTextAsync("(0.000, 0.000, 1.000)");
        await Expect(pending).ToContainTextAsync("6000.000 mm³");

        await ClickWorldAsync(5, 0, 15); // the front face
        await Expect(Page.GetByTestId("measure-pending")).ToHaveCountAsync(0);
        var label = Page.GetByTestId("measure-label");
        await Expect(label).ToHaveTextAsync("0.000 mm · 90.00°");
        await Expect(label).ToBeVisibleAsync();
        var measurement = Page.GetByTestId("measurement");
        await Expect(measurement).ToContainTextAsync("Angle (planes)");
        await Expect(measurement).ToContainTextAsync("90.00°");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Vertices_win_over_edges_and_edges_over_faces_near_the_pointer()
    {
        await LoadAsync("box.brep");
        await Page.Keyboard.PressAsync("m");

        var corner = await ProjectAsync(10, 0, 30);
        Assert.Equal("vertex", (await EntityAtAsync(corner))!.Kind);
        var onEdge = await ProjectAsync(10, 0, 15); // the vertical edge between the front and right faces
        Assert.Equal("edge", (await EntityAtAsync(onEdge))!.Kind);
        Assert.Equal("face", (await EntityAtAsync(await ProjectAsync(5, 10, 30)))!.Kind);

        await Page.Mouse.MoveAsync((float)corner.X, (float)corner.Y);
        await Page.WaitForFunctionAsync("() => window.__j3dTest.measureState().hovered?.kind === 'vertex'");

        await ClickAsync(corner);
        await Expect(Page.GetByTestId("measure-pending")).ToContainTextAsync("Vertex of box.brep");
        await ClickWorldAsync(0.3, 0.3, 30); // just inside the front-left-top corner, which is on the silhouette
        await Expect(Page.GetByTestId("measure-label")).ToHaveTextAsync("10.000 mm");
    }

    [Fact]
    public async Task A_pair_across_two_models_is_measured_exactly()
    {
        // The box (top at z = 30) stands inside coloured-part.step's 40 × 30 × 20 block (top at z = 20).
        await LoadAsync("box.brep", "coloured-part.step");
        await Page.Keyboard.PressAsync("m");

        await ClickWorldAsync(5, 10, 30);
        await Expect(Page.GetByTestId("measure-pending")).ToContainTextAsync("box.brep");
        await ClickWorldAsync(35, 25, 20);

        await Expect(Page.GetByTestId("measure-label")).ToHaveTextAsync("10.000 mm · 0.00°");
        await Expect(Page.GetByTestId("measurement")).Not.ToContainTextAsync("≈");
    }

    [Fact]
    public async Task Mesh_points_snap_to_vertices_and_measure_approximately_in_millimetres()
    {
        // part.glb's post is 10 × 10 × 50 on the base, top at z = 60, in glTF metres (D105).
        await LoadAsync("part.glb");
        await Page.Keyboard.PressAsync("m");

        // Just inside two corners of its top: the pick snaps to the corners (8 px), which a ray aimed at
        // the silhouette itself could miss.
        await ClickWorldAsync(-4.6, -4.6, 60);
        await Expect(Page.GetByTestId("measure-pending")).ToContainTextAsync("Point on Post");
        await ClickWorldAsync(4.6, -4.6, 60);

        await Expect(Page.GetByTestId("measure-label")).ToHaveTextAsync("≈ 10000.000 mm");
    }

    [Fact]
    public async Task Esc_drops_a_pending_pick_and_measurements_undo_follow_their_parts_and_clear()
    {
        await LoadAsync("box.brep");
        var id = (await ModelsAsync())[0].Id;
        await Page.GetByTestId("measure-button").ClickAsync();
        await Expect(Page.GetByTestId("measure-button")).ToHaveAttributeAsync("aria-pressed", "true");

        await ClickWorldAsync(5, 10, 30);
        await Expect(Page.GetByTestId("measure-pending")).ToHaveCountAsync(1);
        await Page.Keyboard.PressAsync("Escape");
        await Expect(Page.GetByTestId("measure-pending")).ToHaveCountAsync(0);

        await ClickWorldAsync(5, 10, 30);
        await ClickWorldAsync(10, 10, 15);
        await Expect(Page.GetByTestId("measure-label")).ToHaveCountAsync(1);

        await Page.Keyboard.PressAsync("Control+z");
        await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(0);
        await Page.WaitForFunctionAsync("() => !window.__j3dTest.measureState().measurements[0].shown");
        await Page.Keyboard.PressAsync("Control+y");
        await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(1);

        // Hiding the part hides its measurement, which stays listed (D108).
        await Page.GetByTestId("model-eye").ClickAsync();
        await Expect(Page.GetByTestId("measurement")).ToHaveAttributeAsync("data-shown", "false");
        await Expect(Page.GetByTestId("measure-label")).ToBeHiddenAsync();
        await Page.GetByTestId("model-eye").ClickAsync();
        await Expect(Page.GetByTestId("measure-label")).ToBeVisibleAsync();

        await Page.GetByTestId("measure-clear").ClickAsync();
        await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(0);
        await Page.Keyboard.PressAsync("m");
        await Expect(Page.GetByTestId("selection-panel")).ToHaveCountAsync(0);
        Assert.False((await PartStateAsync(id)).Selected.Length > 0, "measuring clicks don't select parts");
    }

    /// <summary>Imports fixtures through the toolbar, waits until they're listed as loaded, then Home, so the view is known.</summary>
    private async Task LoadAsync(params string[] fixtures)
    {
        await ImportWithToolbarAsync(fixtures);
        await WaitForImportsAsync(fixtures.Length);
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(fixtures.Length);
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
    }

    private async Task ClickWorldAsync(double x, double y, double z) => await ClickAsync(await ProjectAsync(x, y, z));

    private async Task ClickAsync(ScreenPoint point)
    {
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await Page.WaitForFunctionAsync("() => !window.__j3dTest.measureState().busy");
    }

    private async Task<EntityAt?> EntityAtAsync(ScreenPoint point)
    {
        var json = await Page.EvaluateAsync<JsonElement>("([x, y]) => window.__j3dTest.entityAt(x, y)", new[] { point.X, point.Y });
        return json.ValueKind == JsonValueKind.Null ? null : json.Deserialize<EntityAt>(Json);
    }

    private sealed record EntityAt(string Id, string Kind, int Node, int Index);
}
