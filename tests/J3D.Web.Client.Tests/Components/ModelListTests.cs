using J3D.Web.Client.Components;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Web.Client.Tests.TestModels;

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

        Assert.Equal("No models imported.", cut.Find("[data-testid=model-list-empty]").TextContent);
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
    public async Task Deleting_a_loaded_model_asks_first()
    {
        await StartViewerAsync();
        var dialogs = Render<MudDialogProvider>();
        var cut = Render<ModelList>();
        await AddAsync("m1", "gearbox.step", ModelStatus.Loaded);

        cut.WaitForElement("[data-testid=delete-model]").Click();
        dialogs.WaitForAssertion(() => Assert.Contains("Delete gearbox.step?", dialogs.Find(".mud-dialog").TextContent, StringComparison.Ordinal));
        Assert.Empty(RemovedIds());

        dialogs.FindAll(".mud-dialog button").Single(static b => b.TextContent.Trim() == "Cancel").Click();
        dialogs.WaitForAssertion(() => Assert.Empty(dialogs.FindAll(".mud-dialog")));
        Assert.Empty(RemovedIds());

        cut.Find("[data-testid=delete-model]").Click();
        dialogs.WaitForElement("[data-testid=confirm-delete]").Click();
        cut.WaitForAssertion(() => Assert.Equal(["m1"], RemovedIds()));
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
