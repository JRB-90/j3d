using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

public sealed class J3DViewerTests : BunitTestBase
{
    private readonly List<ViewerNotice> _notices = [];
    private readonly BunitJSModuleInterop _viewer;
    private readonly JSRuntimeInvocationHandler<StoredScene> _restoreScene;

    public J3DViewerTests()
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
        var cut = RenderViewer();

        var invocation = Assert.Single(JSInterop.Invocations, static i => i.Identifier == "createViewer");
        Assert.Equal(3, invocation.Arguments.Count);
        Assert.NotNull(cut.Find("[data-testid=viewer]"));
    }

    [Fact]
    public void Keys_and_keeping_are_off_and_the_controls_on_unless_asked()
    {
        RenderViewer();

        var invocation = Assert.Single(JSInterop.Invocations, static i => i.Identifier == "createViewer");
        Assert.Equal(new ViewerOptions(ViewerKeys.Off, null, null, ViewCube: true, HomeButton: true, ViewButtons: true, DropFiles: true), invocation.Arguments[2]);
    }

    [Fact]
    public void Its_parameters_reach_the_viewer()
    {
        Render<J3DViewer>(parameters => parameters
            .Add(viewer => viewer.Keys, ViewerKeys.InViewer)
            .Add(viewer => viewer.PauseKeysWhile, ".menu")
            .Add(viewer => viewer.Keep, "mine")
            .Add(viewer => viewer.ViewCube, false)
            .Add(viewer => viewer.HomeButton, false)
            .Add(viewer => viewer.ViewButtons, false)
            .Add(viewer => viewer.DropFiles, false));

        var invocation = Assert.Single(JSInterop.Invocations, static i => i.Identifier == "createViewer");
        Assert.Equal(new ViewerOptions(ViewerKeys.InViewer, ".menu", "mine", ViewCube: false, HomeButton: false, ViewButtons: false, DropFiles: false), invocation.Arguments[2]);
    }

    [Fact]
    public void Draws_its_child_content_over_the_view_and_keeps_the_pages_attributes()
    {
        var cut = Render<J3DViewer>(parameters => parameters
            .AddUnmatched("class", "mine")
            .Add(viewer => viewer.ChildContent, (RenderFragment)(builder => builder.AddMarkupContent(0, "<p>panel</p>"))));

        Assert.Equal("panel", cut.Find("div.mine > p").TextContent);
    }

    [Fact]
    public void A_second_viewer_in_a_scope_fails_with_a_clear_error()
    {
        RenderViewer();

        var error = Assert.Throws<InvalidOperationException>(() => RenderViewer());

        Assert.Contains("Only one <J3DViewer>", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_new_viewer_can_start_once_the_last_is_gone()
    {
        RenderViewer();
        await DisposeComponentsAsync();

        RenderViewer();

        Assert.Equal(2, JSInterop.Invocations.Count(static i => i.Identifier == "createViewer"));
    }

    [Fact]
    public async Task Reports_capabilities_and_keeps_out_of_the_session_without_webgl2()
    {
        ViewerCapabilities? reported = null;
        var cut = Render<J3DViewer>(parameters => parameters
            .Add(viewer => viewer.OnReady, capabilities => reported = capabilities));

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: false, CrossOriginIsolated: true)));

        Assert.Equal(new ViewerCapabilities(false, true), reported);
        Assert.False(Session.IsReady);
    }

    [Fact]
    public async Task Shares_the_viewer_when_supported()
    {
        var cut = RenderViewer();

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        Assert.True(Session.IsReady);
    }

    [Fact]
    public async Task The_page_hears_ready_once_the_session_can_use_the_viewer()
    {
        // The bridge reports from inside createViewer, so in a browser the report comes before the handle.
        var browser = new SlowBrowser();
        Services.AddSingleton<IJSRuntime>(browser);
        bool? readyInHandler = null;
        var cut = Render<J3DViewer>(parameters => parameters
            .Add(viewer => viewer.OnReady, _ => readyInHandler = Session.IsReady));

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));
        Assert.Null(readyInHandler);

        await cut.InvokeAsync(browser.FinishCreating);

        Assert.True(readyInHandler);
    }

    [Fact]
    public async Task Disposes_the_viewer_and_leaves_the_session()
    {
        var cut = RenderViewer();
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelQueued(Summary("m1")));

        await DisposeComponentsAsync();

        Assert.Single(_viewer.Invocations, static i => i.Identifier == "dispose");
        Assert.False(Session.IsReady);
        Assert.Empty(Scene.Models); // the models went with the viewer
    }

    [Fact]
    public async Task Relays_the_viewers_model_events_into_the_scene()
    {
        var cut = RenderViewer();
        var id = new ModelId("m1");

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelQueued(Summary("m1", "gearbox.step")));
        Assert.Equal(ModelStatus.Queued, Assert.Single(Scene.Models).Status);

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelProgress(id, ImportPhase.Meshing, 0.5));
        Assert.Equal((ModelStatus.Importing, ImportPhase.Meshing), (Scene.Models[0].Status, Scene.Models[0].Phase));

        // Since M16 the tree and a restored model's edits cross packed beside the rest (D204).
        var info = Info() with { Tree = Info().Tree with { Expandable = [4] } };
        var (tree, names) = TreeCodec.Encode(info.Tree);
        var kept = ModelEdits.None with { Names = ModelEdits.None.Names.Add(3, "Lid") };
        var (edits, editNames) = EditsCodec.Encode(kept);
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelLoaded(id, info with { Tree = null! }, tree, names, edits, editNames));
        var loaded = Scene.Models[0].Info!;
        Assert.Equal(info.Tree.Names, loaded.Tree.Names);
        Assert.Equal(info.Tree.Parents, loaded.Tree.Parents);
        Assert.Equal(info.Tree.Prototypes, loaded.Tree.Prototypes);
        Assert.Equal([4], loaded.Tree.Expandable!);
        Assert.Equal("Lid", Scene.Models[0].Tree!.NameOf(3));
        Assert.Equal(info.Stats, loaded.Stats);

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelRemoved(id));
        Assert.Empty(Scene.Models);
        Assert.Empty(_notices);
    }

    [Fact]
    public async Task A_failed_import_stays_in_the_list_and_is_reported_in_a_notice()
    {
        var cut = RenderViewer();
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelQueued(Summary("m1", "gearbox.step")));

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelFailed(new ModelId("m1"), ParseFailed));

        Assert.Equal(ModelStatus.Failed, Assert.Single(Scene.Models).Status);
        Assert.Equal(new ViewerNotice(NoticeKind.ImportFailed, NoticeSeverity.Error, "Couldn't import gearbox.step: Not a readable STEP file."), Assert.Single(_notices));
    }

    [Fact]
    public async Task A_rejected_file_is_reported_in_a_notice_only()
    {
        var cut = RenderViewer();

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnImportRejected("notes.txt", ".txt files aren't supported."));

        Assert.Empty(Scene.Models);
        Assert.Equal(new ViewerNotice(NoticeKind.FileSkipped, NoticeSeverity.Warning, "Skipped notes.txt: .txt files aren't supported."), Assert.Single(_notices));
    }

    [Fact]
    public async Task Relays_picks_and_key_commands_into_the_scene()
    {
        var cut = await LoadedAsync();

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked("m1", 3, additive: false));
        Assert.Equal([3], Scene.Models[0].Selected);
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked("m1", 1, additive: true));
        Assert.Equal([1, 3], Scene.Models[0].Selected.Order());

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("hide"));
        Assert.Equal([1, 3], Scene.Models[0].Hidden.Order());
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("undo"));
        Assert.Empty(Scene.Models[0].Hidden);
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("redo"));
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("showAll"));
        Assert.Empty(Scene.Models[0].Hidden);

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked("m1", 4, additive: false));
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("isolate"));
        Assert.Equal([1, 3], Scene.Models[0].Hidden.Order());
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("clearSelection"));
        Assert.False(Scene.HasSelection);

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked("m1", 4, additive: false));
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked(null, -1, additive: false));
        Assert.False(Scene.HasSelection);
    }

    [Fact]
    public async Task Sends_a_models_hidden_and_selected_parts_to_the_viewer_only_when_they_change()
    {
        var cut = await LoadedAsync();
        Assert.Empty(PartStates()); // nothing hidden or selected yet

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked("m1", 3, additive: false));
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelProgress(new ModelId("m1"), ImportPhase.Meshing, 0.5)); // no change to parts
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("hide"));

        Assert.Equal(
            [("m1", "", "3"), ("m1", "3", "")],
            PartStates());
    }

    [Fact]
    public async Task Isolate_fits_the_view_once_the_viewer_has_hidden_the_rest()
    {
        var cut = await LoadedAsync();
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnPartPicked("m1", 3, additive: false));

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerCommand("isolate"));

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
        var cut = RenderViewer();

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Equal(["k1", "k2"], Scene.Models.Select(static model => model.Id.Value)));
        Assert.Equal(Projection.Perspective, Session.Projection);
        var restored = Assert.Single(_viewer.Invocations, static i => i.Identifier == "restoreModels");
        var models = (StoredModel[])restored.Arguments[0]!;
        Assert.Equal([("k1", "3"), ("k2", "")], models.Select(static m => (m.Summary.Id.Value, string.Join(',', m.Hidden))));
        cut.WaitForAssertion(() => Assert.Equal("k1,k2", string.Join(',', (string[])_viewer.Invocations.Last(static i => i.Identifier == "setModelOrder").Arguments[0]!)));
        Assert.Empty(_notices);
    }

    [Theory]
    [InlineData(StoreStatus.OtherTab, NoticeKind.OtherTab, "This page is open in another tab, so the models you import here won't be kept for your next visit.")]
    [InlineData(StoreStatus.Unavailable, NoticeKind.KeepingUnavailable, "This browser can't keep models for your next visit.")]
    internal async Task Says_when_this_tab_wont_keep_its_models(StoreStatus status, NoticeKind kind, string message)
    {
        _restoreScene.SetResult(StoredScene.Empty with { Status = status });
        var cut = RenderViewer(keep: "j3d");

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Equal(new ViewerNotice(kind, NoticeSeverity.Info, message), Assert.Single(_notices)));
        Assert.Equal(Projection.Orthographic, Session.Projection);
    }

    [Fact]
    public async Task A_viewer_not_asked_to_keep_models_says_nothing_about_keeping_them()
    {
        _restoreScene.SetResult(StoredScene.Empty with { Status = StoreStatus.Unavailable });
        var cut = RenderViewer();

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Single(_viewer.Invocations, static i => i.Identifier == "restoreScene"));
        Assert.Empty(_notices);
    }

    [Theory]
    [InlineData(1, "A kept model couldn't be read this time. It's still kept, and will be tried again next time.")]
    [InlineData(2, "2 kept models couldn't be read this time. They're still kept, and will be tried again next time.")]
    public async Task Says_when_kept_models_couldnt_be_read(int unreadable, string message)
    {
        // M16 (D200): the store keeps them for the next visit rather than deleting them.
        _restoreScene.SetResult(StoredScene.Empty with { Unreadable = unreadable });
        var cut = RenderViewer(keep: "j3d");

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        cut.WaitForAssertion(() => Assert.Equal(new ViewerNotice(NoticeKind.KeptModelsUnreadable, NoticeSeverity.Warning, message), Assert.Single(_notices)));
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

        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelNotKept(new ModelId("m1"), full: true));

        Assert.Equal("storage full", Scene.Find(new ModelId("m1"))!.NotKept);
        Assert.Equal(
            new ViewerNotice(NoticeKind.ModelNotKept, NoticeSeverity.Warning, "Couldn't keep part.step for your next visit: the browser's storage is full. It stays open until the page is closed."),
            Assert.Single(_notices));
    }

    private IRenderedComponent<J3DViewer> RenderViewer(string? keep = null) => Render<J3DViewer>(parameters => parameters
        .AddUnmatched("data-testid", "viewer")
        .Add(viewer => viewer.Keep, keep)
        .Add(viewer => viewer.OnNotice, _notices.Add));

    private async Task<IRenderedComponent<J3DViewer>> LoadedAsync()
    {
        var cut = RenderViewer();
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelQueued(Summary("m1")));
        var (tree, names) = TreeCodec.Encode(Info().Tree);
        await cut.InvokeAsync(() => cut.Instance.Callbacks.OnModelLoaded(new ModelId("m1"), Info(), tree, names, null, null));
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

    /// <summary>A browser whose <c>createViewer</c> answers only when told, so a test can put the viewer's report first.</summary>
    private sealed class SlowBrowser : IJSRuntime, IJSObjectReference
    {
        private readonly TaskCompletionSource _created = new();

        public void FinishCreating() => _created.SetResult();

        public async ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args)
        {
            if (identifier == "createViewer")
            {
                await _created.Task;
            }

            object? answer = typeof(TValue) == typeof(StoredScene) ? StoredScene.Empty : this;
            return answer is TValue value ? value : default!;
        }

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args) =>
            InvokeAsync<TValue>(identifier, args);

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
