using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.Extensions.DependencyInjection;

namespace J3D.Web.Client.Tests.Components;

public sealed class ViewportHintTests : BunitTestBase
{
    private SceneState Scene => Services.GetRequiredService<SceneState>();

    [Fact]
    public async Task Says_what_to_do_in_an_empty_view_until_a_model_arrives()
    {
        SetupViewerModule();
        var cut = Render<ViewportHint>();
        Assert.Empty(cut.FindAll("[data-testid=viewport-hint]")); // not before the viewer runs

        await StartViewerAsync();
        cut.WaitForAssertion(() => Assert.Contains("Drop CAD or mesh files here, or use Import", cut.Find("[data-testid=viewport-hint]").TextContent, StringComparison.Ordinal));
        Assert.Contains("Right-drag turns the view", cut.Find("[data-testid=viewport-hint]").TextContent, StringComparison.Ordinal);

        await cut.InvokeAsync(() => Scene.Add(new ModelSummary(new ModelId("m1"), "box.step", ModelFormat.Step, 100)));
        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=viewport-hint]")));
    }
}
