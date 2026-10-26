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
        Assert.False(Scene.CanUndo);

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
        expand.SetResult(new ExpandOutcome([new PartExpansion(4, [new ExpansionPiece("", -1, true), new ExpansionPiece("", -1, true)])]));
        var tree = () => Scene.Find(id)!.Tree!;
        popovers.WaitForAssertion(() => Assert.Equal([3, 5], tree().ChildrenOf(2)));
        Assert.Equal(["Part 1", "Part 2"], tree().ChildrenOf(5).Select(tree().NameOf));
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
        Assert.Equal([5], (int[])_viewer.Invocations.Last(static i => i.Identifier == "setPartState").Arguments[2]!);
        var edits = (ModelEditsDto)_viewer.Invocations.Last(static i => i.Identifier == "setStructure").Arguments[1]!;
        Assert.Equal([1], edits.Added);
        Assert.Equal(0, Assert.Single(edits.Children).Parent);
        Assert.Equal([1, 5, 2], edits.Children[0].Nodes);
        Assert.Equal(stats, Scene.Find(Id)!.Stats);

        await cut.InvokeAsync(() => cut.Instance.OnTreeDrop($"{Id.Value}:5", Id.Value, 2, copy: false));
        Assert.Equal([3, 4, 5], Scene.Find(Id)!.Tree!.ChildrenOf(2));

        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("delete"));
        Assert.False(Scene.Find(Id)!.Tree!.Contains(5));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("undo"));
        Assert.True(Scene.Find(Id)!.Tree!.Contains(5));
    }

    private Task Act(Action action) => Renderer.Dispatcher.InvokeAsync(action);

    private static AngleSharp.Dom.IElement Node(IRenderedComponent<ModelList> cut, int node) =>
        cut.Find($"[data-tree-node=\"{Id.Value}:{node}\"]");

    private static List<string> NodeTexts(IRenderedComponent<ModelList> cut) =>
        [.. cut.FindAll("[data-testid=model-tree] .mud-treeview-item-content").Select(static node => node.TextContent.Trim())];

    /// <summary>Clicking a node's text selects it (M6), so expanding takes its arrow.</summary>
    private static void ExpandNode(IRenderedComponent<ModelList> cut, string text) =>
        cut.WaitForAssertion(() => cut.FindAll("[data-testid=model-tree] .mud-treeview-item-content")
            .Single(node => node.TextContent.Trim() == text)
            .QuerySelector(".mud-treeview-item-arrow button")!
            .Click());
}
