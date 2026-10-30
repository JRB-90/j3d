using J3D.Web.Client.Components;
using J3D.Blazor;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// The Move tool's UI (M13, D148–D150, D166–D171): the toolbar's Move and Origin frames buttons, the
/// panel's fields, the context menu's Move and the Viewport's relays.
/// </summary>
public sealed class MoveUiTests : BunitTestBase
{
    private static readonly ModelId Id = new("m1");
    private readonly BunitJSModuleInterop _viewer;

    public MoveUiTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        Scene.Add(Summary(Id.Value, "bracket.step"));
        Scene.MarkLoaded(Id, Info());
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    [Fact]
    public async Task The_toolbar_turns_the_move_tool_and_the_origin_frames_on_and_off()
    {
        await StartViewerAsync();
        var cut = Render<Toolbar>();
        var move = () => cut.Find("[data-testid=move-button]");
        var frames = () => cut.Find("[data-testid=origin-frames-button]");
        cut.WaitForAssertion(() => Assert.False(move().HasAttribute("disabled")));

        var rotate = () => cut.Find("[data-testid=rotate-button]");
        move().Click();
        Assert.Equal(MoveMode.Translate, Scene.Moving);
        Assert.Equal("true", move().GetAttribute("aria-pressed"));
        Assert.Equal("false", rotate().GetAttribute("aria-pressed"));

        // Rotate (M17, D222): switches to the rings, and Move back to the arrows; the one that's on turns it off.
        rotate().Click();
        Assert.Equal(MoveMode.Rotate, Scene.Moving);
        Assert.Equal("true", rotate().GetAttribute("aria-pressed"));
        Assert.Equal("false", move().GetAttribute("aria-pressed"));
        rotate().Click();
        Assert.Null(Scene.Moving);
        rotate().Click();
        move().Click();
        Assert.Equal(MoveMode.Translate, Scene.Moving);
        move().Click();
        Assert.Null(Scene.Moving);

        frames().Click();
        Assert.True(Scene.OriginFrames);
        Assert.Equal("true", frames().GetAttribute("aria-pressed"));
    }

