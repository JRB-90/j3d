using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// Editing's UI (M14, D151, D152, D180–D187): the tree following edits, its drag attributes, renaming
/// in place, cut nodes dimmed, the context menu's commands, and the Viewport's relays of keys, drops
/// and edits.
/// </summary>
public sealed class EditUiTests : BunitTestBase
{
    private static readonly ModelId Id = new("m1");
    private readonly BunitJSModuleInterop _viewer;

    public EditUiTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        Scene.Add(Summary(Id.Value, "bracket.step"));
        Scene.MarkLoaded(Id, Info());
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    [Fact]
    public async Task The_tree_follows_an_edit_and_keeps_its_open_nodes_open()
    {
        var cut = Render<ModelList>();
        cut.Find("[data-testid=model-tree-toggle]").Click();
        ExpandNode(cut, "Bracket");
        ExpandNode(cut, "Top");
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Top", "Plate (top)", "(unnamed)"], NodeTexts(cut)));

        await Act(() =>
        {
            Scene.Pick(Id, 1, additive: false);
            Scene.Copy();
            Scene.Paste();
        });

        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Plate (bottom)", "Top", "Plate (top)", "(unnamed)"], NodeTexts(cut)));
        Assert.Equal("true", Node(cut, 5).GetAttribute("data-selected"));
        Assert.Equal("64 MB in memory · 1.2M triangles · 3 parts", cut.Find("[data-testid=model-status]").TextContent.Trim());
    }

    [Fact]
    public async Task An_ungrouped_assemblys_children_show_once_in_its_place()
    {
        var cut = Render<ModelList>();
        cut.Find("[data-testid=model-tree-toggle]").Click();
        ExpandNode(cut, "Bracket");
        ExpandNode(cut, "Top");
        cut.WaitForAssertion(() => Assert.Equal(5, cut.FindAll("[data-testid=model-tree-node]").Count));

        await Act(() =>
        {
            Scene.SelectNode(Id, 2, additive: false);
            Scene.Ungroup();
        });

        // Found in the browser: the tree view's row for Top was reused, children and all, for Plate (top).
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Plate (top)", "(unnamed)"], NodeTexts(cut)));

        await Act(Scene.Undo);
        cut.WaitForAssertion(() => Assert.Contains("Top", NodeTexts(cut)));
        ExpandNode(cut, "Top");
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Top", "Plate (top)", "(unnamed)"], NodeTexts(cut)));
    }

    [Fact]
    public async Task Nodes_drag_in_object_mode_and_assemblies_and_the_model_name_take_drops()
    {
        var cut = Render<ModelList>();
        cut.Find("[data-testid=model-tree-toggle]").Click();
        ExpandNode(cut, "Bracket");

        cut.WaitForAssertion(() => Assert.Equal("true", Node(cut, 1).GetAttribute("draggable")));
        Assert.Equal("true", Node(cut, 2).GetAttribute("data-tree-assembly"));
        Assert.Equal("false", Node(cut, 1).GetAttribute("data-tree-assembly"));
        Assert.Equal(Id.Value, cut.Find("[data-model-drop]").GetAttribute("data-model-drop"));

        await Act(() => Scene.SetSelectionMode(SelectMode.Models));
        cut.WaitForAssertion(() => Assert.Equal("false", Node(cut, 1).GetAttribute("draggable")));
    }

