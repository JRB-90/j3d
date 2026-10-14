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

    public ViewportTests()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("dispose").SetVoidResult();
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

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    private ISnackbar Snackbars => Services.GetRequiredService<ISnackbar>();
}
