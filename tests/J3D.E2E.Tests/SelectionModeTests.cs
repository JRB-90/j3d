using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M12: selection modes (D146, D162), feature selection with totals (D163) and the context menu (D164),
/// through the real mouse, keys, toolbar and menus. <c>box.brep</c> is 10 × 20 × 30 from the origin, seen
/// from Home's front-right-top view; <c>plant.step</c> is the generated hierarchical assembly (D161).
/// </summary>
public sealed class SelectionModeTests(J3DAppFixture app) : ViewerPageTest(app)
{
    [Fact]
    public async Task Model_mode_selects_the_whole_model_and_the_keys_switch_modes()
    {
        await LoadAsync("plant.step");
        var plant = (await ModelsAsync())[0].Id;
        var point = await FirstPartPointAsync(plant, (await PartStateAsync(plant)).Parts);

        await Page.Keyboard.PressAsync("1");
        await Expect(Page.GetByTestId("mode-model")).ToHaveAttributeAsync("aria-pressed", "true");
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await WaitForAsync($"() => window.__j3dTest.partState('{plant}').selected.length === 146");
        await Expect(Page.GetByTestId("selection-title")).ToHaveTextAsync("plant.step");
        await Expect(Page.GetByTestId("selection-detail")).ToHaveTextAsync("Whole model · 146 parts");
        await Expect(Page.Locator("[data-testid=model-item][data-selected=true]")).ToHaveCountAsync(1);

        // Back to objects: the parts stay selected; a click then selects one part.
        await Page.Keyboard.PressAsync("2");
        await Expect(Page.GetByTestId("mode-object")).ToHaveAttributeAsync("aria-pressed", "true");
        Assert.Equal(146, (await PartStateAsync(plant)).Selected.Length);
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await WaitForAsync($"() => window.__j3dTest.partState('{plant}').selected.length === 1");
        await Expect(Page.Locator("[data-testid=model-item][data-selected=true]")).ToHaveCountAsync(0);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Feature_mode_selects_faces_edges_and_vertices_with_totals()
    {
        await LoadAsync("box.brep");
        await Page.GetByTestId("mode-feature").ClickAsync();
        await Expect(Page.GetByTestId("mode-feature")).ToHaveAttributeAsync("aria-pressed", "true");

        var top = await ProjectAsync(5, 10, 30);
        await Page.Mouse.MoveAsync((float)top.X, (float)top.Y);
        await WaitForAsync("() => window.__j3dTest.selectionState().hoveredFeature?.kind === 'face'");
        await Page.Mouse.ClickAsync((float)top.X, (float)top.Y);
        await Expect(Page.GetByTestId("feature-title")).ToHaveTextAsync(["Face (plane) of box.brep"]);

        var front = await ProjectAsync(5, 0, 15);
        await Page.Keyboard.DownAsync("Control");
        await Page.Mouse.ClickAsync((float)front.X, (float)front.Y);
        await Page.Keyboard.UpAsync("Control");
        await Expect(Page.GetByTestId("feature")).ToHaveCountAsync(2);
        await Expect(Page.GetByTestId("feature-totals")).ToContainTextAsync("500.000 mm²"); // 200 + 300
        Assert.False((await PartStateAsync((await ModelsAsync())[0].Id)).Selected.Length > 0, "features aren't parts");

        await Page.Keyboard.PressAsync("Escape");
        await Expect(Page.GetByTestId("feature")).ToHaveCountAsync(0);
        Assert.Empty(await FeaturesAsync());
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_context_menu_acts_on_its_target_or_the_scene()
    {
        await LoadAsync("assembly.step");
        var id = (await ModelsAsync())[0].Id;
        var tree = (await ModelsAsync())[0].Tree!;
        var pin = Array.FindIndex(tree, static node => node.Name == "Pin" && node.Prototype >= 0);
        var point = await PartPointAsync(id, pin);
        Assert.NotNull(point);

        // A right click on a part selects it and offers its commands; Hide hides it.
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y, new() { Button = MouseButton.Right });
        await Expect(Page.GetByTestId("context-hide")).ToBeVisibleAsync();
        await WaitForPartStateAsync(id, [], [pin]);
        await Page.GetByTestId("context-hide").ClickAsync();
        await WaitForPartStateAsync(id, [pin], []);

        // On empty space (near the canvas's bottom-left corner) it offers the scene's: Show all brings the pin back.
        var canvas = (await Page.GetByTestId("viewer-canvas").BoundingBoxAsync())!;
        await Page.Mouse.ClickAsync(canvas.X + 30, canvas.Y + canvas.Height - 30, new() { Button = MouseButton.Right });
        await Page.GetByTestId("context-show-all").ClickAsync();
        await WaitForPartStateAsync(id, [], []);

        // A right click on a tree node selects its parts and opens the same menu. The tree is open: the
        // first right click selected the pin, which revealed it there (D96).
        await Page.Locator("[data-testid=model-tree-node] .j3d-tree-node-name").First.ClickAsync(new() { Button = MouseButton.Right });
        await Expect(Page.GetByTestId("context-isolate")).ToBeVisibleAsync();
        Assert.Equal(3, (await PartStateAsync(id)).Selected.Length); // the root: every part
        await Page.Keyboard.PressAsync("Escape");
        AssertNoConsoleErrors();
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

    private async Task<ScreenPoint> FirstPartPointAsync(string id, int[] parts)
    {
        foreach (var part in parts)
        {
            if (await PartPointAsync(id, part) is { } point)
            {
                return point;
            }
        }

        throw new InvalidOperationException("No part of the model can be clicked.");
    }

    private async Task<JsonElement[]> FeaturesAsync() =>
        [.. (await Page.EvaluateAsync<JsonElement>("() => window.__j3dTest.selectionState().features")).EnumerateArray()];
}
