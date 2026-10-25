using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;

namespace J3D.Web.Client.Tests.Components;

public sealed class ViewControlsTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _viewer;

    public ViewControlsTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("setProjection", static _ => true).SetVoidResult();
    }

    [Fact]
    public async Task Switches_the_projection_and_shows_the_choice()
    {
        var cut = Render<ViewControls>();
        Assert.NotEmpty(cut.FindAll("[data-testid=projection-perspective][disabled]"));
        await StartViewerAsync();
        Assert.Equal(Projection.Orthographic, Session.Projection);
        cut.WaitForAssertion(() => Assert.Equal("true", cut.Find("[data-testid=projection-orthographic]").GetAttribute("aria-pressed")));

        cut.Find("[data-testid=projection-perspective]").Click();

        var invocation = Assert.Single(_viewer.Invocations, static i => i.Identifier == "setProjection");
        Assert.Equal(Projection.Perspective, Assert.Single(invocation.Arguments));
        Assert.Equal(Projection.Perspective, Session.Projection);
        cut.WaitForAssertion(() => Assert.Equal("true", cut.Find("[data-testid=projection-perspective]").GetAttribute("aria-pressed")));
        Assert.Equal("false", cut.Find("[data-testid=projection-orthographic]").GetAttribute("aria-pressed"));
    }
}
