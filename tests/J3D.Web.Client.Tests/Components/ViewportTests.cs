using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;

namespace J3D.Web.Client.Tests.Components;

public sealed class ViewportTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _module;

    public ViewportTests()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _module = JSInterop.SetupModule(Viewport.ModulePath);
        _module.SetupModule(invocation => invocation.Identifier == "createViewer");
    }

    [Fact]
    public void Creates_the_viewer_on_first_render()
    {
        var cut = Render<Viewport>();

        var invocation = Assert.Single(_module.Invocations, static i => i.Identifier == "createViewer");
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
    }

    [Fact]
    public async Task Shows_no_warning_when_supported()
    {
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnViewerReady(new ViewerCapabilities(WebGl2: true, CrossOriginIsolated: true)));

        Assert.Empty(cut.FindAll(".mud-alert"));
    }
}
