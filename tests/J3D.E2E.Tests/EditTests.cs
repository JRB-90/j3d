using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// Assembly editing (M14, D151, D152, D180–D187) through the real keys, context menu, tree and its drag
/// and drop. <c>assembly.step</c> is the bracket: an assembly at the origin (node 0) holding the bottom
/// plate (1), the top plate (2, at z = 35) and the pin (3, at (25, 25, 0)).
/// </summary>
public sealed class EditTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int Bracket = 0;
    private const int BottomPlate = 1;
    private const int TopPlate = 2;
    private const int Pin = 3;

    [Fact]
    public async Task Copy_and_paste_add_a_part_in_the_same_place_and_undo_takes_it_away()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);

        await Page.Keyboard.PressAsync("Control+c");
        await Page.Keyboard.PressAsync("Control+v");

        await WaitForPartStateAsync(id, [], [4]);
        await AssertPartsAsync(id, 1, 2, 3, 4);
        await AssertWorldAsync(id, 4, 25, 25, 0);
        await Expect(Page.GetByTestId("model-status")).ToContainTextAsync("4 parts");
        Assert.Contains((4, "Pin", Bracket), await TreeAsync(id));

        await Page.Keyboard.PressAsync("Control+z");
        await WaitForPartStateAsync(id, [], [Pin]);
        await AssertPartsAsync(id, 1, 2, 3);
        await Expect(Page.GetByTestId("model-status")).ToContainTextAsync("3 parts");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task New_assembly_from_the_context_menu_opens_its_name_and_nothing_moves()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, TopPlate);
        await ClickPartAsync(id, BottomPlate, ctrl: true);
        var point = (await PartPointAsync(id, TopPlate))!;

        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y, new MouseClickOptions { Button = MouseButton.Right });
        await Page.GetByTestId("context-group").ClickAsync();
        var name = Page.GetByTestId("tree-rename");
        await Expect(name).ToBeFocusedAsync();
        await Expect(name).ToHaveValueAsync("Assembly 1");
        await name.FillAsync("Plates");
        await name.PressAsync("Enter");

        await Expect(name).ToHaveCountAsync(0);
        var tree = await TreeAsync(id);
        Assert.Contains((4, "Plates", Bracket), tree);
        Assert.Contains((BottomPlate, "Plate (bottom)", 4), tree);
        Assert.Contains((TopPlate, "Plate (top)", 4), tree);
        await AssertWorldAsync(id, TopPlate, 0, 0, 35);
        await AssertWorldAsync(id, 4, 0, 0, 0); // at its parent's origin (D184)
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_node_dragged_onto_an_assembly_moves_there_and_stays_put_in_3D()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, TopPlate);
        await Page.Keyboard.PressAsync("Control+g");
        await Page.GetByTestId("tree-rename").PressAsync("Escape");
        await Expect(TreeNode(id, 4)).ToBeVisibleAsync();

        await TreeNode(id, Pin).Locator(".j3d-tree-node-name").First.DragToAsync(TreeNode(id, 4).Locator(".j3d-tree-node-name").First);

        await Page.WaitForFunctionAsync(
            "id => document.querySelector(`[data-tree-node=\"${id}:3\"]`)?.dataset.treeParent === '4'",
            id);
        Assert.Contains((Pin, "Pin", 4), await TreeAsync(id));
        await AssertWorldAsync(id, Pin, 25, 25, 0);

        // And onto the model's name: the top level (D182).
        await TreeNode(id, Pin).Locator(".j3d-tree-node-name").First.DragToAsync(Page.GetByTestId("model-name"));
        await Page.WaitForFunctionAsync("id => window.__j3dTest.placement(id, 3)?.parentWorld[12] === 0 && document.querySelector(`[data-tree-node=\"${id}:3\"]`)?.dataset.treeParent === '-1'", id);
        Assert.Contains((Pin, "Pin", -1), await TreeAsync(id));
        await AssertWorldAsync(id, Pin, 25, 25, 0);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Edits_are_kept_across_a_reload()
    {
        var id = await LoadAsync("assembly.step");
        Assert.Equal("kept", await Page.EvaluateAsync<string>("async () => { await window.__j3dTest.storeIdle(); return window.__j3dTest.store().status; }"));
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("Delete");
        await WaitForPartStateAsync(id, [], []);
        await ClickPartAsync(id, TopPlate);
        await Page.Keyboard.PressAsync("Control+c");
        await Page.Keyboard.PressAsync("Control+v");
        await WaitForPartStateAsync(id, [], [4]);
        await Page.Keyboard.PressAsync("F2");
        await Page.GetByTestId("tree-rename").FillAsync("Spare plate");
        await Page.GetByTestId("tree-rename").PressAsync("Enter");
        await Expect(Page.GetByTestId("tree-rename")).ToHaveCountAsync(0);

        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(1);
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id)?.parts.length === 3", id);

        await AssertPartsAsync(id, 1, 2, 4);
        await Expect(Page.GetByTestId("model-status")).ToContainTextAsync("3 parts");
        await AssertWorldAsync(id, 4, 0, 0, 35);
        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        await ExpandAsync(id, Bracket);
        var tree = await TreeAsync(id);
        Assert.Contains((4, "Spare plate", Bracket), tree);
        Assert.DoesNotContain(tree, static node => node.Node == Pin);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_glb_export_saves_the_scene_as_edited()
    {
        var id = await LoadAsync("assembly.step");
        await ClickPartAsync(id, Pin);
        await Page.Keyboard.PressAsync("Control+c");
        await Page.Keyboard.PressAsync("Control+v");
        await WaitForPartStateAsync(id, [], [4]);

        await Page.Keyboard.PressAsync("Escape"); // clears the selection, so the export is the scene
        await WaitForPartStateAsync(id, [], []);
        await Page.GetByTestId("export-menu").Locator("button").First.ClickAsync();
        await Expect(Page.GetByTestId("export-scope")).ToHaveTextAsync("Export the visible scene");
        var download = await Page.RunAndWaitForDownloadAsync(() => Page.GetByTestId("export-glb").ClickAsync());
        var bytes = await File.ReadAllBytesAsync(await download.PathAsync(), TestContext.Current.CancellationToken);

        await ImportAsync(new FilePayload { Name = download.SuggestedFilename, MimeType = "application/octet-stream", Buffer = bytes });
        var again = (await WaitForImportsAsync(2))[1];
        Assert.Equal(4, again.Stats!.Instances);
        Assert.Equal(2, again.Tree!.Count(static node => node.Name == "Pin"));
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_mesh_model_copies_and_keeps_its_copy()
    {
        var id = await LoadAsync("part.glb");
        var part = (await PartStateAsync(id)).Parts[0];
        var point = (await PartPointAsync(id, part))!;
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).selected.length === 1", id);
        var selected = (await PartStateAsync(id)).Selected[0];
        var world = await WorldAsync(id, selected);

        await Page.Keyboard.PressAsync("Control+c");
        await Page.Keyboard.PressAsync("Control+v");

        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).parts.length === 3", id);
        var copy = (await PartStateAsync(id)).Selected.Single();
        Assert.Equal(world, await WorldAsync(id, copy));

        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(1);
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id)?.parts.length === 3", id);
        Assert.Equal(world, await WorldAsync(id, copy));
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

    private ILocator TreeNode(string id, int node) => Page.Locator($"[data-tree-node=\"{id}:{node}\"]");

    private async Task ExpandAsync(string id, int node) =>
        await TreeNode(id, node).GetByTestId("tree-node-toggle").ClickAsync();

    /// <summary>The tree as shown: each node's id, name and parent node (-1 at the top level).</summary>
    private async Task<List<(int Node, string Name, int Parent)>> TreeAsync(string id)
    {
        var rows = await Page.EvaluateAsync<JsonElement>(
            """
            id => [...document.querySelectorAll(`[data-tree-node^="${id}:"]`)].map(row =>
              [Number(row.dataset.treeNode.split(':').pop()), row.querySelector('.j3d-tree-node-name')?.textContent ?? '', Number(row.dataset.treeParent)])
            """,
            id);
        return [.. rows.EnumerateArray().Select(static row => (row[0].GetInt32(), row[1].GetString()!, row[2].GetInt32()))];
    }

    private async Task AssertPartsAsync(string id, params int[] parts)
    {
        var actual = (await PartStateAsync(id)).Parts;
        Assert.Equal(parts, actual);
    }

    private async Task AssertWorldAsync(string id, int node, params double[] expected)
    {
        var actual = await WorldAsync(id, node);
        Assert.Equal(expected, actual);
    }

    /// <summary>Where a node's origin is in the world, to 3 decimals.</summary>
    private async Task<double[]> WorldAsync(string id, int node)
    {
        var world = await Page.EvaluateAsync<double[]>(
            """
            ([id, node]) => {
              const { local, parentWorld } = window.__j3dTest.placement(id, node);
              return [12, 13, 14].map(i => parentWorld[i % 4] * local[12] + parentWorld[4 + i % 4] * local[13] + parentWorld[8 + i % 4] * local[14] + parentWorld[i]);
            }
            """,
            new object[] { id, node });
        return [.. world.Select(static value => Math.Round(value, 3) + 0.0)];
    }
}
