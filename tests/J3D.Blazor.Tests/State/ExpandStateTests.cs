using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

/// <summary>
/// Expand, Expand all and the selection's STEP and BREP (M15, D154, D155, D189–D192, D197). The models
/// are the bracket of <see cref="TestModels.Info"/>, Bracket (0) › Plate (bottom) (1) and Top (2) ›
/// Plate (top) (3) and an unnamed part (4), with Plate (bottom) and the unnamed part compound.
/// </summary>
public sealed class ExpandStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    /// <summary>Plate (bottom)'s pieces: a named one, and a sub-assembly of two unnamed ones.</summary>
    private static readonly PartExpansion Plate = new(1, [new("Rib", -1, true), new("", -1, false), new("", 1, true), new("", 1, true)]);

    private readonly SceneState _scene = new();

    public ExpandStateTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Compound());
        }
    }

    private static ModelLoadedInfo Compound() => Info() with { Tree = Info().Tree with { Expandable = [1, 4] } };

    private ModelTree Tree => _scene.Find(A)!.Tree!;

    [Fact]
    public void The_files_compound_parts_and_their_copies_can_be_expanded()
    {
        Assert.Equal([false, true, false, false, true], Enumerable.Range(0, 5).Select(Tree.IsExpandable));
        var copied = Tree.Edit();
        copied.Copy([(1, 0)], parent: null);
        Assert.True(copied.Build().IsExpandable(5));
    }

    [Fact]
    public void Expand_puts_an_assembly_in_the_parts_place_with_its_pieces_numbered_after_their_parents()
    {
        var edit = Tree.Edit();
        var assembly = edit.Expand(1, Plate.Pieces);
        var tree = edit.Build();

        Assert.Equal(5, assembly);
        Assert.Equal([5, 2], tree.ChildrenOf(0));
        Assert.False(tree.Contains(1));
        Assert.Equal([6, 7], tree.ChildrenOf(5));
        Assert.Equal([8, 9], tree.ChildrenOf(7));
        Assert.Equal(["Plate (bottom)", "Rib", "Plate (bottom) 2", "Plate (bottom) 2 1", "Plate (bottom) 2 2"], Enumerable.Range(5, 5).Select(tree.NameOf));
        Assert.True(tree.IsAssembly(5));
        Assert.True(tree.IsAssembly(7));
        Assert.Equal([6, 8, 9, 3, 4], tree.Parts);
        Assert.False(tree.IsExpandable(6)); // Expand splits down to solids (D190)
        Assert.Equal(new ExpandedNode(1, -1, "Plate (bottom)", Part: false), tree.Edits.Pieces[5]);
        Assert.Equal(new ExpandedNode(1, 2, "Plate (bottom) 2 1", Part: true), tree.Edits.Pieces[8]);

        // The edits cross interop and back unchanged, and rename and copy pieces as any node.
        var again = new ModelTree(Compound().Tree, ModelEdits.From(tree.Edits.ToDto()));
        Assert.Equal(tree.Parts, again.Parts);
        Assert.Equal("Plate (bottom) 2 1", again.NameOf(8));
        var renamed = again.Edit().Rename(8, "Left").Build();
        Assert.Equal("Left", renamed.NameOf(8));
        Assert.Empty(renamed.Edit().Rename(8, "Plate (bottom) 2 1").Build().Edits.Names); // back to its own name
        var copy = renamed.Edit();
        copy.Copy([(6, 5)], parent: null);
        Assert.Equal("Rib", copy.Build().NameOf(10));
    }

    [Fact]
    public void A_renamed_parts_assembly_takes_its_name_now()
    {
        var renamed = Tree.Edit().Rename(1, "Base").Build();
        var edit = renamed.Edit();
        var assembly = edit.Expand(1, Plate.Pieces);
        var tree = edit.Build();
        Assert.Equal("Base", tree.NameOf(assembly));
        Assert.Equal("Base 2", tree.NameOf(assembly + 2));
    }

    [Fact]
    public void Expand_is_offered_on_one_compound_part_and_is_one_step_that_selects_its_assembly()
    {
        _scene.Pick(A, 3, additive: false);
        Assert.Null(_scene.ExpandTarget);
        _scene.Pick(A, 1, additive: false);
        Assert.Equal(1, _scene.ExpandTarget!.Value.Node);
        Assert.Empty(_scene.ExpandAllTargets); // that's Expand

        List<int> revealed = [];
        _scene.RevealRequested += (_, node) => revealed.Add(node);
        _scene.Expand(A, [1], [Plate]);

        Assert.Equal([5, 2], Tree.ChildrenOf(0));
        Assert.Equal([6, 8, 9], _scene.Find(A)!.Selected);
        Assert.Equal([6], revealed); // the tree opens to the first piece
        _scene.Undo();
        Assert.Equal([1, 2], Tree.ChildrenOf(0));
        Assert.Equal([1], _scene.Find(A)!.Selected);
        _scene.Redo();
        Assert.Equal(10, Tree.Count);
    }

    [Fact]
    public void A_hidden_parts_pieces_stay_hidden()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.HideSelection();
        _scene.Expand(A, [1], [Plate]);
        Assert.Equal([6, 8, 9], _scene.Find(A)!.Hidden);
        _scene.Undo();
        Assert.Equal([1], _scene.Find(A)!.Hidden);
    }

    [Fact]
    public void Expand_all_takes_the_compound_parts_under_the_objects_or_in_the_selected_models()
    {
        _scene.SelectNode(A, 0, additive: false); // the whole bracket
        var target = Assert.Single(_scene.ExpandAllTargets);
        Assert.Equal(A, target.Id);
        Assert.Equal([1, 4], target.Parts);

        _scene.SelectNode(A, 2, additive: false); // Top: its unnamed part
        Assert.Equal([4], Assert.Single(_scene.ExpandAllTargets).Parts);

        _scene.SetSelectionMode(SelectMode.Models);
        _scene.Pick(A, 3, additive: false);
        _scene.Pick(B, 3, additive: true);
        Assert.Equal([A, B], _scene.ExpandAllTargets.Select(static target => target.Id));
        Assert.Null(_scene.ExpandTarget);

        // Two parts of the same file part's expansion, at once.
        _scene.Expand(A, [1, 4], [Plate, Plate with { Node = 4 }]);
        Assert.Equal(15, Tree.Count);
        Assert.Equal([5, 10], Tree.Edits.Pieces.Where(static item => item.Value.Piece == -1).Select(static item => item.Key));
    }

    [Fact]
    public void Expand_all_in_Model_mode_keeps_the_models_selected_whole()
    {
        _scene.SetSelectionMode(SelectMode.Models);
        _scene.Pick(A, 3, additive: false);
        _scene.Pick(B, 3, additive: true);

        // Found in M16: the old parts stayed selected as objects, the pieces didn't, and Move found no model.
        _scene.Expand(A, [1, 4], [Plate, Plate with { Node = 4 }]);
        var model = _scene.Find(A)!;
        Assert.Equal(model.Tree!.Parts.Order(), model.Selected.Order());
        Assert.True(SceneState.IsModelSelected(model));
        Assert.True(SceneState.IsModelSelected(_scene.Find(B)!));
        _scene.Undo();
        Assert.Equal([1, 3, 4], _scene.Find(A)!.Selected);
    }

    [Fact]
    public void Edits_kept_before_M15_have_no_pieces()
    {
        var edits = ModelEdits.From(new ModelEditsDto([1], [new ChildList(0, [1, 5, 2])], []));
        Assert.Empty(edits.Pieces);
        Assert.Empty(edits.ToDto().Pieces!);
    }

    [Fact]
    public void A_selection_in_one_brep_model_exports_as_step_from_that_model()
    {
        List<(ModelId, BrepExportFormat, bool)> requests = [];
        _scene.ModelExportRequested += (id, format, selection) => requests.Add((id, format, selection));
        Assert.Null(_scene.SelectionBrepModel);

        _scene.Pick(A, 3, additive: false);
        Assert.Equal(A, _scene.SelectionBrepModel!.Id);
        _scene.RequestModelExport(BrepExportFormat.Step);
        _scene.Pick(B, 3, additive: true); // two models: GLB and STL only
        Assert.Null(_scene.SelectionBrepModel);

        _scene.SetSelectionMode(SelectMode.Models);
        _scene.Pick(B, 3, additive: false);
        _scene.RequestModelExport(BrepExportFormat.Brep);

        _scene.SetSelectionMode(SelectMode.Features);
        Assert.Null(_scene.SelectionBrepModel);
        Assert.Equal([(A, BrepExportFormat.Step, true), (B, BrepExportFormat.Brep, false)], requests);
    }
}
