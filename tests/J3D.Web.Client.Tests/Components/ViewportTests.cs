using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

public sealed class ViewportTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _viewer;
    private readonly JSRuntimeInvocationHandler<StoredScene> _restoreScene;

    public ViewportTests()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("dispose").SetVoidResult();
        _viewer.SetupVoid("setPartState", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setModelOrder", static _ => true).SetVoidResult();
        _viewer.SetupVoid("restoreModels", static _ => true).SetVoidResult();
        _viewer.SetupVoid("removeModel", static _ => true).SetVoidResult();
        _viewer.SetupVoid("forgetModel", static _ => true).SetVoidResult();
        _viewer.SetupVoid("clearAll").SetVoidResult();
        _viewer.SetupVoid("fitAll").SetVoidResult();
        _restoreScene = _viewer.Setup<StoredScene>("restoreScene");
        _restoreScene.SetResult(StoredScene.Empty);
    }

    [Fact]
    public void Creates_the_viewer_on_first_render()
    {
        var cut = Render<Viewport>();

        var invocation = Assert.Single(JSInterop.Invocations, static i => i.Identifier == "createViewer");
        Assert.Equal(2, invocation.Arguments.Count);
        Assert.NotNull(cut.Find("[data-testid=viewport]"));
    }

    [Fact]
    public async Task Reports_capabilities_and_warns_when_webgl2_is_missing()
    {
        ViewerCapabilities? reported = null;
        var cut = Render<Viewport>(parameters => parameters
            .Add(viewport => viewport.OnReady, capabilities => reported = capabilities));

        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: false, CrossOriginIsolated: true)));

        Assert.Equal(new ViewerCapabilities(false, true), reported);
        Assert.Contains("WebGL2", cut.Find(".mud-alert").TextContent, StringComparison.Ordinal);
        Assert.False(Session.IsReady);
    }

    [Fact]
    public async Task Shows_no_warning_and_shares_the_viewer_when_supported()
    {
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        Assert.Empty(cut.FindAll(".mud-alert"));
        Assert.True(Session.IsReady);
    }

    [Fact]
    public async Task Disposes_the_viewer_and_leaves_the_session()
    {
        var cut = Render<Viewport>();
        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));
        await cut.InvokeAsync(() => cut.Instance.OnModelQueued(Summary("m1")));

        await DisposeComponentsAsync();

        Assert.Single(_viewer.Invocations, static i => i.Identifier == "dispose");
        Assert.False(Session.IsReady);
        Assert.Empty(Scene.Models); // the models went with the viewer
    }

    [Fact]
    public async Task Relays_the_viewers_model_events_into_the_scene()
    {
        var cut = Render<Viewport>();
        var id = new ModelId("m1");

        await cut.InvokeAsync(() => cut.Instance.OnModelQueued(Summary("m1", "gearbox.step")));
        Assert.Equal(ModelStatus.Queued, Assert.Single(Scene.Models).Status);

        await cut.InvokeAsync(() => cut.Instance.OnModelProgress(id, ImportPhase.Meshing, 0.5));
        Assert.Equal((ModelStatus.Importing, ImportPhase.Meshing), (Scene.Models[0].Status, Scene.Models[0].Phase));

        var info = Info();
        await cut.InvokeAsync(() => cut.Instance.OnModelLoaded(id, info));
        Assert.Same(info, Scene.Models[0].Info);

        await cut.InvokeAsync(() => cut.Instance.OnModelRemoved(id));
        Assert.Empty(Scene.Models);
        Assert.Empty(Snackbars.ShownSnackbars);
    }

    [Fact]
    public async Task A_failed_import_stays_in_the_list_and_is_reported_in_a_snackbar()
    {
        var cut = Render<Viewport>();
        await cut.InvokeAsync(() => cut.Instance.OnModelQueued(Summary("m1", "gearbox.step")));

        await cut.InvokeAsync(() => cut.Instance.OnModelFailed(new ModelId("m1"), ParseFailed));

        Assert.Equal(ModelStatus.Failed, Assert.Single(Scene.Models).Status);
        var snackbar = Assert.Single(Snackbars.ShownSnackbars);
        Assert.Equal(("Couldn't import gearbox.step: Not a readable STEP file.", Severity.Error), (snackbar.Message, snackbar.Severity));
    }

    [Fact]
    public async Task A_rejected_file_is_reported_in_a_snackbar_only()
    {
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnImportRejected("notes.txt", ".txt files aren't supported."));

        Assert.Empty(Scene.Models);
        var snackbar = Assert.Single(Snackbars.ShownSnackbars);
        Assert.Equal(("Skipped notes.txt: .txt files aren't supported.", Severity.Warning), (snackbar.Message, snackbar.Severity));
    }

    [Fact]
    public async Task Relays_picks_and_key_commands_into_the_scene()
    {
        var cut = await LoadedAsync();

        await cut.InvokeAsync(() => cut.Instance.OnPartPicked("m1", 3, additive: false));
        Assert.Equal([3], Scene.Models[0].Selected);
        await cut.InvokeAsync(() => cut.Instance.OnPartPicked("m1", 1, additive: true));
        Assert.Equal([1, 3], Scene.Models[0].Selected.Order());

        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("hide"));
        Assert.Equal([1, 3], Scene.Models[0].Hidden.Order());
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("undo"));
        Assert.Empty(Scene.Models[0].Hidden);
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("redo"));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("showAll"));
        Assert.Empty(Scene.Models[0].Hidden);

        await cut.InvokeAsync(() => cut.Instance.OnPartPicked("m1", 4, additive: false));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("isolate"));
        Assert.Equal([1, 3], Scene.Models[0].Hidden.Order());
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("clearSelection"));
        Assert.False(Scene.HasSelection);

        await cut.InvokeAsync(() => cut.Instance.OnPartPicked("m1", 4, additive: false));
        await cut.InvokeAsync(() => cut.Instance.OnPartPicked(null, -1, additive: false));
        Assert.False(Scene.HasSelection);
    }

    [Fact]
    public async Task Sends_a_models_hidden_and_selected_parts_to_the_viewer_only_when_they_change()
    {
        var cut = await LoadedAsync();
        Assert.Empty(PartStates()); // nothing hidden or selected yet

        await cut.InvokeAsync(() => cut.Instance.OnPartPicked("m1", 3, additive: false));
        await cut.InvokeAsync(() => cut.Instance.OnModelProgress(new ModelId("m1"), ImportPhase.Meshing, 0.5)); // no change to parts
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("hide"));

        Assert.Equal(
            [("m1", "", "3"), ("m1", "3", "")],
            PartStates());
    }

    [Fact]
    public async Task Isolate_fits_the_view_once_the_viewer_has_hidden_the_rest()
    {
        var cut = await LoadedAsync();
        await cut.InvokeAsync(() => cut.Instance.OnPartPicked("m1", 3, additive: false));

        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("isolate"));

        cut.WaitForAssertion(() => Assert.Contains(_viewer.Invocations, static i => i.Identifier == "fitAll"));
        var calls = _viewer.Invocations.Select(static i => i.Identifier).ToList();
        Assert.True(calls.LastIndexOf("setPartState") < calls.IndexOf("fitAll"), "the fit comes after the parts are hidden");
        Assert.Single(calls, static c => c == "fitAll");
    }

    [Fact]
    public async Task Lists_the_kept_models_and_restores_the_projection_once_the_viewer_is_ready()
    {
        _restoreScene.SetResult(new StoredScene(
            StoreStatus.Kept,
            [new StoredModel(Summary("k1", "a.step"), [3]), new StoredModel(Summary("k2", "b.stl", ModelFormat.Stl), [])],
            new StoredCamera(Projection.Perspective)));
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Equal(["k1", "k2"], Scene.Models.Select(static model => model.Id.Value)));
        Assert.Equal(Projection.Perspective, Session.Projection);
        var restored = Assert.Single(_viewer.Invocations, static i => i.Identifier == "restoreModels");
        var models = (StoredModel[])restored.Arguments[0]!;
        Assert.Equal([("k1", "3"), ("k2", "")], models.Select(static m => (m.Summary.Id.Value, string.Join(',', m.Hidden))));
        cut.WaitForAssertion(() => Assert.Equal("k1,k2", string.Join(',', (string[])_viewer.Invocations.Last(static i => i.Identifier == "setModelOrder").Arguments[0]!)));
        Assert.Empty(Snackbars.ShownSnackbars);
    }

    [Theory]
    [InlineData(StoreStatus.OtherTab, "J3D is open in another tab, so the models you import here won't be kept for your next visit.")]
    [InlineData(StoreStatus.Unavailable, "This browser can't keep models for your next visit.")]
    public async Task Says_when_this_tab_wont_keep_its_models(StoreStatus status, string message)
    {
        _restoreScene.SetResult(StoredScene.Empty with { Status = status });
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Equal((message, Severity.Info), (Assert.Single(Snackbars.ShownSnackbars).Message, Assert.Single(Snackbars.ShownSnackbars).Severity)));
        Assert.Equal(Projection.Orthographic, Session.Projection);
    }

    [Theory]
    [InlineData(1, "A kept model couldn't be read this time. It's still kept, and J3D will try it again next time.")]
    [InlineData(2, "2 kept models couldn't be read this time. They're still kept, and J3D will try them again next time.")]
    public async Task Says_when_kept_models_couldnt_be_read(int unreadable, string message)
    {
        // M16 (D200): the store keeps them for the next visit rather than deleting them.
        _restoreScene.SetResult(StoredScene.Empty with { Unreadable = unreadable });
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Equal((message, Severity.Warning), (Assert.Single(Snackbars.ShownSnackbars).Message, Assert.Single(Snackbars.ShownSnackbars).Severity)));
    }

    [Fact]
    public async Task Has_the_viewer_delete_restore_forget_and_clear_models_as_the_scene_asks()
    {
        var cut = await LoadedAsync();

        await cut.InvokeAsync(() => Scene.Delete(new ModelId("m1")));
        await cut.InvokeAsync(Scene.Undo);
        await cut.InvokeAsync(Scene.ClearAll);

        var calls = _viewer.Invocations
            .Where(static i => i.Identifier is "removeModel" or "restoreModels" or "forgetModel" or "clearAll")
            .Select(static i => i.Identifier switch
            {
                "removeModel" => $"remove {i.Arguments[0]} {i.Arguments[1]}",
                "restoreModels" => $"restore {string.Join(',', ((StoredModel[])i.Arguments[0]!).Select(static m => m.Summary.Id.Value))}",
                _ => i.Identifier,
            });
        Assert.Equal(["remove m1 True", "restore m1", "clearAll"], calls);
    }

    [Fact]
    public async Task A_model_that_could_not_be_kept_is_marked_and_reported()
    {
        var cut = await LoadedAsync();

        await cut.InvokeAsync(() => cut.Instance.OnModelNotKept(new ModelId("m1"), full: true));

        Assert.Equal("storage full", Scene.Find(new ModelId("m1"))!.NotKept);
        var snackbar = Assert.Single(Snackbars.ShownSnackbars);
        Assert.Equal(
            ("Couldn't keep part.step for your next visit: the browser's storage is full. It stays open until the page is closed.", Severity.Warning),
            (snackbar.Message, snackbar.Severity));
    }

    private async Task<IRenderedComponent<Viewport>> LoadedAsync()
    {
        var cut = Render<Viewport>();
        await cut.InvokeAsync(() => cut.Instance.OnModelQueued(Summary("m1")));
        await cut.InvokeAsync(() => cut.Instance.OnModelLoaded(new ModelId("m1"), Info()));
        return cut;
    }

    /// <summary>Each setPartState call as (model, hidden nodes, selected nodes).</summary>
    private List<(string, string, string)> PartStates() =>
    [
        .. _viewer.Invocations
            .Where(static i => i.Identifier == "setPartState")
            .Select(static i => ((string)i.Arguments[0]!, string.Join(',', (int[])i.Arguments[1]!), string.Join(',', (int[])i.Arguments[2]!))),
    ];

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    private ISnackbar Snackbars => Services.GetRequiredService<ISnackbar>();
}
