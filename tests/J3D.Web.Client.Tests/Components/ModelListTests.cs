using J3D.Web.Client.Components;
using J3D.Blazor;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

public sealed class ModelListTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _viewer;

    public ModelListTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("removeModel", static _ => true).SetVoidResult();
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    [Fact]
    public void Says_when_there_are_no_models()
    {
        var cut = Render<ModelList>();

        Assert.Equal("No models yet. Import files, or drop them on the view.", cut.Find("[data-testid=model-list-empty]").TextContent);
        Assert.Empty(cut.FindAll("[data-testid=model-item]"));
    }

    [Fact]
    public async Task Lists_models_in_import_order_as_the_scene_changes()
    {
        var cut = Render<ModelList>();

        await AddAsync("m1", "a.step", ModelStatus.Loaded);
        await AddAsync("m2", "b.stl", ModelStatus.Queued);
        await AddAsync("m3", "c.step", ModelStatus.Failed);

        cut.WaitForAssertion(() => Assert.Equal(["a.step", "b.stl", "c.step"], Names(cut)));
        Assert.Equal(["loaded", "queued", "failed"], cut.FindAll("[data-testid=model-item]").Select(static i => i.GetAttribute("data-status")));

        await Renderer.Dispatcher.InvokeAsync(() => Scene.Remove(new ModelId("m2")));
        cut.WaitForAssertion(() => Assert.Equal(["a.step", "c.step"], Names(cut)));
    }

    [Fact]
    public async Task Cancelling_an_import_is_immediate()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        await AddAsync("m1", "a.step", ModelStatus.Importing);

        cut.WaitForElement("[data-testid=cancel-model]").Click();

        Assert.Equal(["m1"], RemovedIds());
    }

    [Fact]
    public async Task Dismissing_a_failure_is_immediate()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        await AddAsync("m1", "a.step", ModelStatus.Failed);

        cut.WaitForElement("[data-testid=dismiss-model]").Click();

        Assert.Equal(["m1"], RemovedIds());
    }

    [Fact]
    public async Task Deleting_a_loaded_model_asks_first_and_can_be_undone()
    {
        await StartViewerAsync();
        var dialogs = Render<MudDialogProvider>();
        var cut = Render<ModelList>();
        await AddAsync("m1", "gearbox.step", ModelStatus.Loaded);

        cut.WaitForElement("[data-testid=delete-model]").Click();
        dialogs.WaitForAssertion(() => Assert.Contains("Delete gearbox.step?", dialogs.Find(".mud-dialog").TextContent, StringComparison.Ordinal));

        dialogs.FindAll(".mud-dialog button").Single(static b => b.TextContent.Trim() == "Cancel").Click();
        dialogs.WaitForAssertion(() => Assert.Empty(dialogs.FindAll(".mud-dialog")));
        Assert.Single(Scene.Models);

        cut.Find("[data-testid=delete-model]").Click();
        dialogs.WaitForElement("[data-testid=confirm-delete]").Click();

        // The scene deletes it as an undoable step (D84); the Viewport has the viewer free it, keeping its files.
        cut.WaitForAssertion(() => Assert.Empty(Scene.Models));
        Assert.True(Scene.CanUndo);
        Assert.Empty(RemovedIds());
    }

    [Fact]
    public async Task Clear_all_asks_first_then_removes_every_model_and_the_history()
    {
        await StartViewerAsync();
        var dialogs = Render<MudDialogProvider>();
        var cut = Render<ModelList>();
        Assert.True(cut.Find("[data-testid=clear-all]").HasAttribute("disabled"));
        await AddAsync("m1", "gearbox.step", ModelStatus.Loaded);
        await AddAsync("m2", "shaft.step", ModelStatus.Importing);
        var cleared = 0;
        Scene.ClearAllRequested += () => cleared++;

        cut.WaitForAssertion(() => Assert.False(cut.Find("[data-testid=clear-all]").HasAttribute("disabled")));
        cut.Find("[data-testid=clear-all]").Click();
        dialogs.WaitForAssertion(() => Assert.Contains("can't be undone", dialogs.Find(".mud-dialog").TextContent, StringComparison.Ordinal));
        dialogs.FindAll(".mud-dialog button").Single(static b => b.TextContent.Trim() == "Cancel").Click();
        dialogs.WaitForAssertion(() => Assert.Empty(dialogs.FindAll(".mud-dialog")));
        Assert.Equal(2, Scene.Models.Count);

        cut.Find("[data-testid=clear-all]").Click();
        dialogs.WaitForElement("[data-testid=confirm-clear-all]").Click();
        cut.WaitForAssertion(() => Assert.Empty(Scene.Models));
        Assert.Equal(1, cleared);
        Assert.False(Scene.CanUndo);
        Assert.True(cut.Find("[data-testid=clear-all]").HasAttribute("disabled"));
    }

    /// <summary>Puts a model in the scene, taken as far as <paramref name="status"/>.</summary>
    private Task AddAsync(string id, string fileName, ModelStatus status) => Renderer.Dispatcher.InvokeAsync(() =>
    {
        var modelId = new ModelId(id);
        Scene.Add(Summary(id, fileName));
        switch (status)
        {
            case ModelStatus.Importing:
                Scene.ReportProgress(modelId, ImportPhase.Reading, 0.5);
                break;
            case ModelStatus.Loaded:
                Scene.MarkLoaded(modelId, Info());
                break;
            case ModelStatus.Failed:
                Scene.MarkFailed(modelId, ParseFailed);
                break;
        }
    });

    private static List<string> Names(IRenderedComponent<ModelList> cut) =>
        [.. cut.FindAll("[data-testid=model-name]").Select(static n => n.TextContent)];

    private List<string?> RemovedIds() =>
        [.. _viewer.Invocations.Where(static i => i.Identifier == "removeModel").Select(static i => i.Arguments[0] as string)];
}
