using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

/// <summary>
/// Selection, visibility and undo in <see cref="SceneState"/> (M6, decisions D77, D78, D84, D95–D98).
/// Both models are the bracket of <see cref="TestModels.Info"/>: Bracket (0) holds Plate (bottom)
/// (1, a part) and Top (2), which holds Plate (top) (3) and an unnamed part (4). Parts: 1, 3, 4.
/// </summary>
public sealed class SelectionStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    private readonly SceneState _scene = new();
    private int _changes;

    public SelectionStateTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }

        _scene.Changed += () => _changes++;
    }

    private ModelEntry ModelA => _scene.Find(A)!;

    private ModelEntry ModelB => _scene.Find(B)!;

    [Fact]
    public void The_tree_knows_its_parts_their_subtrees_and_ancestors()
    {
        var tree = ModelA.Tree!;

        Assert.Equal([1, 3, 4], tree.Parts);
        Assert.Equal([1, 3, 4], tree.PartsUnder(0));
        Assert.Equal([3, 4], tree.PartsUnder(2));
        Assert.Equal([3], tree.PartsUnder(3));
        Assert.Equal([0, 2], tree.AncestorsOf(4));
        Assert.Empty(tree.AncestorsOf(0));
        Assert.True(tree.IsPart(4));
        Assert.False(tree.IsPart(2));
        Assert.False(tree.IsPart(9));
    }

    [Fact]
    public void A_pick_selects_one_part_and_ctrl_adds_or_removes_across_models()
    {
        (ModelId Id, int Node)? revealed = null;
        _scene.RevealRequested += (id, node) => revealed = (id, node);

        _scene.Pick(A, 3, additive: false);
        Assert.Equal([3], ModelA.Selected);
        Assert.Equal((A, 3), revealed);

        _scene.Pick(B, 1, additive: true);
        Assert.Equal([(A, 3), (B, 1)], _scene.Selection.Select(static s => (s.Model.Id, s.Node)));

        _scene.Pick(A, 3, additive: true);
        Assert.Empty(ModelA.Selected);
        Assert.Equal([1], ModelB.Selected);

        _scene.Pick(A, 4, additive: false);
        Assert.Equal([4], ModelA.Selected);
        Assert.Empty(ModelB.Selected);
    }

    [Fact]
    public void A_click_on_empty_space_clears_the_selection_unless_ctrl_is_held()
    {
        _scene.Pick(A, 1, additive: false);

        _scene.Pick(null, -1, additive: true);
        Assert.True(_scene.HasSelection);

        _scene.Pick(null, -1, additive: false);
        Assert.False(_scene.HasSelection);
    }

    [Fact]
    public void Picks_of_assemblies_hidden_parts_or_unknown_models_select_nothing()
    {
        _scene.Pick(A, 2, additive: false);
        _scene.Pick(new ModelId("gone"), 1, additive: false);
        _scene.HideSelection();
        Assert.False(_scene.HasSelection);

        _scene.ToggleNodeVisibility(A, 1);
        _scene.Pick(A, 1, additive: false);

        Assert.False(_scene.HasSelection);
    }

    [Fact]
    public void A_tree_node_selects_the_visible_parts_under_it_and_ctrl_toggles_them()
    {
        _scene.SelectNode(A, 2, additive: false);
        Assert.Equal([3, 4], ModelA.Selected.Order());
        Assert.True(ModelA.IsSelected(2));
        Assert.False(ModelA.IsSelected(0));

        _scene.SelectNode(A, 1, additive: true);
        Assert.True(ModelA.IsSelected(0));

        _scene.SelectNode(A, 2, additive: true);
        Assert.Equal([1], ModelA.Selected);

        _scene.ToggleNodeVisibility(A, 4);
        _scene.SelectNode(A, 0, additive: false);
        Assert.Equal([1, 3], ModelA.Selected.Order());
    }

    [Fact]
    public void Hide_hides_the_selection_and_empties_it()
    {
        _scene.SelectNode(A, 2, additive: false);
        _scene.Pick(B, 1, additive: true);

        _scene.HideSelection();

        Assert.Equal([3, 4], ModelA.Hidden.Order());
        Assert.Equal([1], ModelB.Hidden);
        Assert.False(_scene.HasSelection);
        Assert.Equal(PartVisibility.Hidden, ModelA.VisibilityOf(2));
        Assert.Equal(PartVisibility.Mixed, ModelA.VisibilityOf(0));
        Assert.Equal(PartVisibility.Visible, ModelA.VisibilityOf(1));
        Assert.Equal(PartVisibility.Mixed, ModelB.Visibility());
    }

    [Fact]
    public void Isolate_hides_every_other_part_in_every_model_and_keeps_the_selection()
    {
        Assert.False(_scene.CanIsolate);
        _scene.Pick(A, 3, additive: false);
        Assert.True(_scene.CanIsolate);

        _scene.IsolateSelection();

        Assert.Equal([1, 4], ModelA.Hidden.Order());
        Assert.Equal(PartVisibility.Hidden, ModelB.Visibility());
        Assert.Equal([3], ModelA.Selected);
        Assert.False(_scene.CanIsolate); // every visible part is selected
        Assert.True(_scene.TakeFitRequest()); // the view fits what's left
        Assert.False(_scene.TakeFitRequest());
    }

    [Fact]
    public void Only_isolate_asks_for_the_view_to_fit()
    {
        _scene.Pick(A, 3, additive: false);
        _scene.HideSelection();
        _scene.ShowAll();

        Assert.False(_scene.TakeFitRequest());
    }

    [Fact]
    public void Show_all_shows_everything_and_eyes_toggle_nodes_and_models()
    {
        _scene.ToggleNodeVisibility(A, 2);
        Assert.Equal([3, 4], ModelA.Hidden.Order());
        _scene.ToggleNodeVisibility(A, 0); // mixed: hides the rest too
        Assert.Equal(PartVisibility.Hidden, ModelA.Visibility());
        _scene.ToggleNodeVisibility(A, 0); // all hidden: shows them
        Assert.Empty(ModelA.Hidden);

        _scene.ToggleModelVisibility(B);
        Assert.Equal(PartVisibility.Hidden, ModelB.Visibility());
        Assert.True(_scene.HasHidden);

        _scene.ShowAll();
        Assert.False(_scene.HasHidden);
    }

    [Fact]
    public void Visibility_changes_undo_and_redo_without_selecting_again()
    {
        _scene.SelectNode(A, 2, additive: false);
        _scene.HideSelection();
        _scene.ToggleModelVisibility(B);
        Assert.True(_scene.CanUndo);

        _scene.Undo();
        Assert.Empty(ModelB.Hidden);
        _scene.Undo();
        Assert.Empty(ModelA.Hidden);
        Assert.False(_scene.HasSelection);
        Assert.StartsWith("selecting", _scene.UndoLabel); // the tree pick before them (D219)

        _scene.Redo();
        Assert.Equal([3, 4], ModelA.Hidden.Order());
        Assert.True(_scene.CanRedo);

        _scene.ShowAll(); // a new step: nothing left to redo
        Assert.False(_scene.CanRedo);
    }

    [Fact]
    public void Undoing_a_show_drops_the_parts_it_hides_again_from_the_selection()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.HideSelection();
        _scene.ShowAll();
        _scene.Pick(A, 1, additive: false);

        _scene.Undo(); // the pick (D219)
        Assert.Empty(ModelA.Hidden);
        Assert.False(_scene.HasSelection);
        _scene.Undo();

        Assert.Equal([1], ModelA.Hidden);
        Assert.False(_scene.HasSelection);
    }

    [Fact]
    public void Changes_that_change_nothing_record_no_step_and_raise_nothing()
    {
        _scene.ShowAll();
        _scene.HideSelection();
        _scene.ClearSelection();

        Assert.False(_scene.CanUndo);
        Assert.Equal(0, _changes);
    }

    [Fact]
    public void A_removed_model_leaves_the_history()
    {
        _scene.ToggleModelVisibility(A);
        _scene.ToggleModelVisibility(B);
        _scene.ShowAll();

        _scene.Remove(B);
        _scene.Undo(); // show all, now only model a
        Assert.Equal(PartVisibility.Hidden, ModelA.Visibility());
        _scene.Undo(); // hiding model a; the step for b alone has gone
        Assert.Empty(ModelA.Hidden);
        Assert.False(_scene.CanUndo);
    }

    [Fact]
    public void The_history_keeps_the_last_fifty_steps()
    {
        for (var i = 0; i < UndoHistory.Capacity + 5; i++)
        {
            _scene.ToggleModelVisibility(A);
        }

        var undone = 0;
        while (_scene.CanUndo)
        {
            _scene.Undo();
            undone++;
        }

        Assert.Equal(UndoHistory.Capacity, undone);
    }

    [Fact]
    public void A_model_that_is_not_loaded_has_no_parts()
    {
        _scene.Add(Summary("q"));
        var queued = _scene.Find(new ModelId("q"))!;

        Assert.Same(queued, queued.WithParts([1], [1]));
        Assert.Equal(PartVisibility.Visible, queued.Visibility());
        _scene.SelectNode(new ModelId("q"), 0, additive: false);
        Assert.False(_scene.HasSelection);
    }
}
