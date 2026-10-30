using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M18 (D210, D225–D233): objects moved and copied between models with the real mouse and keys, kept
/// across a reload, undone, and refused between a CAD model and a mesh model. <c>assembly.step</c> is the
/// bracket: Bracket assembly (0) holding the bottom plate (1), the top plate (2) and the pin (3), placed at
/// (25, 25, 0).
/// </summary>
public sealed class TransferTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private const int Pin = 3;

    /// <summary>Where the pin is in the world.</summary>
    private static readonly double[] PinWorld = [25, 25, 0];

    [Fact]
    public async Task A_ctrl_drag_copies_a_part_into_another_model_where_it_was_and_a_reload_keeps_it()
    {
        var (bracket, other) = await LoadAsync("assembly.step", "translucent.step");
        Assert.Equal("kept", await Page.EvaluateAsync<string>("async () => { await window.__j3dTest.storeIdle(); return window.__j3dTest.store().status; }"));
        var before = (await PartStateAsync(other)).Parts.Length;
        await OpenTreeAsync("assembly.step", bracket);

        await Page.Keyboard.DownAsync("Control");
        await TreeNode(bracket, Pin).Locator(".j3d-tree-node-name").First.DragToAsync(ModelName(other));
        await Page.Keyboard.UpAsync("Control");

        var copy = await WaitForNewPartAsync(other, before);
        Assert.Equal(PinWorld, await WorldAsync(other, copy));
        Assert.Equal(3, (await PartStateAsync(bracket)).Parts.Length); // a copy leaves the bracket as it was
        Assert.Equal([copy], (await PartStateAsync(other)).Selected);
        await Expect(Page.GetByTestId("model-bringing")).ToHaveCountAsync(0);

        await Page.Keyboard.PressAsync("Control+z");
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count", new object[] { other, before });
        await Page.Keyboard.PressAsync("Control+y");
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count + 1", new object[] { other, before });

        // Kept with the model it went to: its file comes back from that model's folder (D225).
        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(2);
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count + 1", new object[] { other, before });
        Assert.Equal(PinWorld, await WorldAsync(other, copy));
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Cut_and_paste_move_a_part_out_of_one_model_into_another_as_one_step()
    {
        var (bracket, other) = await LoadAsync("assembly.step", "translucent.step");
        var before = (await PartStateAsync(other)).Parts.Length;
        await OpenTreeAsync("assembly.step", bracket);
        await TreeNode(bracket, Pin).Locator(".j3d-tree-node-name").First.ClickAsync();
        await Page.Keyboard.PressAsync("Control+x");

        // Paste goes where the selection is (D226): the other model's first node.
        await OpenTreeAsync("translucent.step", other);
        await TreeNode(other, 0).Locator(".j3d-tree-node-name").First.ClickAsync();
        await Page.Keyboard.PressAsync("Control+v");

        var moved = await WaitForNewPartAsync(other, before);
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id)?.parts.length === 2", bracket);
        Assert.Equal(PinWorld, await WorldAsync(other, moved));

        await Page.GetByTestId("undo-button").HoverAsync();
        await Expect(Page.GetByText("Undo Move to translucent.step (Ctrl+Z)")).ToBeVisibleAsync();
        await Page.Keyboard.PressAsync("Control+z");
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id)?.parts.length === 3", bracket);
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count", new object[] { other, before });
        AssertNoConsoleErrors();
    }

    /// <summary>
    /// D246 (M20): an undone copy's arrival file stays while the undo history could bring it back, and goes
    /// when the model is restored after a reload, since the history doesn't survive one.
    /// </summary>
    [Fact]
    public async Task An_undone_copy_leaves_no_file_behind_after_a_reload()
    {
        var (bracket, other) = await LoadAsync("assembly.step", "translucent.step");
        var before = (await PartStateAsync(other)).Parts.Length;
        await OpenTreeAsync("assembly.step", bracket);
        await TreeNode(bracket, Pin).Locator(".j3d-tree-node-name").First.ClickAsync();
        await Page.Keyboard.PressAsync("Control+c");
        await OpenTreeAsync("translucent.step", other);
        await TreeNode(other, 0).Locator(".j3d-tree-node-name").First.ClickAsync();
        await Page.Keyboard.PressAsync("Control+v");
        await WaitForNewPartAsync(other, before);
        await Page.Keyboard.PressAsync("Control+z");
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count", new object[] { other, before });
        Assert.Single(await ArrivalFilesAsync(other)); // Redo could still use it

        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(2);
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count", new object[] { other, before });

        await Page.WaitForFunctionAsync(
            "async id => { await window.__j3dTest.storeIdle(); const models = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('j3d')).getDirectoryHandle('models'); for await (const name of (await models.getDirectoryHandle(id)).keys()) if (name.startsWith('arrival-')) return false; return true; }",
            other);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_cad_part_dropped_on_a_mesh_model_is_refused_saying_why()
    {
        var (bracket, mesh) = await LoadAsync("assembly.step", "part.stl");
        await OpenTreeAsync("assembly.step", bracket);

        await TreeNode(bracket, Pin).Locator(".j3d-tree-node-name").First.DragToAsync(ModelName(mesh));

        await Expect(Page.Locator(".mud-snackbar", new() { HasText = "objects move only between CAD models, or between mesh models" })).ToBeVisibleAsync();
        Assert.Equal(3, (await PartStateAsync(bracket)).Parts.Length);
        Assert.Single((await PartStateAsync(mesh)).Parts);
    }

    [Fact]
    public async Task A_mesh_part_copied_into_another_mesh_model_comes_back_after_a_reload()
    {
        var (stl, obj) = await LoadAsync("part.stl", "part.obj");
        Assert.Equal("kept", await Page.EvaluateAsync<string>("async () => { await window.__j3dTest.storeIdle(); return window.__j3dTest.store().status; }"));
        var before = (await PartStateAsync(obj)).Parts.Length;
        var part = Assert.Single((await PartStateAsync(stl)).Parts);
        var world = await WorldAsync(stl, part);
        await OpenTreeAsync("part.stl", stl);

        await Page.Keyboard.DownAsync("Control");
        await TreeNode(stl, part).Locator(".j3d-tree-node-name").First.DragToAsync(ModelName(obj));
        await Page.Keyboard.UpAsync("Control");

        var copy = await WaitForNewPartAsync(obj, before);
        Assert.Equal(world, await WorldAsync(obj, copy));

        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await WaitForImportsAsync(2);
        await Page.WaitForFunctionAsync("([id, count]) => window.__j3dTest.partState(id)?.parts.length === count + 1", new object[] { obj, before });
        Assert.Equal(world, await WorldAsync(obj, copy));
        AssertNoConsoleErrors();
    }

    /// <summary>Imports two fixtures through the toolbar and waits until both are loaded; their ids, in that order.</summary>
    /// <summary>The arrival files kept in a model's folder (M18), once the store has written everything asked of it.</summary>
    private async Task<string[]> ArrivalFilesAsync(string id) =>
        await Page.EvaluateAsync<string[]>(
            "async id => { await window.__j3dTest.storeIdle(); const models = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('j3d')).getDirectoryHandle('models'); const names = []; for await (const name of (await models.getDirectoryHandle(id)).keys()) if (name.startsWith('arrival-')) names.push(name); return names; }",
            id);

    private async Task<(string First, string Second)> LoadAsync(string first, string second)
    {
        await ImportWithToolbarAsync(first, second);
        var models = await WaitForImportsAsync(2);
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(2);
        return (models.Single(model => model.FileName == first).Id, models.Single(model => model.FileName == second).Id);
    }

    /// <summary>Opens a model's tree and its top-level nodes.</summary>
    private async Task OpenTreeAsync(string fileName, string id)
    {
        var item = Page.Locator("[data-testid=model-item]").Filter(new() { HasText = fileName });
        await item.GetByTestId("model-tree-toggle").ClickAsync();
        await Expect(TreeNode(id, 0)).ToBeVisibleAsync();
        if (await TreeNode(id, 0).GetByTestId("tree-node-toggle").CountAsync() > 0 &&
            await TreeNode(id, 0).GetAttributeAsync("aria-expanded") != "true")
        {
            await TreeNode(id, 0).GetByTestId("tree-node-toggle").ClickAsync();
        }
    }

    /// <summary>The part a model gained, once it has one more than <paramref name="before"/>.</summary>
    private async Task<int> WaitForNewPartAsync(string id, int before)
    {
        await Page.WaitForFunctionAsync(
            "([id, count]) => window.__j3dTest.partState(id)?.parts.length === count + 1",
            new object[] { id, before },
            new PageWaitForFunctionOptions { Timeout = 30_000 });
        return (await PartStateAsync(id)).Parts.Max();
    }

    private ILocator TreeNode(string id, int node) => Page.Locator($"[data-tree-node=\"{id}:{node}\"]");

    private ILocator ModelName(string id) => Page.Locator($"[data-model-drop=\"{id}\"]");

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
