using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// Exporting edits, and Expand (M15, D145, D154, D155, D188–D197), through the real menus, keys and
/// downloads, each file imported again (R24). <c>assembly.step</c> is the bracket: Bracket (0) holding
/// the bottom plate (1), the top plate (2, at z = 35) and the pin (3, at (25, 25, 0)); in
/// <c>plant.step</c> the first robot's Gripper (20) is a compound part of two solids.
/// </summary>
public sealed class ExportEditTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int TopPlate = 2;
    private const int Pin = 3;
    private const int Gripper = 20;

    private ILocator Items => Page.GetByTestId("model-item");

    [Fact]
    public async Task Step_writes_the_edited_assembly_its_copies_deletions_and_names()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("Control+c");
        await Page.Keyboard.PressAsync("Control+v");
        await WaitForPartStateAsync(id, [], [4]);
        await Page.Keyboard.PressAsync("F2");
        await Page.GetByTestId("tree-rename").FillAsync("Spare pin");
        await Page.GetByTestId("tree-rename").PressAsync("Enter");
        await Expect(Page.GetByTestId("tree-rename")).ToHaveCountAsync(0);
        await ClickPartAsync(id, TopPlate);
        await Page.Keyboard.PressAsync("Delete");
        await WaitForPartStateAsync(id, [], []);

        var (name, bytes) = await DownloadAsync(async () =>
        {
            await Items.Nth(0).GetByTestId("export-model").Locator("button").ClickAsync();
            await Page.GetByTestId("export-step").ClickAsync();
        });

        Assert.Equal("assembly.step", name);
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal(
            [("Bracket assembly", -1, false), ("Plate (bottom)", 0, true), ("Pin", 0, true), ("Spare pin", 0, true)],
            again.Tree!.Select(static node => (node.Name, node.Parent, node.Prototype >= 0)));
        Assert.Equal(3, again.Stats!.Instances);
        Assert.Equal(2, again.Stats.Prototypes); // the pin's copy is the pin's shape
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_export_menu_saves_the_selection_as_step_under_its_assembly_path()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);

        var (name, bytes) = await DownloadAsync(async () =>
        {
            await Page.GetByTestId("export-menu").Locator("button").First.ClickAsync();
            await Expect(Page.GetByTestId("export-scope")).ToHaveTextAsync("Export the selection");
            await Page.GetByTestId("export-step").ClickAsync();
        });

        Assert.Equal("assembly.step", name); // D193
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal([("Bracket assembly", -1), ("Pin", 0)], again.Tree!.Select(static node => (node.Name, node.Parent)));
        Assert.Equal(21, again.Bounds!.Min[0], 0.01); // the pin at x = 25, 4 mm in radius
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Expand_splits_a_compound_part_keeps_it_across_a_reload_and_exports_its_pieces()
    {
        var id = await LoadAsync("plant.step");
        var parts = (await PartStateAsync(id)).Parts.Length;
        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        // A right click on the Gripper selects it and opens the menu (D164).
        var point = await PartPointAsync(id, Gripper);
        Assert.True(point is not null, "the Gripper should be in view");
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y, new MouseClickOptions { Button = MouseButton.Right });
        await Page.GetByTestId("context-expand").ClickAsync();

        await Page.WaitForFunctionAsync("([id, parts]) => window.__j3dTest.partState(id).parts.length === parts + 1", new object[] { id, parts });
        await Expect(Page.Locator($"[data-tree-node^=\"{id}:\"] .j3d-tree-node-name", new PageLocatorOptions { HasText = "Gripper 2" })).ToHaveCountAsync(1);

        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(1);
        await Page.WaitForFunctionAsync("([id, parts]) => window.__j3dTest.partState(id)?.parts.length === parts + 1", new object[] { id, parts });
        await Expect(Items.Nth(0).GetByTestId("model-warnings")).ToHaveCountAsync(0);

        var (name, bytes) = await DownloadAsync(async () =>
        {
            await Items.Nth(0).GetByTestId("export-model").Locator("button").ClickAsync();
            await Page.GetByTestId("export-step").ClickAsync();
        });
        var again = await ImportAgainAsync(name, bytes, 2);
        Assert.Equal(parts + 1, again.Stats!.Instances);
        var expanded = Array.FindIndex(again.Tree!, static node => node.Name == "Gripper" && node.Prototype < 0);
        Assert.Equal(["Gripper 1", "Gripper 2"], again.Tree!.Where(node => node.Parent == expanded).Select(static node => node.Name));
        Assert.Equal(5, again.Tree!.Count(static node => node.Name == "Gripper" && node.Prototype >= 0)); // the others as they were
        AssertNoConsoleErrors();
    }

    private async Task<string> LoadAsync(string fixture)
    {
        await ImportWithToolbarAsync(fixture);
        var model = Assert.Single(await WaitForImportsAsync(1));
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(1);
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
        return model.Id;
    }

    private async Task ClickPartAsync(string id, int node)
    {
        var point = await PartPointAsync(id, node);
        Assert.True(point is not null, $"part {node} should be in view");
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await Page.WaitForFunctionAsync("([id, node]) => window.__j3dTest.partState(id).selected.includes(node)", new object[] { id, node });
    }

    private async Task<(string Name, byte[] Bytes)> DownloadAsync(Func<Task> action)
    {
        var download = await Page.RunAndWaitForDownloadAsync(action, new PageRunAndWaitForDownloadOptions { Timeout = 60_000 });
        return (download.SuggestedFilename, await File.ReadAllBytesAsync(await download.PathAsync(), TestContext.Current.CancellationToken));
    }

    private async Task<TestModel> ImportAgainAsync(string name, byte[] bytes, int count)
    {
        await ImportAsync(new FilePayload { Name = name, MimeType = "application/octet-stream", Buffer = bytes });
        var model = (await WaitForImportsAsync(count))[count - 1];
        Assert.Equal("loaded", model.Status);
        return model;
    }
}