    [Fact]
    public async Task A_new_assembly_opens_its_name_for_editing_and_enter_keeps_what_was_typed()
    {
        var cut = Render<ModelList>();
        await Act(() =>
        {
            Scene.Pick(Id, 1, additive: false);
            Scene.Group();
        });

        var field = cut.WaitForElement("[data-testid=tree-rename]");
        Assert.Equal("Assembly 1", field.GetAttribute("value"));
        await field.InputAsync(new ChangeEventArgs { Value = "Fixings" });
        await field.KeyDownAsync(new KeyboardEventArgs { Key = "Enter" });

        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=tree-rename]")));
        Assert.Equal("Fixings", Scene.Find(Id)!.Tree!.NameOf(5));
        Assert.Contains("Fixings", NodeTexts(cut));
    }

    [Fact]
    public async Task Escape_keeps_the_name_and_a_cut_node_is_dimmed()
    {
        var cut = Render<ModelList>();
        await Act(() =>
        {
            Scene.Pick(Id, 1, additive: false);
            Scene.BeginRename();
        });

        var field = cut.WaitForElement("[data-testid=tree-rename]");
        await field.InputAsync(new ChangeEventArgs { Value = "Changed" });
        await field.KeyDownAsync(new KeyboardEventArgs { Key = "Escape" });
        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=tree-rename]")));
        Assert.Equal("selecting 1 part", Scene.UndoLabel); // no rename, only the pick (D219)

        await Act(Scene.Cut);
        cut.WaitForAssertion(() => Assert.Contains("j3d-tree-node--cut", Node(cut, 1).ClassName, StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_context_menu_offers_the_edits_with_their_keys()
    {
        await StartViewerAsync();
        var popovers = Render<MudPopoverProvider>();
        Render<ContextMenu>();

        await Act(() => Scene.OpenContextMenu(Id, 3, 100, 100, canMeasure: false));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-cut]")));
        foreach (var command in new[] { "cut", "copy", "delete", "group", "rename" })
        {
            Assert.False(popovers.Find($"[data-testid=context-{command}]").ClassList.Contains("mud-disabled"), command);
        }

        Assert.True(popovers.Find("[data-testid=context-paste]").ClassList.Contains("mud-disabled"));
        Assert.Empty(popovers.FindAll("[data-testid=context-ungroup]")); // a part isn't an assembly
        Assert.Contains("Ctrl+G", popovers.Find("[data-testid=context-group]").TextContent, StringComparison.Ordinal);

        popovers.Find("[data-testid=context-copy]").Click();
        popovers.WaitForAssertion(() => Assert.NotNull(Scene.Clipboard));
    }

    [Fact]
    public async Task The_context_menu_expands_a_compound_part_with_its_pieces_from_the_viewer()
    {
        // M15, D154, D197: in a second bracket, the unnamed part (4) is compound; Plate (top) (3) isn't.
        var id = new ModelId("m2");
        await Act(() =>
        {
            Scene.Add(Summary(id.Value, "compound.step"));
            Scene.MarkLoaded(id, Info() with { Tree = Info().Tree with { Expandable = [4] } });
        });
        var expand = _viewer.Setup<ExpandOutcome>("expandParts", static _ => true);
        await StartViewerAsync();
        var popovers = Render<MudPopoverProvider>();
        Render<ContextMenu>();
        var list = Render<ModelList>();

        await Act(() => Scene.OpenContextMenu(id, 3, 100, 100, canMeasure: false));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-cut]")));
        Assert.Empty(popovers.FindAll("[data-testid=context-expand]"));
        Assert.Empty(popovers.FindAll("[data-testid=context-expand-all]"));

        await Act(() => Scene.OpenNodeContextMenu(id, 0, 100, 100)); // the whole bracket: Expand all
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-expand-all]")));

        await Act(() => Scene.Pick(id, 4, additive: false)); // a right click in the selection keeps it
        await Act(() => Scene.OpenContextMenu(id, 4, 100, 100, canMeasure: false));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-expand]")));
        Assert.Empty(popovers.FindAll("[data-testid=context-expand-all]"));
        popovers.Find("[data-testid=context-expand]").Click();

        var invocation = Assert.Single(_viewer.Invocations, static i => i.Identifier == "expandParts");
        Assert.Equal(id.Value, invocation.Arguments[0]);
        Assert.Equal([4], (IEnumerable<int>)invocation.Arguments[1]!);
        // M16 (D199): the model's item says so while the viewer expands.
        list.WaitForAssertion(() => Assert.Equal("Expanding 1 part…", list.Find("[data-testid=model-expanding]").TextContent.Trim()));
        expand.SetResult(ExpandOutcome.Of([new PartExpansion(4, [new ExpansionPiece("", -1, true), new ExpansionPiece("", -1, true)])]));
        var tree = () => Scene.Find(id)!.Tree!;
        popovers.WaitForAssertion(() => Assert.Equal([3, 5], tree().ChildrenOf(2)));
        Assert.Equal(["Part 1", "Part 2"], tree().ChildrenOf(5).Select(tree().NameOf));
        list.WaitForAssertion(() => Assert.Empty(list.FindAll("[data-testid=model-expanding]")));
        Assert.Null(Scene.Find(id)!.Expanding);
    }

    [Fact]
    public void An_outcome_sends_each_list_of_pieces_once()
    {
        // M16 (D199): the plant's 840 compound parts place two definitions, so two lists of pieces.
        ExpansionPiece[] bolts = [new("Bolt", -1, true)];
        var outcome = new ExpandOutcome([7, 8, 9], [0, 1, 0], [bolts, [new("", -1, true), new("", -1, true)]]);
        Assert.Equal([7, 8, 9], outcome.Expansions!.Select(static expansion => expansion.Node));
        Assert.Same(outcome.Expansions![0].Pieces, outcome.Expansions[2].Pieces);
        Assert.Equal(2, outcome.Expansions[1].Pieces.Count);
        Assert.Null(new ExpandOutcome(Error: "No worker").Expansions);
    }

    [Fact]
    public async Task The_viewport_relays_the_keys_and_drops_and_sends_each_edit_with_the_selection()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer.SetupVoid("setPartState", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setModelOrder", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setPlacement", static _ => true).SetVoidResult();
        _viewer.SetupVoid("dispose").SetVoidResult();
        var stats = new ModelStats(Nodes: 6, Prototypes: 2, Instances: 4, Triangles: 10, Edges: 2, Textures: 0);
        _viewer.Setup<ModelStats?>("setStructure", static _ => true).SetResult(stats);
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => Scene.Pick(Id, 1, additive: false));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("copy"));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("paste"));

        // (bUnit lists the calls by name, so their order across names can't be checked here; E2E covers it.)
        // Since M16 the viewer's share comes in a task after .NET's (D199), and the edits cross packed.
        await EventuallyAsync(() => _viewer.Invocations.Last(static i => i.Identifier == "setPartState").Arguments[2] is int[] { Length: 1 } selected && selected[0] == 5);
        var structure = _viewer.Invocations.Last(static i => i.Identifier == "setStructure");
        // Version 1; added [1]; one child list, of the bracket (0): 1, 5, 2; no names; no pieces.
        Assert.Equal([1, 1, 1, 1, 0, 3, 1, 5, 2, 0, 0], System.Runtime.InteropServices.MemoryMarshal.Cast<byte, int>((byte[])structure.Arguments[1]!).ToArray());
        Assert.Equal("", structure.Arguments[2]);
        Assert.Equal(stats, Scene.Find(Id)!.Stats);

        await cut.InvokeAsync(() => cut.Instance.OnTreeDrop($"{Id.Value}:5", Id.Value, 2, copy: false));
        Assert.Equal([3, 4, 5], Scene.Find(Id)!.Tree!.ChildrenOf(2));

        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("delete"));
        Assert.False(Scene.Find(Id)!.Tree!.Contains(5));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("undo"));
        Assert.True(Scene.Find(Id)!.Tree!.Contains(5));
    }

    private Task Act(Action action) => Renderer.Dispatcher.InvokeAsync(action);

    /// <summary>Waits for something no render shows, such as a call the Viewport makes after yielding (D199).</summary>
    private static async Task EventuallyAsync(Func<bool> condition)
    {
        for (var tries = 0; tries < 100 && !condition(); tries++)
        {
            await Task.Delay(10, Xunit.TestContext.Current.CancellationToken);
        }

        Assert.True(condition());
    }

    private static AngleSharp.Dom.IElement Node(IRenderedComponent<ModelList> cut, int node) =>
        cut.Find($"[data-tree-node=\"{Id.Value}:{node}\"]");

    private static List<string> NodeTexts(IRenderedComponent<ModelList> cut) =>
        [.. cut.FindAll("[data-testid=model-tree-node] .j3d-tree-node-name").Select(static node => node.TextContent.Trim())];

    /// <summary>Clicking a row selects it (M6), so expanding takes its arrow.</summary>
    private static void ExpandNode(IRenderedComponent<ModelList> cut, string text) =>
        cut.WaitForAssertion(() => cut.FindAll("[data-testid=model-tree-node]")
            .Single(row => row.QuerySelector(".j3d-tree-node-name")?.TextContent.Trim() == text)
            .QuerySelector("[data-testid=tree-node-toggle]")!
            .Click());
}
