using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M8: models kept in the browser's private file system across reloads (decisions D82, D84,
/// D109–D117), through the real toolbar, list, dialogs and keys. Each test has a fresh browser
/// context, so a fresh store.
/// </summary>
public sealed class PersistenceTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private readonly Uri _address = app.BaseAddress;

    private ILocator Items => Page.GetByTestId("model-item");

    [Fact]
    public async Task Models_their_hidden_parts_and_the_camera_come_back_after_a_reload()
    {
        await RequireStoreAsync();
        await ImportWithToolbarAsync("box.brep", "part.glb");
        var before = await WaitForImportsAsync(2);
        await Items.Nth(0).GetByTestId("model-eye").ClickAsync(); // hides box.brep
        await Expect(Items.Nth(0).GetByTestId("model-eye")).ToHaveAttributeAsync("data-visibility", "hidden");
        await Page.GetByTestId("projection").GetByText("Perspective").ClickAsync();
        var centre = await ProjectAsync(0, 0, 30);
        await Page.Mouse.MoveAsync((float)centre.X + 40, (float)centre.Y);
        await Page.Mouse.WheelAsync(0, -200);
        await WaitForCameraRestAsync();
        var camera = await CameraAsync();

        await ReloadAsync();
        var after = await WaitForImportsAsync(2);

        // The same models, under the same ids, in the same order (D117), with box.brep still hidden.
        Assert.Equal(before.Select(static m => (m.Id, m.FileName)), after.Select(static m => (m.Id, m.FileName)));
        Assert.All(after, static m => Assert.Equal("loaded", m.Status));
        await Expect(Items.GetByTestId("model-name")).ToHaveTextAsync(["box.brep", "part.glb"]);
        await Expect(Items.Nth(0).GetByTestId("model-eye")).ToHaveAttributeAsync("data-visibility", "hidden");
        await Expect(Items.Nth(1).GetByTestId("model-eye")).ToHaveAttributeAsync("data-visibility", "visible");
        var box = await PartStateAsync(after[0].Id);
        Assert.Equal(box.Parts.Order(), box.Hidden.Order());

        // The camera is where it was, not fitted to the models again (D111).
        await WaitForCameraRestAsync();
        var restored = await CameraAsync();
        Assert.Equal("perspective", restored.Projection);
        AssertClose(camera.Position, restored.Position);
        AssertClose(camera.Target, restored.Target);

        // The toolbar knows the projection: switching back to orthographic works.
        await Page.GetByTestId("projection").GetByText("Orthographic").ClickAsync();
        await WaitForCameraRestAsync();
        Assert.Equal("orthographic", (await CameraAsync()).Projection);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Undoing_a_delete_imports_the_model_again_in_its_place_with_its_measurement()
    {
        await RequireStoreAsync();
        // The box (top at z = 30) stands inside coloured-part.step's 40 × 30 × 20 block (top at z = 20).
        await ImportWithToolbarAsync("box.brep", "coloured-part.step");
        var before = await WaitForImportsAsync(2);
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
        await Page.Keyboard.PressAsync("m");
        await ClickWorldAsync(5, 10, 30);
        await ClickWorldAsync(35, 25, 20);
        await Expect(Page.GetByTestId("measure-label")).ToHaveTextAsync("10.000 mm · 0.00°");

        await Items.Nth(0).GetByTestId("delete-model").ClickAsync();
        await Page.Locator(".mud-dialog").GetByTestId("confirm-delete").ClickAsync();
        await Expect(Items.GetByTestId("model-name")).ToHaveTextAsync(["coloured-part.step"]);
        await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(0);
        await Expect(Page.GetByTestId("measure-label")).ToBeHiddenAsync();

        await Page.Keyboard.PressAsync("Control+z");
        await Expect(Items.GetByTestId("model-name")).ToHaveTextAsync(["box.brep", "coloured-part.step"]);
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(2, new() { Timeout = 60_000 });
        Assert.Equal(before.Select(static m => m.Id).Order(), (await ModelsAsync()).Select(static m => m.Id).Order());
        await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(1);
        await Expect(Page.GetByTestId("measure-label")).ToHaveTextAsync("10.000 mm · 0.00°");
        await Expect(Page.GetByTestId("measure-label")).ToBeVisibleAsync();

        // Redone, the delete holds across a reload: only the other model comes back.
        await Page.Keyboard.PressAsync("Control+y");
        await Expect(Items.GetByTestId("model-name")).ToHaveTextAsync(["coloured-part.step"]);
        await ReloadAsync();
        var after = await WaitForImportsAsync(1);
        Assert.Equal(["coloured-part.step"], after.Select(static m => m.FileName));
        await Expect(Items).ToHaveCountAsync(1);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Clear_all_asks_first_and_leaves_nothing_to_come_back()
    {
        await RequireStoreAsync();
        await ImportWithToolbarAsync("box.brep", "part.stl");
        await WaitForImportsAsync(2);
        var dialog = Page.Locator(".mud-dialog");

        await Page.GetByTestId("clear-all").ClickAsync();
        await Expect(dialog).ToContainTextAsync("can't be undone");
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Cancel" }).ClickAsync();
        await Expect(dialog).ToBeHiddenAsync();
        await Expect(Items).ToHaveCountAsync(2);

        await Page.GetByTestId("clear-all").ClickAsync();
        await dialog.GetByTestId("confirm-clear-all").ClickAsync();
        await Expect(Items).ToHaveCountAsync(0);
        await Expect(Page.GetByTestId("clear-all")).ToBeDisabledAsync();
        await Expect(Page.GetByTestId("undo-button")).ToBeDisabledAsync();

        await ReloadAsync();
        await Expect(Page.GetByTestId("model-list-empty")).ToBeVisibleAsync();
        Assert.Empty(await ModelsAsync());
        Assert.Equal(0, await Page.EvaluateAsync<int>("() => window.__j3dTest.store().stored.length"));
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_second_tab_keeps_nothing_and_says_so()
    {
        await RequireStoreAsync();
        var second = await Context.NewPageAsync();
        await second.GotoAsync(_address.ToString());
        await second.WaitForFunctionAsync("() => window.__j3dTest !== undefined");

        await Expect(second.Locator(".mud-snackbar").Filter(new() { HasText = "J3D is open in another tab" })).ToBeVisibleAsync();
        Assert.Equal("otherTab", await second.EvaluateAsync<string>("async () => { await window.__j3dTest.storeIdle(); return window.__j3dTest.store().status; }"));
        await second.CloseAsync();
    }

    /// <summary>The store must have opened as this tab's.</summary>
    private async Task RequireStoreAsync()
    {
        var status = await Page.EvaluateAsync<string>("async () => { await window.__j3dTest.storeIdle(); return window.__j3dTest.store().status; }");
        Assert.Equal("kept", status);
    }

    /// <summary>Waits for the store to write everything, then reloads the page.</summary>
    private async Task ReloadAsync()
    {
        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
    }

    private async Task ClickWorldAsync(double x, double y, double z)
    {
        var point = await ProjectAsync(x, y, z);
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await Page.WaitForFunctionAsync("() => !window.__j3dTest.measureState().busy");
    }

    private static void AssertClose(double[] expected, double[] actual)
    {
        Assert.Equal(expected.Length, actual.Length);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i], actual[i], 1e-6 * Math.Max(1, Math.Abs(expected[i])));
        }
    }
}
