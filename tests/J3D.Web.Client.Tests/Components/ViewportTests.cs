using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;

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

        await DisposeComponentsAsync();

        Assert.Single(_viewer.Invocations, static i => i.Identifier == "dispose");
        Assert.False(Session.IsReady);
    }
}
