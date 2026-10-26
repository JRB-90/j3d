using J3D.Web.Client.Components;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// The M6 UI over <see cref="SceneState"/>: eyes and selection in the list and tree (D96), the
/// floating panel (D87) and the toolbar's visibility and history buttons (D97). The model is the
/// bracket of <see cref="TestModels.Info"/>, whose parts are nodes 1, 3 and 4.
/// </summary>
public sealed class SelectionUiTests : BunitTestBase
{
    private static readonly ModelId Id = new("m1");

    public SelectionUiTests()
    {
        var viewer = SetupViewerModule();
        viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        viewer.SetupVoid("revealTreeRow", static _ => true).SetVoidResult();
        Scene.Add(Summary(Id.Value, "bracket.step"));
        Scene.MarkLoaded(Id, Info());
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    private ModelEntry Model => Scene.Find(Id)!;

    [Fact]
    public async Task The_models_eye_hides_and_shows_every_part()
    {
        var cut = Render<ModelList>();
        Assert.Equal("visible", cut.Find("[data-testid=model-eye]").GetAttribute("data-visibility"));

        cut.Find("[data-testid=model-eye]").Click();
        Assert.Equal(PartVisibility.Hidden, Model.Visibility());
        Assert.Equal("hidden", cut.Find("[data-testid=model-eye]").GetAttribute("data-visibility"));

        await Act(() => Scene.Undo());
        Assert.Equal("visible", cut.Find("[data-testid=model-eye]").GetAttribute("data-visibility"));
    }

    [Fact]
    public async Task Tree_eyes_are_tri_state_and_hidden_nodes_are_dimmed()
    {
        var cut = Render<ModelList>();
        await RevealAsync(4); // opens the tree down to the unnamed part

        Eye(cut, "Top").Click();

        Assert.Equal([3, 4], Model.Hidden.Order());
        Assert.Equal("mixed", Eye(cut, "Bracket").GetAttribute("data-visibility"));
        Assert.Equal("hidden", Eye(cut, "Top").GetAttribute("data-visibility"));
        Assert.Equal("visible", Eye(cut, "Plate (bottom)").GetAttribute("data-visibility"));
        Assert.Contains("j3d-tree-node--hidden", Node(cut, "Plate (top)").ClassName, StringComparison.Ordinal);
        Assert.Contains("j3d-eye--mixed", Eye(cut, "Bracket").ClassName, StringComparison.Ordinal);
        Assert.Equal("mixed", cut.Find("[data-testid=model-eye]").GetAttribute("data-visibility"));
        Assert.False(Model.HasSelection(), "an eye click doesn't select the node");
    }

    [Fact]
    public async Task Clicking_tree_nodes_selects_their_parts_and_ctrl_adds()
    {
        var cut = Render<ModelList>();
        await RevealAsync(4);

        Content(cut, "Top").Click();
        Assert.Equal([3, 4], Model.Selected.Order());
        Assert.Equal("true", Node(cut, "Top").GetAttribute("data-selected"));
        Assert.Contains("j3d-tree-node--selected", Node(cut, "Plate (top)").ClassName, StringComparison.Ordinal);

        Content(cut, "Plate (bottom)").Click(new MouseEventArgs { CtrlKey = true });
        Assert.Equal("true", Node(cut, "Bracket").GetAttribute("data-selected"));

        Content(cut, "Plate (bottom)").Click();
        Assert.Equal([1], Model.Selected);
    }

    [Fact]
    public async Task A_part_picked_in_3D_opens_the_tree_down_to_it_and_scrolls_to_it()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        Assert.Empty(cut.FindAll("[data-testid=model-tree]"));

        await Act(() => Scene.Pick(Id, 4, additive: false));

        cut.WaitForAssertion(() => Assert.Equal("true", Node(cut, "(unnamed)").GetAttribute("data-selected")));
        // Bracket, Plate (bottom), Top, Plate (top), then the unnamed part: the fifth row.
        var reveal = JSInterop.Invocations.Single(static i => i.Identifier == "revealTreeRow");
        Assert.Equal(["[data-testid=model-tree][data-tree=\"m1\"]", 4, 26, "[data-tree-node=\"m1:4\"]", false], reveal.Arguments);
    }

