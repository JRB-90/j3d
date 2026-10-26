using System.Text;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M9: exports through the real toolbar menu and list items (decisions D118–D128). Each file the
/// browser downloads is imported again and compared with what was exported: its tree, counts and
/// bounds.
/// </summary>
public sealed class ExportTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int Pin = 3;

    private ILocator Items => Page.GetByTestId("model-item");

    [Fact]
    public async Task Step_keeps_the_assembly_its_names_and_its_placements()
    {
        await ImportWithToolbarAsync("assembly.step");
        var original = Assert.Single(await WaitForImportsAsync(1));

        var (name, bytes) = await DownloadAsync(() => ExportModelAsync(0, "step"));

        Assert.Equal("assembly.step", name);
        Assert.StartsWith("ISO-10303-21;", Encoding.ASCII.GetString(bytes, 0, 13), StringComparison.Ordinal);
        await Expect(Items.Nth(0).GetByTestId("model-export")).ToHaveCountAsync(0);
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal(Shape(original.Tree!), Shape(again.Tree!));
        Assert.Equal((original.Stats!.Nodes, original.Stats.Prototypes, original.Stats.Instances), (again.Stats!.Nodes, again.Stats.Prototypes, again.Stats.Instances));
        AssertSameBounds(original.Bounds!, again.Bounds!);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Brep_writes_the_shape_as_imported()
    {
        await ImportWithToolbarAsync("box.brep");
        var original = Assert.Single(await WaitForImportsAsync(1));

        var (name, bytes) = await DownloadAsync(() => ExportModelAsync(0, "brep"));

        Assert.Equal("box.brep", name);
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal(original.Stats!.Triangles, again.Stats!.Triangles);
        AssertSameBounds(original.Bounds!, again.Bounds!);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_step_export_shows_its_progress_and_can_be_cancelled()
    {
        await ImportWithToolbarAsync("assembly.step");
        await WaitForImportsAsync(1);
        var downloads = 0;
        Page.Download += (_, _) => downloads++;
        await Page.EvaluateAsync("() => { window.__j3dTest.holdExports = true; }");

        await ExportModelAsync(0, "step");
        await Expect(Items.Nth(0).GetByTestId("model-export-status")).ToHaveTextAsync("Exporting STEP…");
        await Expect(Items.Nth(0).GetByTestId("export-model").Locator("button")).ToBeDisabledAsync();
        await Items.Nth(0).GetByTestId("cancel-export").ClickAsync();
        await Expect(Items.Nth(0).GetByTestId("model-export")).ToHaveCountAsync(0);

        // The model is still loaded and exports again.
        await Page.EvaluateAsync("() => { window.__j3dTest.holdExports = false; }");
        var (name, _) = await DownloadAsync(() => ExportModelAsync(0, "step"));
        Assert.Equal("assembly.step", name);
        Assert.Equal(1, downloads);
        await Expect(Page.Locator(".mud-snackbar", new() { HasText = "Couldn't export" })).ToHaveCountAsync(0);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Glb_saves_the_visible_scene_without_hidden_parts()
    {
        await ImportWithToolbarAsync("assembly.step");
        var original = Assert.Single(await WaitForImportsAsync(1));
        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        await TreeNode(original.Id, 0).GetByTestId("tree-node-toggle").ClickAsync();
        await TreeNode(original.Id, Pin).GetByTestId("tree-node-eye").ClickAsync();
        await WaitForPartStateAsync(original.Id, [Pin], []);

        var (name, bytes) = await DownloadAsync(() => ExportSceneAsync("glb", "Export the visible scene"));

        Assert.Equal("assembly.glb", name);
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal(["assembly.glb", "Bracket assembly", "Plate (bottom)", "Plate (top)"], again.Tree!.Select(static node => node.Name));
        Assert.Equal(2, again.Stats!.Instances);
        AssertSameBounds(original.Bounds!, again.Bounds!); // Z-up in millimetres, as shown (D118, D122)
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Stl_saves_only_the_selection_named_after_its_model()
    {
        await ImportWithToolbarAsync("box.brep", "part.stl");
        var models = await WaitForImportsAsync(2);
        var box = models.Single(static m => m.FileName == "box.brep");
        await Items.Nth(0).GetByTestId("model-tree-toggle").ClickAsync();
        await TreeNode(box.Id, 0).Locator(".j3d-tree-node-name").ClickAsync();
        await WaitForPartStateAsync(box.Id, [], [0]);

        var (name, bytes) = await DownloadAsync(() => ExportSceneAsync("stl", "Export the selection"));

        Assert.Equal("box.stl", name);
        var again = await ImportAgainAsync(name, bytes, 3);
        Assert.Equal(12, again.Stats!.Triangles);
        AssertSameBounds(box.Bounds!, again.Bounds!);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Ascii_stl_of_several_models_is_named_scene()
    {
        await ImportWithToolbarAsync("box.brep", "part.stl");
        var models = await WaitForImportsAsync(2);

        var (name, bytes) = await DownloadAsync(() => ExportSceneAsync("stl-ascii", "Export the visible scene"));

        Assert.Equal("scene.stl", name);
        Assert.StartsWith("solid ", Encoding.ASCII.GetString(bytes, 0, 6), StringComparison.Ordinal);
        var again = await ImportAgainAsync(name, bytes, 3);
        Assert.Equal(12 + 24, again.Stats!.Triangles);
        var min = models.Select(static m => m.Bounds!.Min).Aggregate(static (a, b) => [.. a.Zip(b, Math.Min)]);
        var max = models.Select(static m => m.Bounds!.Max).Aggregate(static (a, b) => [.. a.Zip(b, Math.Max)]);
        AssertSameBounds(new Bounds(min, max), again.Bounds!);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task J3ds_own_glb_comes_back_exactly_as_exported()
    {
        await ImportWithToolbarAsync("part.glb");
        var original = Assert.Single(await WaitForImportsAsync(1));

        var (name, bytes) = await DownloadAsync(() => ExportSceneAsync("glb", "Export the visible scene"));

        // glTF is in metres: J3D's GLB is in millimetres (D118), marked so (D123).
        Assert.Equal("part.glb", name);
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal(original.Tree!.Select(static n => n.Name), again.Tree!.Select(static n => n.Name));
        Assert.Equal(original.Stats, again.Stats);
        AssertSameBounds(new Bounds([.. original.Bounds!.Min.Select(static v => v * 1000)], [.. original.Bounds.Max.Select(static v => v * 1000)]), again.Bounds!);

        // Saved again on its own, it doesn't change: no second rotation or scale.
        await Items.Nth(1).GetByTestId("model-tree-toggle").ClickAsync();
        await TreeNode(again.Id, 0).Locator(".j3d-tree-node-name").ClickAsync();
        var (_, twice) = await DownloadAsync(() => ExportSceneAsync("glb", "Export the selection"));
        var third = await ImportAgainAsync(name, twice, 3);
        Assert.Equal(again.Stats, third.Stats);
        AssertSameBounds(again.Bounds!, third.Bounds!);
        AssertNoConsoleErrors();
    }

    private async Task ExportModelAsync(int item, string format)
    {
        await Items.Nth(item).GetByTestId("export-model").Locator("button").ClickAsync();
        await Page.GetByTestId($"export-{format}").ClickAsync();
    }

    private async Task ExportSceneAsync(string format, string scope)
    {
        var menu = Page.GetByTestId("export-menu").Locator("button").First;
        await Expect(menu).ToBeEnabledAsync();
        await menu.ClickAsync();
        await Expect(Page.GetByTestId("export-scope")).ToHaveTextAsync(scope);
        await Page.GetByTestId($"export-{format}").ClickAsync();
    }

    private async Task<(string Name, byte[] Bytes)> DownloadAsync(Func<Task> action)
    {
        var download = await Page.RunAndWaitForDownloadAsync(action, new PageRunAndWaitForDownloadOptions { Timeout = 60_000 });
        var path = await download.PathAsync();
        return (download.SuggestedFilename, await File.ReadAllBytesAsync(path));
    }

    /// <summary>Imports an exported file as a new model and waits for it to load.</summary>
    private async Task<TestModel> ImportAgainAsync(string name, byte[] bytes, int count)
    {
        await ImportAsync(new FilePayload { Name = name, MimeType = "application/octet-stream", Buffer = bytes });
        var models = await WaitForImportsAsync(count);
        var model = models[count - 1];
        Assert.Equal("loaded", model.Status);
        return model;
    }

    private static List<(string, int, int)> Shape(IEnumerable<TreeNode> tree) => [.. tree.Select(static n => (n.Name, n.Parent, n.Prototype))];

    private static void AssertSameBounds(Bounds expected, Bounds actual)
    {
        for (var axis = 0; axis < 3; axis++)
        {
            Assert.Equal(expected.Min[axis], actual.Min[axis], 0.01);
            Assert.Equal(expected.Max[axis], actual.Max[axis], 0.01);
        }
    }

    private ILocator TreeNode(string id, int node) => Page.Locator($"[data-tree-node=\"{id}:{node}\"]");
}