    [Fact]
    public async Task The_panel_shows_the_target_and_applies_typed_values_on_enter()
    {
        await StartViewerAsync();
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.SelectNode(Id, 2, additive: false);
            Scene.SetMoveMode(MoveMode.Translate);
        });
        Assert.Equal("Finding where it is…", cut.Find("[data-testid=move-hint]").TextContent);

        await Act(() => Scene.ReportMoveTarget(new MoveTargetInfo(Id, 2, Translated(5, 0, 0), Translated(100, 0, 0), 1)));
        Assert.Equal("Top", cut.Find("[data-testid=move-title]").TextContent);
        Assert.Equal("0.000", cut.Find("[data-testid=move-x]").GetAttribute("value")); // Local: always zero
        Assert.Equal("Move by", cut.Find("[data-testid=move-heading]").TextContent);

        cut.Find("[data-testid=move-frame-world]").Click();
        Assert.Equal(MoveFrame.World, Scene.Frame);
        Assert.Equal("105.000", cut.Find("[data-testid=move-x]").GetAttribute("value"));
        Assert.Equal("Position in the world", cut.Find("[data-testid=move-heading]").TextContent);

        cut.Find("[data-testid=move-y]").Input("2,5"); // a comma works as the decimal point
        cut.Find("[data-testid=move-z]").Input("abc");
        cut.Find("[data-testid=move-z]").KeyDown(new KeyboardEventArgs { Key = "Enter" });
        Assert.StartsWith("selecting", Scene.UndoLabel); // not a number: nothing moves, and the text stays
        Assert.Equal("abc", cut.Find("[data-testid=move-z]").GetAttribute("value"));

        cut.Find("[data-testid=move-z]").Input("-1");
        cut.Find("[data-testid=move-z]").KeyDown(new KeyboardEventArgs { Key = "Enter" });
        var placed = Scene.Find(Id)!.Placements[2];
        Assert.Equal((5, 2.5, -1), (placed[0, 3], placed[1, 3], placed[2, 3]));
        Assert.True(Scene.CanUndo);
    }

    [Fact]
    public async Task Apply_applies_the_fields_as_enter_does()
    {
        await StartViewerAsync();
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.SelectNode(Id, 2, additive: false);
            Scene.SetMoveMode(MoveMode.Translate);
        });
        await Act(() => Scene.ReportMoveTarget(new MoveTargetInfo(Id, 2, Translated(5, 0, 0), Translated(100, 0, 0), 1)));
        cut.Find("[data-testid=move-frame-parent]").Click();
        Assert.Equal("Position in its parent", cut.Find("[data-testid=move-heading]").TextContent);

        cut.Find("[data-testid=move-z]").Input("7");
        cut.Find("[data-testid=move-apply]").Click();

        var placed = Scene.Find(Id)!.Placements[2];
        Assert.Equal((5, 0, 7), (placed[0, 3], placed[1, 3], placed[2, 3]));
        Assert.True(Scene.CanUndo);
    }

    [Fact]
    public async Task The_panel_says_why_there_is_nothing_to_move()
    {
        await StartViewerAsync();
        var cut = Render<SelectionPanel>();

        await Act(() => Scene.SetMoveMode(MoveMode.Translate));

        Assert.Contains("Select a part", cut.Find("[data-testid=move-hint]").TextContent, StringComparison.Ordinal);
        Assert.Empty(cut.FindAll("[data-testid=move-x]"));
    }

    [Fact]
    public async Task The_context_menu_starts_moving_its_target()
    {
        await StartViewerAsync();
        var popovers = Render<MudPopoverProvider>();
        Render<ContextMenu>();

        await Act(() => Scene.OpenContextMenu(Id, 3, 100, 100, canMeasure: true));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-move]")));
        popovers.Find("[data-testid=context-move]").Click();

        popovers.WaitForAssertion(() => Assert.Equal(MoveMode.Translate, Scene.Moving));
        Assert.Equal((Id, 3), Scene.MoveTarget);

        // Rotate (M17, D222): the rings, from the menu too.
        await Act(() => Scene.OpenContextMenu(Id, 3, 100, 100, canMeasure: true));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-rotate]")));
        Assert.Contains("E", popovers.Find("[data-testid=context-rotate]").TextContent);
        popovers.Find("[data-testid=context-rotate]").Click();
        popovers.WaitForAssertion(() => Assert.Equal(MoveMode.Rotate, Scene.Moving));
    }

    [Fact]
    public async Task The_panel_switches_between_the_arrows_and_the_rings_and_keeps_all_six_fields()
    {
        await StartViewerAsync();
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.SelectNode(Id, 2, additive: false);
            Scene.SetMoveMode(MoveMode.Translate);
            Scene.ReportMoveTarget(new MoveTargetInfo(Id, 2, Translated(5, 0, 0), Translated(100, 0, 0), 1));
        });

        var panel = cut.Find("[data-testid=move-panel]");
        Assert.Equal("move-mode", panel.FirstElementChild!.GetAttribute("data-testid")); // at the top (D223)
        cut.Find("[data-testid=move-mode-rotate]").Click();
        Assert.Equal(MoveMode.Rotate, Scene.Moving);
        Assert.Equal(6, cut.FindAll(".j3d-move-field input").Count);
        cut.Find("[data-testid=move-mode-rotate]").Click(); // the one that's on stays on
        Assert.Equal(MoveMode.Rotate, Scene.Moving);
        cut.Find("[data-testid=move-mode-translate]").Click();
        Assert.Equal(MoveMode.Translate, Scene.Moving);
    }

    [Fact]
    public async Task The_viewport_relays_the_tool_its_moves_and_the_frames()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer.SetupVoid("setPartState", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setModelOrder", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setMoveTool", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setPlacement", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setOriginFrames", static _ => true).SetVoidResult();
        _viewer.SetupVoid("dispose").SetVoidResult();
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => Scene.Pick(Id, 3, additive: false));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("moveTranslate"));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("moveRotate"));
        var tools = _viewer.Invocations.Where(static i => i.Identifier == "setMoveTool").ToList();
        Assert.Equal([MoveMode.Translate, MoveMode.Rotate], tools.Select(static i => (MoveMode?)i.Arguments[0]));
        Assert.Equal(new MoveTargetRef(Id, 3), tools[^1].Arguments[1]);

        // A drag the viewer already shows is recorded, not sent back; its undo is.
        double[] before = [.. Matrix4d.Identity.ToArray()];
        double[] after = Translated(0, 0, 9);
        await cut.InvokeAsync(() => CallbacksOf(cut).OnMoved(Id.Value, 3, before, after));
        Assert.True(Scene.CanUndo);
        Assert.DoesNotContain(_viewer.Invocations, static i => i.Identifier == "setPlacement");
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("undo"));
        var placement = Assert.Single(_viewer.Invocations, static i => i.Identifier == "setPlacement");
        Assert.Equal([Id.Value, 3, before], placement.Arguments);

        await cut.InvokeAsync(() => CallbacksOf(cut).OnMoveTarget(new MoveTargetInfo(Id, 3, before, before, 1)));
        Assert.Equal(Pose.Zero, Scene.TargetPose);

        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("originFrames"));
        var frames = Assert.Single(_viewer.Invocations, static i => i.Identifier == "setOriginFrames");
        Assert.Equal([new MoveTargetRef(Id, 3)], (MoveTargetRef[])frames.Arguments[0]!);

        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("clearSelection")); // Esc ends the tool
        Assert.Null(Scene.Moving);
        Assert.Null(_viewer.Invocations.Last(static i => i.Identifier == "setMoveTool").Arguments[0]);
    }

    private Task Act(Action action) => Renderer.Dispatcher.InvokeAsync(action);

    private static double[] Translated(double x, double y, double z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}