    [Fact]
    public async Task A_part_deep_in_a_wide_level_is_scrolled_to_by_its_row()
    {
        // M16 (D198): the tree is virtualised, so the row is found by its index, not paged to (D60).
        await StartViewerAsync();
        List<J3D.Web.Client.Interop.TreeNode> tree = [new("Group", Parent: -1, Prototype: -1)];
        tree.AddRange(Enumerable.Range(1, 350).Select(static i => new J3D.Web.Client.Interop.TreeNode($"Inner {i}", Parent: 0, Prototype: 0)));
        var id = new ModelId("wide");
        await Act(() =>
        {
            Scene.Add(Summary(id.Value, "wide.step"));
            Scene.MarkLoaded(id, Info() with { Tree = J3D.Web.Client.Interop.TreeColumns.From(tree) });
        });
        var cut = Render<ModelList>();

        await Act(() => Scene.Pick(id, 230, additive: false));

        cut.WaitForAssertion(() => Assert.Contains(JSInterop.Invocations, static i => i.Identifier == "revealTreeRow"));
        var reveal = JSInterop.Invocations.Last(static i => i.Identifier == "revealTreeRow");
        Assert.Equal(230, reveal.Arguments[1]); // Group is row 0
        Assert.Equal("[data-tree-node=\"wide:230\"]", reveal.Arguments[3]);
        Assert.Equal("true", Node(cut, "Group").GetAttribute("aria-expanded"));
        Assert.Empty(cut.FindAll("[data-testid=model-tree-more]"));
    }

    [Fact]
    public async Task The_panel_names_one_part_with_its_path_or_counts_several()
    {
        var cut = Render<SelectionPanel>();
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]"));

        await Act(() => Scene.Pick(Id, 3, additive: false));
        Assert.Equal("Plate (top)", cut.Find("[data-testid=selection-title]").TextContent);
        Assert.Equal("bracket.step › Bracket › Top", cut.Find("[data-testid=selection-detail]").TextContent);

        await Act(() => Scene.SelectNode(Id, 0, additive: false));
        Assert.Equal("3 parts selected", cut.Find("[data-testid=selection-title]").TextContent);
        Assert.Equal("in bracket.step", cut.Find("[data-testid=selection-detail]").TextContent);

        await Act(() => Scene.ClearSelection());
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]"));
    }

    [Fact]
    public async Task The_toolbar_buttons_act_on_the_selection_and_the_history_when_they_can()
    {
        await StartViewerAsync();
        var cut = Render<Toolbar>();
        string[] buttons = ["hide-button", "isolate-button", "show-all-button", "undo-button", "redo-button"];
        cut.WaitForAssertion(() => Assert.All(buttons, button => Assert.True(Disabled(cut, button))));

        await Act(() => Scene.Pick(Id, 1, additive: false));
        Assert.False(Disabled(cut, "hide-button"));
        Assert.False(Disabled(cut, "isolate-button"));

        cut.Find("[data-testid=isolate-button]").Click();
        Assert.Equal([3, 4], Model.Hidden.Order());
        Assert.True(Disabled(cut, "isolate-button"));
        Assert.False(Disabled(cut, "show-all-button"));
        Assert.False(Disabled(cut, "undo-button"));

        cut.Find("[data-testid=hide-button]").Click();
        Assert.Equal(PartVisibility.Hidden, Model.Visibility());

        cut.Find("[data-testid=undo-button]").Click();
        Assert.Equal([3, 4], Model.Hidden.Order());
        Assert.False(Disabled(cut, "redo-button"));
        cut.Find("[data-testid=redo-button]").Click();
        cut.Find("[data-testid=show-all-button]").Click();
        Assert.Empty(Model.Hidden);
    }

    private Task Act(Action action) => Renderer.Dispatcher.InvokeAsync(action);

    /// <summary>Opens the tree down to a node the way a 3D pick does, then clears the pick's selection.</summary>
    private async Task RevealAsync(int node)
    {
        await Act(() => Scene.Pick(Id, node, additive: false));
        await Act(() => Scene.ClearSelection());
    }

    private static AngleSharp.Dom.IElement Node(IRenderedComponent<ModelList> cut, string name) =>
        cut.FindAll("[data-testid=model-tree-node]").First(node => node.QuerySelector(".j3d-tree-node-name")?.TextContent == name);

    /// <summary>A row is what's clicked (M16, D198).</summary>
    private static AngleSharp.Dom.IElement Content(IRenderedComponent<ModelList> cut, string name) => Node(cut, name);

    private static AngleSharp.Dom.IElement Eye(IRenderedComponent<ModelList> cut, string name) =>
        Node(cut, name).QuerySelector("[data-testid=tree-node-eye]")!;

    private static bool Disabled(IRenderedComponent<Toolbar> cut, string testId) =>
        cut.Find($"[data-testid={testId}]").HasAttribute("disabled");
}

file static class ModelEntryExtensions
{
    public static bool HasSelection(this ModelEntry model) => !model.Selected.IsEmpty;
}
