using System.Text.RegularExpressions;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// The model list in the drawer (docs/plan.md §6.4, decisions D52–D57), driven through the real
/// toolbar input, list buttons and dialog. The test hook only confirms what the viewer did (D59).
/// </summary>
public sealed partial class ModelListTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private ILocator Items => Page.GetByTestId("model-item");

    [Fact]
    public async Task Imported_models_are_listed_in_import_order_with_their_stats()
    {
        await ImportWithToolbarAsync("coloured-part.step", "part.stl");
        await WaitForImportsAsync(2);

        await Expect(Items.GetByTestId("model-name")).ToHaveTextAsync(["coloured-part.step", "part.stl"]);
        await Expect(Items.Nth(0)).ToHaveAttributeAsync("data-status", "loaded");
        await Expect(Items.Nth(1)).ToHaveAttributeAsync("data-status", "loaded");
        await Expect(Items.Nth(0).GetByTestId("model-format")).ToHaveTextAsync("STEP");
        await Expect(Items.Nth(0).GetByTestId("model-kind")).ToHaveTextAsync("BREP");
        await Expect(Items.Nth(0).GetByTestId("model-status")).ToHaveTextAsync(StatsPattern());
        await Expect(Items.Nth(1).GetByTestId("model-format")).ToHaveTextAsync("STL");
        await Expect(Items.Nth(1).GetByTestId("model-kind")).ToHaveTextAsync("mesh");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Cancelling_an_import_removes_it_and_ends_its_worker()
    {
        await HoldImportsAsync(true);
        await ImportWithToolbarAsync("box.brep");
        await WaitForAsync("() => window.__j3dTest.events.some(e => e.type === 'held')");
        await Expect(Items).ToHaveAttributeAsync("data-status", PendingPattern());

        await Items.GetByTestId("cancel-model").ClickAsync();

        await Expect(Items).ToHaveCountAsync(0);
        await Expect(Page.GetByTestId("model-list-empty")).ToBeVisibleAsync();
        Assert.Empty(await ModelsAsync());
        Assert.Equal(0, await LiveWorkersAsync());
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Deleting_asks_first_and_cancelling_the_dialog_keeps_the_model()
    {
        await ImportWithToolbarAsync("box.brep");
        await WaitForImportsAsync(1);
        var dialog = Page.Locator(".mud-dialog");

        await Items.GetByTestId("delete-model").ClickAsync();
        await Expect(dialog).ToContainTextAsync("Delete box.brep?");
        await dialog.GetByRole(AriaRole.Button, new LocatorGetByRoleOptions { Name = "Cancel" }).ClickAsync();
        await Expect(dialog).ToBeHiddenAsync();
        await Expect(Items).ToHaveCountAsync(1);
        Assert.Single(await ModelsAsync());

        await Items.GetByTestId("delete-model").ClickAsync();
        await dialog.GetByTestId("confirm-delete").ClickAsync();

        await Expect(Items).ToHaveCountAsync(0);
        Assert.Empty(await ModelsAsync());
        Assert.Equal(0, await Page.EvaluateAsync<int>("() => window.__j3dTest.scene().length"));
        Assert.Equal(0, await LiveWorkersAsync());
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_failed_import_is_reported_and_can_be_dismissed()
    {
        await ImportWithToolbarAsync("invalid.step");
        await WaitForImportsAsync(1);

        await Expect(Items).ToHaveAttributeAsync("data-status", "failed");
        await Expect(Items.GetByTestId("model-status")).ToContainTextAsync("Parse failed:");
        await Expect(Snackbar("Couldn't import invalid.step")).ToBeVisibleAsync();

        await Items.GetByTestId("dismiss-model").ClickAsync();

        await Expect(Items).ToHaveCountAsync(0);
        Assert.Empty(await ModelsAsync());
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_rejected_file_is_reported_in_a_snackbar_and_not_listed()
    {
        await ImportWithToolbarAsync(new FilePayload { Name = "notes.txt", MimeType = "text/plain", Buffer = "J3D"u8.ToArray() });

        await Expect(Snackbar("Skipped notes.txt: .txt files aren't supported.")).ToBeVisibleAsync();
        await Expect(Page.GetByTestId("model-list-empty")).ToBeVisibleAsync();
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task The_assembly_tree_opens_a_level_at_a_time()
    {
        await ImportWithToolbarAsync("assembly.step");
        await WaitForImportsAsync(1);
        var nodes = Items.Locator("[data-testid=model-tree] .mud-treeview-item-content");

        await Items.GetByTestId("model-tree-toggle").ClickAsync();
        await Expect(nodes).ToHaveTextAsync(["Bracket assembly"]);

        // Clicking a node's name selects it (M6); its arrow expands it.
        await nodes.First.Locator(".mud-treeview-item-arrow button").ClickAsync();
        await Expect(nodes).ToHaveTextAsync(["Bracket assembly", "Plate (bottom)", "Plate (top)", "Pin"]);
        AssertNoConsoleErrors();
    }

    private ILocator Snackbar(string text) =>
        Page.Locator(".mud-snackbar").Filter(new LocatorFilterOptions { HasText = text });

    /// <summary>A held import may not have reported any progress yet.</summary>
    [GeneratedRegex("^(queued|importing)$")]
    private static partial Regex PendingPattern();

    /// <summary>coloured-part.step is one 12-triangle block.</summary>
    [GeneratedRegex(@"^[\d.]+ [KMG]?B in memory · 12 triangles · 1 part$")]
    private static partial Regex StatsPattern();
}
