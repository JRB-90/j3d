using J3D.Web.Client.Components;
using J3D.Blazor;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// M19's phone and tablet layouts in the components (D234–D243): the tree's taps and the drawer, the Add
/// toggle, ⋮, the bottom sheet and the empty view's words for a finger. The page's own layout is CSS
/// (app.css), which the E2E tests check; here <see cref="ShellState"/> is told the layout as the page would.
/// </summary>
public sealed class CompactUiTests : BunitTestBase
{
    private static readonly ModelId Id = new("m1");
    private readonly BunitJSModuleInterop _viewer;

    public CompactUiTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        _viewer.SetupVoid("revealTreeRow", static _ => true).SetVoidResult();
        Scene.Add(Summary(Id.Value, "bracket.step"));
        Scene.MarkLoaded(Id, Info());
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    private ShellState Shell => Services.GetRequiredService<ShellState>();

    [Fact]
    public async Task A_tap_on_a_tree_row_selects_and_closes_the_compact_drawer()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        OpenTree(cut);
        await Renderer.Dispatcher.InvokeAsync(() =>
        {
            Shell.OnLayoutChanged(compact: true, touch: true);
            Shell.ToggleDrawer();
        });

        Row(cut, "Plate (bottom)").Click();

        Assert.Equal([1], Scene.Find(Id)!.Selected);
        Assert.False(Shell.CompactDrawerOpen);
    }

    [Fact]
    public async Task With_Add_on_taps_in_the_tree_add_and_the_drawer_stays_open()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        OpenTree(cut);
        await Renderer.Dispatcher.InvokeAsync(() =>
        {
            Shell.OnLayoutChanged(compact: true, touch: true);
            Shell.ToggleDrawer();
            Scene.ToggleAddMode();
        });

        Row(cut, "Plate (bottom)").Click();
        Row(cut, "Top").Click();

        Assert.Equal([1, 3, 4], Scene.Find(Id)!.Selected);
        Assert.True(Shell.CompactDrawerOpen);
    }

    [Fact]
    public async Task With_Add_on_a_pick_in_the_view_adds_even_before_the_viewer_hears_of_it()
    {
        await StartViewerAsync();
        await Renderer.Dispatcher.InvokeAsync(() =>
        {
            Scene.ToggleAddMode();
            Scene.Pick(Id, 1, additive: false);
            Scene.Pick(Id, 3, additive: false);
        });

        Assert.Equal([1, 3], Scene.Find(Id)!.Selected);
    }

    [Fact]
    public async Task Rows_drag_with_a_mouse_but_not_by_touch()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        OpenTree(cut);
        Assert.Equal("true", Row(cut, "Top").GetAttribute("draggable"));

        await Renderer.Dispatcher.InvokeAsync(() => Shell.OnLayoutChanged(compact: false, touch: true));

        cut.WaitForAssertion(() => Assert.Equal("false", Row(cut, "Top").GetAttribute("draggable")));
    }

    [Fact]
    public async Task Add_is_a_toggle_that_the_viewer_hears_of()
    {
        await StartViewerAsync();
        var viewport = Render<Viewport>();
        _viewer.SetupVoid("setAddMode", static _ => true).SetVoidResult();
        var cut = Render<Toolbar>();
        var add = () => cut.Find("[data-testid=add-button]");
        cut.WaitForAssertion(() => Assert.False(add().HasAttribute("disabled")));
        Assert.Equal("false", add().GetAttribute("aria-pressed"));

        add().Click();

        Assert.True(Scene.AddMode);
        Assert.Equal("true", add().GetAttribute("aria-pressed"));
        Assert.Contains("j3d-tool--on", add().ClassName, StringComparison.Ordinal);
        Assert.False(Scene.CanUndo); // not an undo step
        viewport.WaitForAssertion(() => Assert.Equal([true], _viewer.Invocations.Where(static i => i.Identifier == "setAddMode").Select(static i => (bool)i.Arguments[0]!)));
    }

    [Fact]
    public async Task More_holds_every_group_and_the_projection_with_ticks_for_what_is_on()
    {
        var popovers = Render<MudPopoverProvider>();
        await StartViewerAsync();
        var cut = Render<Toolbar>();
        cut.WaitForAssertion(() => Assert.False(cut.Find("[data-testid=measure-button]").HasAttribute("disabled")));
        await Renderer.Dispatcher.InvokeAsync(Scene.ToggleMeasureMode);

        cut.Find("[data-testid=more-menu] button").Click();

        Assert.Equal(
            ["j3d-more-add", "j3d-more-select", "j3d-more-files", "j3d-more-tools", "j3d-more-visibility", "j3d-more-projection", "j3d-more-about"],
            popovers.FindAll(".j3d-more-section").Select(static s => s.ClassList[^1]));
        Assert.Equal("true", popovers.Find("[data-testid=more-measure]").GetAttribute("aria-checked"));
        Assert.Single(popovers.FindAll("[data-testid=more-measure] .j3d-tick"));
        Assert.Empty(popovers.FindAll("[data-testid=more-move] .j3d-tick"));
        Assert.Equal("true", popovers.Find("[data-testid=more-mode-object]").GetAttribute("aria-checked"));
        Assert.Equal("true", popovers.Find("[data-testid=more-orthographic]").GetAttribute("aria-checked"));
        Assert.Equal(Toolbar.InputId, popovers.Find("[data-testid=more-import] label").GetAttribute("for"));

        popovers.Find("[data-testid=more-mode-feature]").Click();
        Assert.Equal(SelectMode.Features, Scene.Mode);
    }

    [Fact]
    public async Task The_projection_can_be_switched_from_More()
    {
        var popovers = Render<MudPopoverProvider>();
        _viewer.SetupVoid("setProjection", static _ => true).SetVoidResult();
        await StartViewerAsync();
        var cut = Render<Toolbar>();
        cut.WaitForAssertion(() => Assert.False(cut.Find("[data-testid=measure-button]").HasAttribute("disabled")));

        cut.Find("[data-testid=more-menu] button").Click();
        popovers.Find("[data-testid=more-perspective]").Click();

        cut.WaitForAssertion(() => Assert.Equal(Projection.Perspective, Session.Projection));
    }

    [Fact]
    public async Task The_compact_sheet_has_a_handle_and_names_the_tool_that_is_on_with_Stop()
    {
        await StartViewerAsync();
        var cut = Render<SelectionPanel>();
        await Renderer.Dispatcher.InvokeAsync(Scene.ToggleMeasureMode);
        Assert.Empty(cut.FindAll("[data-testid=sheet-tool]")); // the desktop's bar shows it

        await Renderer.Dispatcher.InvokeAsync(() => Shell.OnLayoutChanged(compact: true, touch: true));

        cut.WaitForAssertion(() => Assert.Equal("Measuring", cut.Find("[data-testid=sheet-tool] span").TextContent));
        Assert.Equal("Pick a face, edge or vertex to measure from.", cut.Find("[data-testid=measure-hint]").TextContent.Trim());
        cut.Find("[data-testid=sheet-stop]").Click();
        Assert.False(Scene.MeasureMode);
    }

    [Fact]
    public async Task The_handle_opens_the_sheet_on_a_tap_or_a_drag_up_and_closes_it_on_a_drag_down()
    {
        await StartViewerAsync();
        await Renderer.Dispatcher.InvokeAsync(() =>
        {
            Shell.OnLayoutChanged(compact: true, touch: true);
            Scene.SelectNode(Id, 1, additive: false);
        });
        var cut = Render<SelectionPanel>();
        var handle = () => cut.Find("[data-testid=sheet-handle]");
        var open = () => cut.Find("[data-testid=selection-panel]").ClassList.Contains("j3d-sheet--open");

        Drag(handle(), 0);
        Assert.True(open());
        Assert.Equal("true", handle().GetAttribute("aria-expanded"));
        Drag(handle(), -60); // up: stays open
        Assert.True(open());
        Drag(handle(), 60);
        Assert.False(open());
        Drag(handle(), -60);
        Assert.True(open());

        await Renderer.Dispatcher.InvokeAsync(Scene.Escape); // nothing to show: it comes back peeking
        await Renderer.Dispatcher.InvokeAsync(() => Scene.SelectNode(Id, 1, additive: false));
        Assert.False(open());
    }

    [Fact]
    public async Task On_a_phone_Add_shows_in_the_sheet_with_Stop()
    {
        await StartViewerAsync();
        await Renderer.Dispatcher.InvokeAsync(() =>
        {
            Shell.OnLayoutChanged(compact: true, touch: true);
            Scene.ToggleAddMode();
        });
        var cut = Render<SelectionPanel>();

        cut.Find("[data-testid=sheet-add-stop]").Click();

        Assert.False(Scene.AddMode);
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]")); // nothing else to show
    }

    [Fact]
    public async Task The_empty_view_tells_a_finger_to_use_Import_and_how_to_move_the_view()
    {
        await StartViewerAsync();
        await Renderer.Dispatcher.InvokeAsync(() => Scene.Remove(Id));
        var cut = Render<ViewportHint>();
        Assert.Contains("Drop CAD or mesh files here", cut.Markup, StringComparison.Ordinal);

        await Renderer.Dispatcher.InvokeAsync(() => Shell.OnLayoutChanged(compact: true, touch: true));

        cut.WaitForAssertion(() => Assert.Equal("Use Import in ⋮ to open CAD or mesh files", cut.Find(".j3d-viewport-hint__title").TextContent));
        Assert.Equal("One finger turns the view · two pinch to zoom and drag to pan", cut.Find(".j3d-viewport-hint__keys").TextContent);
    }

    private static void OpenTree(IRenderedComponent<ModelList> cut)
    {
        cut.Find("[data-testid=model-tree-toggle]").Click();
        cut.Find("[data-testid=tree-node-toggle]").Click(); // Bracket
        cut.WaitForAssertion(() => Assert.Equal(3, cut.FindAll("[data-testid=model-tree-node]").Count));
        cut.FindAll("[data-testid=tree-node-toggle]")[1].Click(); // Top
        cut.WaitForAssertion(() => Assert.Equal(5, cut.FindAll("[data-testid=model-tree-node]").Count));
    }

    private static AngleSharp.Dom.IElement Row(IRenderedComponent<ModelList> cut, string name) =>
        cut.FindAll("[data-testid=model-tree-node]").Single(row => row.QuerySelector(".j3d-tree-node-name")?.TextContent == name);

    private static void Drag(AngleSharp.Dom.IElement handle, double dy)
    {
        handle.PointerDown(new PointerEventArgs { ClientY = 500 });
        handle.PointerUp(new PointerEventArgs { ClientY = 500 + dy });
    }
}
