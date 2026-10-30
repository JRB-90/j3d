using J3D.Blazor;
using J3D.Web.Client.Components;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

public sealed class ViewportTests : BunitTestBase
{
    public ViewportTests()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        var viewer = SetupViewerModule();
        viewer.SetupVoid("dispose").SetVoidResult();
        viewer.SetupVoid("setModelOrder", static _ => true).SetVoidResult();
        viewer.Setup<StoredScene>("restoreScene").SetResult(StoredScene.Empty with { Status = StoreStatus.Kept });
    }

    [Fact]
    public void Takes_keys_anywhere_on_the_page_keeps_models_and_leaves_keys_to_an_open_menu()
    {
        var cut = Render<Viewport>();

        var invocation = Assert.Single(JSInterop.Invocations, static i => i.Identifier == "createViewer");
        var options = Assert.IsType<ViewerOptions>(invocation.Arguments[2]);
        Assert.Equal((ViewerKeys.Page, "j3d", ".mud-popover-open .mud-list"), (options.Keys, options.Keep, options.PauseKeysWhile));
        Assert.NotNull(cut.Find("[data-testid=viewport].j3d-viewport"));
    }

    [Fact]
    public void Installs_the_pages_scripts_with_the_same_selector()
    {
        Render<Viewport>();

        var invocation = Assert.Single(JSInterop.Invocations, static i => i.Identifier == "installPage");
        Assert.Equal(".mud-popover-open .mud-list", invocation.Arguments[1]);
    }

    [Fact]
    public async Task Removes_the_pages_scripts_when_it_goes()
    {
        Render<Viewport>();

        await DisposeComponentsAsync();

        Assert.Single(Page!.Invocations, static i => i.Identifier == "dispose");
    }

    [Fact]
    public async Task Warns_when_webgl2_is_missing()
    {
        var cut = Render<Viewport>();
        var viewer = cut.FindComponent<J3DViewer>();

        await cut.InvokeAsync(() => viewer.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: false, CrossOriginIsolated: true)));

        Assert.Contains("WebGL2", cut.Find(".mud-alert").TextContent, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Shows_no_warning_when_supported()
    {
        var cut = Render<Viewport>();
        var viewer = cut.FindComponent<J3DViewer>();

        await cut.InvokeAsync(() => viewer.Instance.Callbacks.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        Assert.Empty(cut.FindAll(".mud-alert"));
    }

    [Theory]
    [InlineData(NoticeSeverity.Info, Severity.Info)]
    [InlineData(NoticeSeverity.Warning, Severity.Warning)]
    [InlineData(NoticeSeverity.Error, Severity.Error)]
    public async Task Shows_a_notice_as_a_snackbar(NoticeSeverity from, Severity to)
    {
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.FindComponent<J3DViewer>().Instance.Notify(new ViewerNotice(NoticeKind.ImportFailed, from, "Something happened.")));

        var snackbar = Assert.Single(Snackbars.ShownSnackbars);
        Assert.Equal(("Something happened.", to), (snackbar.Message, snackbar.Severity));
    }

    [Fact]
    public async Task Names_itself_when_open_in_another_tab()
    {
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.FindComponent<J3DViewer>().Instance.Notify(new ViewerNotice(NoticeKind.OtherTab, NoticeSeverity.Info, "This page is open in another tab.")));

        Assert.Equal(
            "J3D is open in another tab, so the models you import here won't be kept for your next visit.",
            Assert.Single(Snackbars.ShownSnackbars).Message);
    }

    [Theory]
    [InlineData(NoticeKind.ImportFailed, false)]
    [InlineData(NoticeKind.ModelNotKept, false)]
    [InlineData(NoticeKind.OtherTab, false)]
    [InlineData(NoticeKind.KeptModelsUnreadable, false)]
    [InlineData(NoticeKind.ExpandFailed, false)]
    [InlineData(NoticeKind.TransferFailed, false)]
    [InlineData(NoticeKind.ArrivalNotKept, false)]
    [InlineData(NoticeKind.FileSkipped, true)]
    [InlineData(NoticeKind.MeasureFailed, true)]
    [InlineData(NoticeKind.KeepingUnavailable, true)]
    [InlineData(NoticeKind.TransferRefused, true)]
    public void Keeps_up_what_matters_for_longer(NoticeKind kind, bool brief) => Assert.Equal(brief, Viewport.IsBrief(kind));

    [Fact]
    public async Task A_node_dropped_in_a_tree_goes_to_the_scene()
    {
        var cut = Render<Viewport>();
        var scene = Services.GetRequiredService<SceneState>();
        var id = new ModelId("m1");
        await cut.InvokeAsync(() => scene.Add(Summary("m1")));
        await cut.InvokeAsync(() => scene.MarkLoaded(id, Info()));

        await cut.InvokeAsync(() => cut.Instance.OnTreeDrop("m1:4", "m1", 0, copy: false));

        Assert.Equal(0, scene.Find(id)!.Tree!.ParentOf(4));
    }

    private ISnackbar Snackbars => Services.GetRequiredService<ISnackbar>();
}
