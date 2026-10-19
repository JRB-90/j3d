using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// The Measure tool (M7's D79–D81, D102–D107; since M12 one reference against each click, D147) through
/// the real mouse, keys and panel, on geometry with known answers. <c>box.brep</c> is 10 × 20 × 30 from
/// the origin, seen from Home's front-right-top view, so its top (z = 30), front (y = 0) and right
/// (x = 10) faces show.
/// </summary>
public sealed class MeasureTests(J3DAppFixture app) : ViewerPageTest(app)
{
    [Fact]
    public async Task The_reference_shows_its_value_and_each_click_replaces_the_result()
    {
        await LoadAsync("box.brep");
        await Page.Keyboard.PressAsync("m");
        await Expect(Page.GetByTestId("measure-hint")).ToContainTextAsync("Pick a face, edge or vertex");

        await ClickWorldAsync(5, 10, 30); // the top face
        var reference = Page.GetByTestId("measure-reference");
        await Expect(reference).ToContainTextAsync("Face (plane) of box.brep");
        await Expect(reference).ToContainTextAsync("200.000 mm²");
        await Expect(reference).ToContainTextAsync("(0.000, 0.000, 1.000)");
        await Expect(reference).ToContainTextAsync("6000.000 mm³");
        await Expect(Label("reference")).ToHaveTextAsync("200.000 mm²");

        await ClickWorldAsync(5, 0, 15); // the front face
        await Expect(Label("result")).ToHaveTextAsync("0.000 mm · 90.00°");
        await Expect(Page.GetByTestId("measure-result")).ToContainTextAsync("Angle (planes)");

        await ClickWorldAsync(10, 15, 0.2); // the right face's bottom edge, just inside the silhouette, clear of the panel
        await Expect(Label("result")).ToHaveTextAsync("30.000 mm · 0.00°");
        await Expect(Page.GetByTestId("measure-label")).ToHaveCountAsync(2); // the reference and one result
        await Expect(reference).ToContainTextAsync("Face (plane) of box.brep");
        await Expect(reference).Not.ToContainTextAsync("200.000 mm²"); // its values fold away beside a result
        await reference.GetByTestId("measure-reference-toggle").ClickAsync();
        await Expect(reference).ToContainTextAsync("200.000 mm²");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_circle_is_drawn_as_its_diameter()
    {
        // curved-part.step's six drilled holes are 2 mm in radius; one is centred at (6, 6) in its top face (z = 20).
        await LoadAsync("curved-part.step");
        await Page.Keyboard.PressAsync("m");
        var rim = await ProjectAsync(6 + 2 * Math.Cos(-Math.PI / 4), 6 + 2 * Math.Sin(-Math.PI / 4), 20);
        Assert.Equal("edge", (await EntityAtAsync(rim))!.Kind);

        await ClickAsync(rim);

        await Expect(Page.GetByTestId("measure-reference")).ToContainTextAsync("Edge (circle) of Curved part");
        await Expect(Label("reference")).ToHaveTextAsync("Ø 4.000 mm");
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
        await Expect(Page.GetByTestId("measure-reference")).ToContainTextAsync("Vertex of box.brep");
        await ClickWorldAsync(0.3, 0.3, 30); // just inside the front-left-top corner, which is on the silhouette
        await Expect(Label("result")).ToHaveTextAsync("10.000 mm");
    }

    [Fact]
    public async Task A_pair_across_two_models_is_measured_exactly()
    {
        // The box (top at z = 30) stands inside coloured-part.step's 40 × 30 × 20 block (top at z = 20).
        await LoadAsync("box.brep", "coloured-part.step");
        await Page.Keyboard.PressAsync("m");

        await ClickWorldAsync(5, 10, 30);
        await Expect(Page.GetByTestId("measure-reference")).ToContainTextAsync("box.brep");
        await ClickWorldAsync(35, 25, 20);

        await Expect(Label("result")).ToHaveTextAsync("10.000 mm · 0.00°");
        await Expect(Page.GetByTestId("measure-result")).Not.ToContainTextAsync("≈");
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
        await Expect(Page.GetByTestId("measure-reference")).ToContainTextAsync("Point on Post");
        await ClickWorldAsync(4.6, -4.6, 60);

        await Expect(Label("result")).ToHaveTextAsync("≈ 10000.000 mm");
    }

    [Fact]
    public async Task Esc_clears_the_measurement_and_ends_the_tool_which_nothing_undoes()
    {
        await LoadAsync("box.brep");
        var id = (await ModelsAsync())[0].Id;
        await Page.GetByTestId("measure-button").ClickAsync();
        await Expect(Page.GetByTestId("measure-button")).ToHaveAttributeAsync("aria-pressed", "true");

        await ClickWorldAsync(5, 10, 30);
        await ClickWorldAsync(10, 10, 15);
        await Expect(Page.GetByTestId("measure-label")).ToHaveCountAsync(2);
        await Expect(Page.GetByTestId("undo-button")).ToBeDisabledAsync(); // measuring isn't a step

        await Page.Keyboard.PressAsync("Escape");
        await Expect(Page.GetByTestId("measure-button")).ToHaveAttributeAsync("aria-pressed", "false");
        await Expect(Page.GetByTestId("measure-label")).ToHaveCountAsync(0);
        await Expect(Page.GetByTestId("selection-panel")).ToHaveCountAsync(0);
        Assert.False((await PartStateAsync(id)).Selected.Length > 0, "measuring clicks don't select parts");

        // Hiding the reference's part ends the measurement too (D98).
        await Page.Keyboard.PressAsync("m");
        await ClickWorldAsync(5, 10, 30);
        await Expect(Label("reference")).ToHaveCountAsync(1);
        await Page.GetByTestId("model-eye").ClickAsync();
        await Expect(Page.GetByTestId("measure-label")).ToHaveCountAsync(0);
        await Expect(Page.GetByTestId("measure-reference")).ToHaveCountAsync(0);
    }

    [Fact]
    public async Task Measure_from_here_and_a_selected_feature_start_the_tool_from_them()
    {
        await LoadAsync("box.brep");

        // A right click on the front face: "Measure from here".
        var front = await ProjectAsync(5, 0, 15);
        await Page.Mouse.ClickAsync((float)front.X, (float)front.Y, new() { Button = MouseButton.Right });
        await Page.GetByTestId("context-measure").ClickAsync();
        await Expect(Page.GetByTestId("measure-button")).ToHaveAttributeAsync("aria-pressed", "true");
        await Expect(Page.GetByTestId("measure-reference")).ToContainTextAsync("300.000 mm²");

        // In Feature mode, the last selected feature becomes the reference.
        await Page.Keyboard.PressAsync("Escape");
        await Page.Keyboard.PressAsync("3");
        await ClickWorldAsync(5, 10, 30);
        await Expect(Page.GetByTestId("feature-title")).ToHaveTextAsync(["Face (plane) of box.brep"]);
        await Page.Keyboard.PressAsync("m");
        await Expect(Page.GetByTestId("measure-reference")).ToContainTextAsync("200.000 mm²");
        await Expect(Page.GetByTestId("feature-panel")).ToHaveCountAsync(0);
        AssertNoConsoleErrors();
    }

    private ILocator Label(string role) => Page.Locator($"[data-testid=measure-label][data-role={role}]");

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
