using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// Editing models' trees in <see cref="SceneState"/> (M14, decisions D151, D152, D180–D187). Models
/// "a" and "b" are the bracket of <see cref="TestModels.Info"/>: Bracket (0) holds Plate (bottom) (1)
/// and the Top sub-assembly (2), which holds Plate (top) (3) and an unnamed part (4).
/// </summary>
public sealed class EditStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    private readonly SceneState _scene = new();

    public EditStateTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }
    }

    private ModelTree Tree => _scene.Find(A)!.Tree!;

    private PartSet Selected => _scene.Find(A)!.Selected;

    [Fact]
    public void Copy_then_paste_adds_a_copy_beside_the_original_and_selects_it_and_undo_takes_it_away()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Copy();
        Assert.True(_scene.CanPaste);

        _scene.Paste();

        Assert.Equal([1, 5, 2], Tree.ChildrenOf(0));
        Assert.Equal(1, Tree.SourceOf(5));
        Assert.Equal([5], Selected);
        _scene.Paste(); // a copy pastes again, beside the selected copy
        Assert.Equal([1, 5, 6, 2], Tree.ChildrenOf(0));

        _scene.Undo();
        _scene.Undo();
        Assert.Equal(5, Tree.Count);
        Assert.Equal([1], Selected);
        _scene.Redo();
        Assert.Equal([5], Selected);
    }

    [Fact]
    public void Paste_goes_into_a_selected_assembly_beside_a_selected_part_and_never_into_its_own_original()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Copy();
        _scene.SelectNode(A, 2, additive: false); // the Top sub-assembly
        _scene.Paste();
        Assert.Equal([3, 4, 5], Tree.ChildrenOf(2));

        _scene.Pick(A, 3, additive: false); // a part: just after it, in its parent
        _scene.Paste();
        Assert.Equal([3, 6, 4, 5], Tree.ChildrenOf(2));

        _scene.SelectNode(A, 2, additive: false);
        _scene.Copy();
        _scene.Paste(); // the copied assembly is still selected: beside it, not inside it (D180)
        Assert.Equal([1, 2, 7], Tree.ChildrenOf(0));
        Assert.Equal([8, 9, 10, 11], Tree.ChildrenOf(7));
    }

    [Fact]
    public void Cut_then_paste_moves_the_objects_into_the_assembly_once_and_drops_their_moves()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.RecordMove(A, 1, Matrix4d.Identity, Matrix4d.Identity * Translated(5));
        _scene.Cut();
        Assert.True(_scene.IsCut(A, 1));
        Assert.Equal([1, 2], Tree.ChildrenOf(0)); // nothing moves until Paste (assumption 20)

        _scene.SelectNode(A, 2, additive: false);
        _scene.Paste();

        Assert.Equal([3, 4, 1], Tree.ChildrenOf(2));
        Assert.Equal([1], Selected);
        Assert.Null(_scene.Clipboard);
        Assert.False(_scene.CanPaste);
        Assert.False(_scene.Find(A)!.Placements.ContainsKey(1)); // in the old parent's frame; the viewer keeps its place

        _scene.Undo();
        Assert.Equal([1, 2], Tree.ChildrenOf(0));
        Assert.True(_scene.Find(A)!.Placements.ContainsKey(1));
    }

    [Fact]
    public void Delete_removes_the_objects_and_an_assembly_it_empties_and_undo_brings_them_back_selected()
    {
        _scene.Pick(A, 3, additive: false);
        _scene.DeleteSelection();
        Assert.False(Tree.Contains(3));
        Assert.True(Tree.Contains(2));
        Assert.Empty(Selected);

        _scene.Pick(A, 4, additive: false);
        _scene.DeleteSelection();
        Assert.False(Tree.Contains(2)); // left empty, so it went too (D181)
        Assert.Equal([1], Tree.ChildrenOf(0));

        _scene.Undo();
        Assert.Equal([4], Selected);
        Assert.True(Tree.Contains(2));
    }

    [Fact]
    public void Edits_take_the_selections_objects_with_hidden_parts_copied_hidden()
    {
        _scene.ToggleNodeVisibility(A, 4);
        _scene.SelectNode(A, 2, additive: false); // Top, whose visible part is 3
        Assert.Equal([(A, 2)], _scene.EditObjects.Select(static item => (item.Model.Id, item.Node)));

        _scene.Copy();
        _scene.Pick(A, 1, additive: false);
        _scene.Paste(); // just after Plate (bottom), in the Bracket

        Assert.Equal([1, 5, 2], Tree.ChildrenOf(0));
        Assert.Equal([6, 7], Tree.ChildrenOf(5));
        Assert.True(_scene.Find(A)!.Hidden.Contains(7)); // the copy of the hidden part
        Assert.Equal([6], Selected);
    }

    [Fact]
    public void New_assembly_groups_the_objects_in_their_common_parent_and_opens_its_name()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(A, 3, additive: true);
        Assert.True(_scene.CanGroup);

        _scene.Group();

        Assert.Equal([5, 2], Tree.ChildrenOf(0));
        Assert.Equal([1, 3], Tree.ChildrenOf(5));
        Assert.Equal("Assembly 1", Tree.NameOf(5));
        Assert.Equal(new Renaming(A, 5, IsNew: true), _scene.Renaming);

        _scene.EndRename("  Fixings ");
        Assert.Equal("Fixings", Tree.NameOf(5));
        Assert.Null(_scene.Renaming);

        _scene.Undo();
        Assert.Equal("Assembly 1", Tree.NameOf(5));
        _scene.Undo();
        Assert.Equal([1, 2], Tree.ChildrenOf(0));
    }

    [Fact]
    public void A_rename_that_is_empty_unchanged_or_escaped_changes_nothing()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.BeginRename();
        Assert.Equal(new Renaming(A, 1, IsNew: false), _scene.Renaming);
        _scene.EndRename(null);
        _scene.BeginRename();
        _scene.EndRename("  ");
        _scene.BeginRename();
        _scene.EndRename("Plate (bottom)");

        Assert.False(_scene.CanUndo);
        Assert.Equal("Plate (bottom)", Tree.NameOf(1));
    }

    [Fact]
    public void Ungroup_puts_an_assemblys_children_in_its_place()
    {
        _scene.SelectNode(A, 2, additive: false);
        Assert.True(_scene.CanUngroup);

        _scene.Ungroup();

        Assert.Equal([1, 3, 4], Tree.ChildrenOf(0));
        Assert.False(Tree.Contains(2));
        Assert.Equal([3, 4], Selected);
    }

    [Fact]
    public void A_drop_moves_or_copies_the_dragged_objects_and_is_refused_into_their_own_subtrees()
    {
        _scene.Drop(A, 1, target: 2, copy: false);
        Assert.Equal([3, 4, 1], Tree.ChildrenOf(2));

        _scene.Drop(A, 3, target: ModelTree.TopLevel, copy: false);
        Assert.Equal([0, 3], Tree.Roots);

        _scene.Drop(A, 3, target: 2, copy: true); // Ctrl: a copy, and the original stays
        Assert.Equal([4, 1, 5], Tree.ChildrenOf(2));
        Assert.Equal([0, 3], Tree.Roots);

        var before = Tree;
        _scene.Drop(A, 0, target: 2, copy: false); // into its own subtree
        _scene.Drop(A, 1, target: 4, copy: false); // onto a part
        Assert.Same(before, Tree);
    }

    [Fact]
    public void Dragging_a_selected_node_drags_the_whole_selection()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(A, 4, additive: true);

        _scene.Drop(A, 4, target: ModelTree.TopLevel, copy: false);

        Assert.Equal([0, 1, 4], Tree.Roots);
    }

    [Fact]
    public void Cut_copy_and_new_assembly_take_one_models_objects_and_paste_stays_in_that_model()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(B, 1, additive: true);
        Assert.False(_scene.CanCopy);
        Assert.False(_scene.CanGroup);
        Assert.True(_scene.CanDelete);

        _scene.Pick(A, 1, additive: false);
        _scene.Copy();
        _scene.SelectNode(B, 2, additive: false);
        Assert.False(_scene.CanPaste); // the target is in another model (D180)
    }

    [Fact]
    public void Delete_of_objects_in_two_models_is_one_step()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(B, 3, additive: true);

        _scene.DeleteSelection();
        Assert.False(Tree.Contains(1));
        Assert.False(_scene.Find(B)!.Tree!.Contains(3));

        _scene.Undo();
        Assert.True(Tree.Contains(1));
        Assert.True(_scene.Find(B)!.Tree!.Contains(3));
        Assert.False(_scene.CanUndo);
    }

    [Fact]
    public void Model_mode_only_deletes_models_and_asks_first_and_feature_mode_doesnt_edit()
    {
        IReadOnlyList<ModelId>? asked = null;
        _scene.DeleteModelsRequested += ids => asked = ids;
        _scene.SetSelectionMode(SelectMode.Models);
        _scene.Pick(A, 1, additive: false);

        Assert.False(_scene.CanCopy);
        Assert.False(_scene.CanRename);
        _scene.DeleteSelection();
        Assert.Equal([A], asked);
        Assert.NotNull(_scene.Find(A)); // the list asks before anything goes

        _scene.DeleteModels([A]);
        Assert.Null(_scene.Find(A));

        _scene.SetSelectionMode(SelectMode.Features);
        Assert.False(_scene.CanDelete);
        Assert.Empty(_scene.EditObjects);
    }

    [Fact]
    public void A_restored_model_loads_with_its_kept_edits()
    {
        var id = new ModelId("kept");
        _scene.Add(Summary(id.Value));
        _scene.MarkLoaded(id, Info() with { Edits = new ModelEditsDto([1], [new ChildList(0, [1, 2, 5])], []) });

        var tree = _scene.Find(id)!.Tree!;
        Assert.Equal([1, 2, 5], tree.ChildrenOf(0));
        Assert.Equal(1, tree.SourceOf(5));
    }

    [Fact]
    public void The_viewers_count_after_an_edit_replaces_the_imported_one()
    {
        var stats = new ModelStats(Nodes: 6, Prototypes: 2, Instances: 4, Triangles: 10, Edges: 2, Textures: 0);

        _scene.ReportStats(A, stats);

        Assert.Equal(stats, _scene.Find(A)!.Stats);
    }

    private static Matrix4d Translated(double x) => new([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);
}
