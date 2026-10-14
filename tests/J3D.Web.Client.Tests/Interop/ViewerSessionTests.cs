using J3D.Web.Client.Interop;

namespace J3D.Web.Client.Tests.Interop;

public sealed class ViewerSessionTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _viewer;

    public ViewerSessionTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("setProjection", static _ => true).SetVoidResult();
    }

    [Fact]
    public async Task Is_ready_only_while_a_viewer_with_webgl2_is_attached()
    {
        var changes = 0;
        Session.Changed += () => changes++;
        Assert.False(Session.IsReady);

        var viewer = await StartViewerAsync();
        Assert.True(Session.IsReady);
        Assert.Equal(new ViewerCapabilities(true, true), Session.Capabilities);

        Session.Detach(viewer);
        Assert.False(Session.IsReady);
        Assert.Null(Session.Capabilities);
        Assert.Equal(2, changes);
    }

    [Fact]
    public async Task Ignores_detaching_a_viewer_that_was_replaced()
    {
        var first = await StartViewerAsync();
        await StartViewerAsync();

        Session.Detach(first);

        Assert.True(Session.IsReady);
    }

    [Fact]
    public async Task Changes_projection_only_when_it_differs_and_resets_for_a_new_viewer()
    {
        await StartViewerAsync();

        await Session.SetProjectionAsync(Projection.Orthographic);
        Assert.DoesNotContain(_viewer.Invocations, static i => i.Identifier == "setProjection");

        await Session.SetProjectionAsync(Projection.Perspective);
        Assert.Equal(Projection.Perspective, Session.Projection);

        await StartViewerAsync();
        Assert.Equal(Projection.Orthographic, Session.Projection);
    }
}
