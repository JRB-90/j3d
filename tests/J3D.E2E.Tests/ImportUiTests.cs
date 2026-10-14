using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>The two ways a user imports in M3: the toolbar's Import button and dropping files on the viewport.</summary>
public sealed class ImportUiTests(J3DAppFixture app) : ViewerPageTest(app)
{
    [Fact]
    public async Task The_import_button_imports_the_picked_files_and_draws_them()
    {
        var input = Page.GetByTestId("import-input");
        await Expect(input).ToBeEnabledAsync(new LocatorAssertionsToBeEnabledOptions { Timeout = 30_000 });
        // A native label opens the picker (docs/plan.md §6.4).
        Assert.Equal(await input.GetAttributeAsync("id"), await Page.GetByTestId("import-button").GetAttributeAsync("for"));
        Assert.Contains(".step", await input.GetAttributeAsync("accept"), StringComparison.Ordinal);

        await input.SetInputFilesAsync([Fixtures.PathOf("coloured-part.step"), Fixtures.PathOf("part.stl")]);

        var models = await WaitForImportsAsync(2);
        Assert.All(models, m => Assert.Equal("loaded", m.Status));
        await WaitForCameraRestAsync();
        var pixel = Assert.Single(await SamplePixelsAsync(await ProjectAsync(20, 15, 20)));
        Assert.True(pixel.Brightness > 70, $"the model should be drawn: {pixel}");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Dragging_files_over_the_viewport_shows_the_overlay_and_dropping_imports_them()
    {
        var viewport = Page.GetByTestId("viewport");
        var overlay = Page.GetByTestId("drop-overlay");
        var dataTransfer = await Page.EvaluateHandleAsync(
            """
            async ([name, base64]) => {
              const transfer = new DataTransfer();
              transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name));
              return transfer;
            }
            """,
            new object[] { "box.brep", Convert.ToBase64String(await File.ReadAllBytesAsync(Fixtures.PathOf("box.brep"), TestContext.Current.CancellationToken)) });

        await Expect(overlay).ToBeHiddenAsync();
        await viewport.DispatchEventAsync("dragenter", new { dataTransfer });
        await Expect(overlay).ToBeVisibleAsync();
        await Expect(overlay).ToContainTextAsync("Drop files to import");
        await viewport.DispatchEventAsync("dragleave", new { dataTransfer });
        await Expect(overlay).ToBeHiddenAsync();

        await viewport.DispatchEventAsync("dragenter", new { dataTransfer });
        await viewport.DispatchEventAsync("dragover", new { dataTransfer });
        await viewport.DispatchEventAsync("drop", new { dataTransfer });

        await Expect(overlay).ToBeHiddenAsync();
        var model = Assert.Single(await WaitForImportsAsync(1));
        Assert.Equal(("box.brep", "loaded"), (model.FileName, model.Status));
        AssertNoConsoleErrors();
    }
}
