using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// Selection changes as undo steps (M17, D209, D218, D219) and the steps' labels (D224). The models are
/// the bracket of <see cref="TestModels.Info"/>: Bracket (0) holds Plate (bottom) (1, a part) and Top
/// (2), which holds Plate (top) (3) and an unnamed part (4). Parts: 1, 3, 4.
/// </summary>
public sealed class SelectionUndoTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    private readonly SceneState _scene = new();

    public SelectionUndoTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }
    }

    private ModelEntry ModelA => _scene.Find(A)!;

    private ModelEntry ModelB => _scene.Find(B)!;

    [Fact]
    public void Picks_ctrl_picks_and_clearing_undo_and_redo_one_at_a_time()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(B, 3, additive: true);
        Assert.Equal("selecting 2 parts", _scene.UndoLabel);
        _scene.Escape();
        Assert.Equal("clearing the selection", _scene.UndoLabel);

        _scene.Undo();
        Assert.Equal([1], ModelA.Selected);
        Assert.Equal([3], ModelB.Selected);
        Assert.Equal("clearing the selection", _scene.RedoLabel);
        _scene.Undo();
        Assert.Equal([1], ModelA.Selected);
        Assert.Empty(ModelB.Selected);
        _scene.Undo();
        Assert.False(_scene.HasSelection);
        Assert.False(_scene.CanUndo);

        _scene.Redo();
        _scene.Redo();
        Assert.Equal([3], ModelB.Selected);
        _scene.Redo();
        Assert.False(_scene.HasSelection);
    }

    [Fact]
    public void A_change_that_selects_the_same_is_no_step()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(null, -1, additive: true); // Ctrl on empty space keeps the selection
        _scene.Undo();

        Assert.False(_scene.HasSelection);
        Assert.False(_scene.CanUndo);
    }

    [Fact]
    public void A_mode_switch_that_changes_the_selection_is_a_step_and_undo_puts_the_mode_back()
    {
        _scene.SetSelectionMode(SelectMode.Models); // nothing selected: no step
        Assert.False(_scene.CanUndo);
        _scene.SetSelectionMode(SelectMode.Objects);

        _scene.Pick(A, 3, additive: false);
        _scene.SetSelectionMode(SelectMode.Models);
        Assert.Equal([1, 3, 4], ModelA.Selected);
        Assert.Equal("switching to Model mode", _scene.UndoLabel);

        _scene.Undo();
        Assert.Equal(SelectMode.Objects, _scene.Mode);
        Assert.Equal([3], ModelA.Selected);
        _scene.Redo();
        Assert.Equal(SelectMode.Models, _scene.Mode);
        Assert.Equal([1, 3, 4], ModelA.Selected);
    }

    [Fact]
    public void A_tree_click_in_feature_mode_is_one_step_with_its_switch_to_object_mode()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.SetSelectionMode(SelectMode.Features);
        _scene.SelectNode(A, 2, additive: false);
        Assert.Equal(SelectMode.Objects, _scene.Mode);
        Assert.Equal([3, 4], ModelA.Selected);

        _scene.Undo();
        Assert.Equal(SelectMode.Features, _scene.Mode);
        Assert.False(_scene.HasSelection);
        _scene.Undo();
        Assert.Equal(SelectMode.Objects, _scene.Mode);
        Assert.Equal([1], ModelA.Selected);
    }

    [Fact]
    public void Undo_puts_back_the_node_the_move_tool_moves()
    {
        _scene.SelectNode(A, 2, additive: false);
        Assert.Equal((A, 2), _scene.MoveTarget);
        _scene.Pick(A, 1, additive: false);
        Assert.Equal((A, 1), _scene.MoveTarget);

        _scene.Undo();
        Assert.Equal((A, 2), _scene.MoveTarget);
    }

    [Fact]
    public void Feature_selections_are_steps_only_when_a_click_made_them()
    {
        _scene.SetSelectionMode(SelectMode.Features);
        _scene.SetFeatures(Features("[1]", byUser: true));
        _scene.SetFeatures(Features("[1]", byUser: false)); // its values arrived: the same features
        _scene.SetFeatures(Features("[1,2]", byUser: true));
        Assert.Equal("selecting 2 features", _scene.UndoLabel);
        _scene.SetFeatures(Features("[2]", byUser: false)); // a part hidden: the viewer dropped one
        Assert.Equal("selecting 2 features", _scene.UndoLabel);

        _scene.Undo();
        Assert.Equal("[1]", _scene.TakeFeaturesToRestore());
        Assert.Null(_scene.TakeFeaturesToRestore()); // once
        _scene.SetFeatures(Features("[1]", byUser: false)); // the viewer's report of the restore
        Assert.Equal("selecting 1 feature", _scene.UndoLabel);
        Assert.Equal("selecting 2 features", _scene.RedoLabel);

        _scene.Escape();
        Assert.Equal("clearing the selection", _scene.UndoLabel);
        _scene.Undo();
        Assert.Equal("[1]", _scene.TakeFeaturesToRestore());
    }

    [Fact]
    public void Undoing_a_switch_back_to_feature_mode_restores_its_features()
    {
        _scene.SetSelectionMode(SelectMode.Features);
        _scene.SetFeatures(Features("[7]", byUser: true));
        _scene.SetSelectionMode(SelectMode.Objects);
        Assert.Equal("switching to Object mode", _scene.UndoLabel);

        _scene.Undo();
        Assert.Equal(SelectMode.Features, _scene.Mode);
        Assert.Equal("[7]", _scene.TakeFeaturesToRestore());
    }

    [Fact]
    public void Selection_steps_dont_push_edits_out_and_go_first_when_there_are_too_many()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.HideSelection();
        for (var i = 0; i < UndoHistory.SelectionCapacity + 10; i++)
        {
            _scene.Pick(A, i % 2 == 0 ? 3 : 4, additive: false);
        }

        var undone = 0;
        while (_scene.CanUndo)
        {
            _scene.Undo();
            undone++;
        }

        Assert.Equal(UndoHistory.SelectionCapacity + 1, undone); // the last 50 picks, then the hide
        Assert.Empty(ModelA.Hidden);
    }

    [Fact]
    public void Each_step_is_named_for_the_tooltips()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.HideSelection();
        Assert.Equal("Hide", _scene.UndoLabel);
        _scene.ShowAll();
        Assert.Equal("Show all", _scene.UndoLabel);
        _scene.ToggleModelVisibility(B);
        Assert.Equal("Hide", _scene.UndoLabel);
        _scene.ToggleModelVisibility(B);
        Assert.Equal("Show", _scene.UndoLabel);

        _scene.Pick(A, 3, additive: false);
        _scene.Copy();
        _scene.Paste();
        Assert.Equal("Paste", _scene.UndoLabel);
        _scene.Group();
        Assert.Equal("New assembly", _scene.UndoLabel);
        _scene.EndRename(null);
        _scene.DeleteSelection();
        Assert.Equal("Delete", _scene.UndoLabel);

        _scene.Undo();
        Assert.Equal("Delete", _scene.RedoLabel);
    }

    private static FeatureSelection Features(string keys, bool byUser) => new([], [], keys, byUser);
}
