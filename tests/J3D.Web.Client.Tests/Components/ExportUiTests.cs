using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>Export (M9): the toolbar's menu for GLB and STL, and a BREP model's item for STEP and BREP (D119, D125).</summary>
public sealed class ExportUiTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _viewer;
    private readonly IRenderedComponent<MudPopoverProvider> _popovers;

    public ExportUiTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        _viewer.SetupVoid("cancelExport", static _ => true).SetVoidResult();
        _popovers = Render<MudPopoverProvider>();
    }

    [Fact]
    public async Task Export_waits_for_something_visible_and_says_what_it_saves()
    {
        var cut = Render<Toolbar>();
        await StartViewerAsync();
        Assert.True(ExportButton(cut).HasAttribute("disabled"));

        await cut.InvokeAsync(() => LoadBracket());
        cut.WaitForAssertion(() => Assert.False(ExportButton(cut).HasAttribute("disabled")));
        OpenExportMenu(cut);
        Assert.Equal("Export the visible scene", _popovers.Find("[data-testid=export-scope]").TextContent);
        Assert.Equal(["GLB", "STL (binary)", "STL (ASCII)"], MenuLabels());

        await cut.InvokeAsync(() => Scene.SelectNode(new ModelId("m1"), 1, additive: false));
        cut.WaitForAssertion(() => Assert.Equal("Export the selection", _popovers.Find("[data-testid=export-scope]").TextContent));

        await cut.InvokeAsync(() => Scene.ClearSelection());
        await cut.InvokeAsync(() => Scene.ToggleModelVisibility(new ModelId("m1")));
        cut.WaitForAssertion(() => Assert.True(ExportButton(cut).HasAttribute("disabled"))); // every part hidden
    }

    [Fact]
    public async Task Exports_the_selection_with_a_busy_button_until_it_is_saved()
    {
        var export = _viewer.Setup<ExportOutcome>("exportMesh", static _ => true);
        var cut = Render<Toolbar>();
        await StartViewerAsync();
        await cut.InvokeAsync(() => LoadBracket());
        await cut.InvokeAsync(() => Scene.SelectNode(new ModelId("m1"), 1, additive: false));

        OpenExportMenu(cut);
        _popovers.Find("[data-testid=export-stl-ascii]").Click();

        var invocation = Assert.Single(_viewer.Invocations, static i => i.Identifier == "exportMesh");
        Assert.Equal<object?>([MeshExportFormat.StlAscii, true], invocation.Arguments);
        cut.WaitForAssertion(() => Assert.Equal("true", cut.Find("[data-testid=export-menu]").GetAttribute("aria-busy")));
        Assert.True(ExportButton(cut).HasAttribute("disabled"));

        export.SetResult(new ExportOutcome("part.stl", Cancelled: false, Error: null));
        cut.WaitForAssertion(() => Assert.Equal("false", cut.Find("[data-testid=export-menu]").GetAttribute("aria-busy")));
        Assert.Empty(Snackbars.ShownSnackbars);
    }

    [Fact]
    public async Task A_failed_export_says_why()
    {
        _viewer.Setup<ExportOutcome>("exportMesh", static _ => true).SetResult(new ExportOutcome(null, false, "There are no visible parts to export."));
        var cut = Render<Toolbar>();
        await StartViewerAsync();
        await cut.InvokeAsync(() => LoadBracket());

        OpenExportMenu(cut);
        _popovers.Find("[data-testid=export-glb]").Click();

        cut.WaitForAssertion(() => Assert.Single(Snackbars.ShownSnackbars));
        var snackbar = Snackbars.ShownSnackbars.Single();
        Assert.Equal(("Couldn't export the scene as GLB: There are no visible parts to export.", Severity.Error), (snackbar.Message, snackbar.Severity));
    }

    [Fact]
    public void Only_a_brep_model_saves_itself()
    {
        Assert.NotNull(RenderItem(Loaded()).Find("[data-testid=export-model]"));
        Assert.Empty(RenderItem(Loaded(fileName: "part.glb", format: ModelFormat.Gltf)).FindAll("[data-testid=export-model]"));
        Assert.Empty(RenderItem(Queued()).FindAll("[data-testid=export-model]"));
    }

    [Fact]
    public async Task A_step_export_shows_its_progress_in_the_item_until_it_is_saved()
    {
        var export = _viewer.Setup<ExportOutcome>("exportModel", static _ => true);
        await StartViewerAsync();
        var cut = Render<ModelList>();
        await cut.InvokeAsync(() => LoadBracket());

        cut.Find("[data-testid=export-model] button").Click();
        _popovers.Find("[data-testid=export-step]").Click();

        var invocation = Assert.Single(_viewer.Invocations, static i => i.Identifier == "exportModel");
        Assert.Equal<object?>(["m1", BrepExportFormat.Step], invocation.Arguments);
        cut.WaitForAssertion(() => Assert.Equal("Exporting STEP…", Text(cut, "model-export-status")));
        Assert.Contains("mud-progress-indeterminate", cut.Find("[data-testid=export-progress]").ClassName, StringComparison.Ordinal);
        Assert.True(cut.Find("[data-testid=export-model] button").HasAttribute("disabled"));

        await cut.InvokeAsync(() => Scene.ReportExportProgress(new ModelId("m1"), 0.4));
        cut.WaitForAssertion(() => Assert.Equal("Exporting STEP · 40%", Text(cut, "model-export-status")));
        Assert.DoesNotContain("mud-progress-indeterminate", cut.Find("[data-testid=export-progress]").ClassName, StringComparison.Ordinal);

        export.SetResult(new ExportOutcome("part.step", Cancelled: false, Error: null));
        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=model-export]")));
        Assert.Null(Scene.Models[0].Export);
        Assert.Empty(Snackbars.ShownSnackbars);
    }

    [Fact]
    public async Task Cancel_stops_the_export_quietly_and_a_failure_says_why()
    {
        var export = _viewer.Setup<ExportOutcome>("exportModel", static _ => true);
        await StartViewerAsync();
        var cut = Render<ModelList>();
        await cut.InvokeAsync(() => LoadBracket());
        cut.Find("[data-testid=export-model] button").Click();
        _popovers.Find("[data-testid=export-brep]").Click();

        cut.WaitForElement("[data-testid=cancel-export]").Click();
        var cancel = Assert.Single(_viewer.Invocations, static i => i.Identifier == "cancelExport");
        Assert.Equal(["m1"], cancel.Arguments);
        export.SetResult(new ExportOutcome(null, Cancelled: true, Error: null));
        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=model-export]")));
        Assert.Empty(Snackbars.ShownSnackbars);
    }

    [Fact]
    public async Task A_failed_model_export_says_why()
    {
        _viewer.Setup<ExportOutcome>("exportModel", static _ => true).SetResult(new ExportOutcome(null, false, "Out of memory."));
        await StartViewerAsync();
        var cut = Render<ModelList>();
        await cut.InvokeAsync(() => LoadBracket());

        cut.Find("[data-testid=export-model] button").Click();
        _popovers.Find("[data-testid=export-step]").Click();

        cut.WaitForAssertion(() => Assert.Single(Snackbars.ShownSnackbars));
        Assert.Equal("Couldn't export part.step as STEP: Out of memory.", Snackbars.ShownSnackbars.Single().Message);
        Assert.Null(Scene.Models[0].Export);
    }

    private void LoadBracket()
    {
        Scene.Add(Summary("m1"));
        Scene.MarkLoaded(new ModelId("m1"), Info());
    }

    private IRenderedComponent<ModelListItem> RenderItem(ModelEntry model) =>
        Render<ModelListItem>(parameters => parameters.Add(item => item.Model, model));

    private static AngleSharp.Dom.IElement ExportButton(IRenderedComponent<Toolbar> cut) => cut.Find("[data-testid=export-menu] button");

    private void OpenExportMenu(IRenderedComponent<Toolbar> cut)
    {
        ExportButton(cut).Click();
        _popovers.WaitForElement("[data-testid=export-scope]");
    }

    private List<string> MenuLabels() =>
        [.. _popovers.FindAll(".mud-menu-item").Select(static item => item.TextContent.Trim())];

    private static string Text<T>(IRenderedComponent<T> cut, string testId)
        where T : Microsoft.AspNetCore.Components.IComponent =>
        cut.Find($"[data-testid={testId}]").TextContent.Trim();

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    private ISnackbar Snackbars => Services.GetRequiredService<ISnackbar>();
}
