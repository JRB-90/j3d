using J3D.Web.Client.Components;

namespace J3D.Web.Client.Tests.Components;

public sealed class ToolbarTests : BunitTestBase
{
    private readonly BunitJSModuleInterop _viewer;

    public ToolbarTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        _viewer.SetupVoid("fitAll").SetVoidResult();
    }

    [Fact]
    public void Is_disabled_until_the_viewer_is_ready()
    {
        var cut = Render<Toolbar>();

        Assert.True(cut.Find("[data-testid=import-input]").HasAttribute("disabled"));
        Assert.True(cut.Find("[data-testid=fit-all-button]").HasAttribute("disabled"));
        Assert.Empty(_viewer.Invocations);
    }

    [Fact]
    public async Task Hands_the_import_input_to_the_viewer_once_it_is_ready()
    {
        var cut = Render<Toolbar>();

        await StartViewerAsync();

        cut.WaitForAssertion(() => Assert.Single(_viewer.Invocations, static i => i.Identifier == "attachFileInput"));
        Assert.False(cut.Find("[data-testid=import-input]").HasAttribute("disabled"));
        Assert.Equal(Toolbar.InputId, cut.Find("label[data-testid=import-button]").GetAttribute("for"));
        Assert.Equal(Toolbar.InputId, cut.Find("[data-testid=import-input]").Id);
    }

    [Fact]
    public async Task Fit_all_asks_the_viewer_to_frame_every_model()
    {
        var cut = Render<Toolbar>();
        await StartViewerAsync();

        cut.WaitForElement("[data-testid=fit-all-button]:not([disabled])").Click();

        Assert.Single(_viewer.Invocations, static i => i.Identifier == "fitAll");
    }

    [Fact]
    public async Task Labels_each_tool_and_mode_and_groups_them()
    {
        var cut = Render<Toolbar>();
        await StartViewerAsync();

        Assert.Equal(["Files and view", "Select", "Tools", "Visibility", "History"], cut.FindAll(".j3d-toolbar-group").Select(static g => g.GetAttribute("aria-label")));
        Assert.Equal(["Import", "Fit all", "Model", "Object", "Feature", "Measure", "Move", "Rotate", "Origin frames"], cut.FindAll(".j3d-tool-label").Select(static l => l.TextContent));
        Assert.Empty(cut.FindAll("[data-testid=projection]")); // by the view cube now
    }

    [Fact]
    public async Task A_tool_that_is_on_is_marked_without_changing_its_shape()
    {
        var cut = Render<Toolbar>();
        await StartViewerAsync();
        cut.WaitForAssertion(() => Assert.False(cut.Find("[data-testid=measure-button]").HasAttribute("disabled")));
        Assert.DoesNotContain("j3d-tool--on", cut.Find("[data-testid=measure-button]").ClassName, StringComparison.Ordinal);

        cut.Find("[data-testid=measure-button]").Click();

        Assert.Contains("j3d-tool--on", cut.Find("[data-testid=measure-button]").ClassName, StringComparison.Ordinal);
        Assert.Contains("mud-button-text", cut.Find("[data-testid=measure-button]").ClassName, StringComparison.Ordinal); // not outlined
    }

    [Fact]
    public async Task Stays_disabled_without_webgl2()
    {
        var cut = Render<Toolbar>();

        await StartViewerAsync(webGl2: false);

        Assert.True(cut.Find("[data-testid=fit-all-button]").HasAttribute("disabled"));
        await cut.InvokeAsync(() => Session.FitAllAsync());
        Assert.DoesNotContain(_viewer.Invocations, static i => i.Identifier is "fitAll" or "attachFileInput");
    }

}
