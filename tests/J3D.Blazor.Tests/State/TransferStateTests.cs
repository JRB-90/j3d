using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

/// <summary>
/// Moving and copying objects between models (M18, D210, D225–D233) in <see cref="SceneState"/>: what
/// asks for it, and the edit an arrival makes. The models are the bracket of <see cref="TestModels.Info"/>,
/// Bracket (0) › Plate (bottom) (1) and Top (2) › Plate (top) (3) and an unnamed part (4); an STL is a
/// mesh model.
/// </summary>
public sealed class TransferStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");
    private static readonly ModelId Mesh = new("m");

    /// <summary>Top as it arrives: the sub-assembly (1), its plate (2, hidden where it came from) and the unnamed compound part (3).</summary>
    private static readonly TransferOutcome TopArrives = new(
        "arrival-1.step",
        4,
        [new(0, "Top", Part: false, Expandable: false, Hidden: false), new(1, "Plate (top)", Part: true, Expandable: false, Hidden: true), new(1, "", Part: true, Expandable: true, Hidden: false)]);

    private readonly SceneState _scene = new();
    private readonly List<TransferRequest> _requests = [];

    public TransferStateTests()
    {
        _scene.Add(Summary(A.Value, "a.step"));
        _scene.MarkLoaded(A, Info());
        _scene.Add(Summary(B.Value, "b.step"));
        _scene.MarkLoaded(B, Info());
        _scene.Add(Summary(Mesh.Value, "m.stl", ModelFormat.Stl));
        _scene.MarkLoaded(Mesh, Info());
        _scene.TransferRequested += _requests.Add;
    }

    private ModelTree TreeOf(ModelId id) => _scene.Find(id)!.Tree!;

    [Fact]
    public void A_drop_on_another_model_asks_for_a_transfer_and_one_in_the_same_model_moves_as_before()
    {
        _scene.Drop(A, 2, B, 0, copy: true);
        _scene.Drop(A, 4, A, ModelTree.TopLevel, copy: false);

        var request = Assert.Single(_requests);
        Assert.Equal((A, B, 0, true), (request.Source, request.Target, request.Parent, request.Copy));
        Assert.Equal([2], request.Nodes);
        Assert.Equal([0, 4], TreeOf(A).Roots);
    }

    [Fact]
    public void Paste_reaches_another_model_where_the_selection_is_and_its_top_level_in_model_mode()
    {
        _scene.SelectNode(A, 2, additive: false);
        _scene.Cut();
        _scene.Pick(B, 1, additive: false); // a part: beside it
        _scene.Paste();
        _scene.SetSelectionMode(SelectMode.Models);
        _scene.Pick(B, 1, additive: false);
        Assert.True(_scene.CanPaste);
        _scene.Paste();

        Assert.Equal(2, _requests.Count);
        Assert.Equal((B, 0, (int?)1, false, true), (_requests[0].Target, _requests[0].Parent, _requests[0].After, _requests[0].Copy, _requests[0].FromCut));
        Assert.Equal((B, ModelTree.TopLevel, (int?)null), (_requests[1].Target, _requests[1].Parent, _requests[1].After));
    }

    [Fact]
    public void A_copy_arrives_named_placed_hidden_where_it_was_and_selected_as_one_step()
    {
        var request = new TransferRequest(A, [2], B, 0, null, Copy: true);

        Assert.True(_scene.CompleteTransfer(request, TopArrives));

        var tree = TreeOf(B);
        Assert.Equal([1, 2, 5], tree.ChildrenOf(0));
        Assert.Equal(["Top", "Plate (top)", ""], [tree.NameOf(5), tree.NameOf(6), tree.NameOf(7)]);
        Assert.Equal([6, 7], tree.ChildrenOf(5));
        Assert.Equal([6], _scene.Find(B)!.Hidden.Order());
        Assert.Equal([7], _scene.Find(B)!.Selected.Order()); // its visible parts
        Assert.Equal(new KeptArrival("arrival-1.step", 4), Assert.Single(tree.Edits.Arrivals));
        Assert.Equal(5 + 3, tree.FileNodeOf(7)); // the facade numbers it after the file's 5 nodes (M18)
        Assert.True(tree.IsExpandable(7));
        Assert.Equal("Copy to b.step", _scene.UndoLabel);
        Assert.True(TreeOf(A).Contains(2)); // a copy leaves the source as it was

        _scene.Undo();
        Assert.False(TreeOf(B).Contains(5));
        Assert.Empty(TreeOf(B).Edits.Arrivals);
        _scene.Redo();
        Assert.True(TreeOf(B).Contains(7));
    }

    [Fact]
    public void A_move_leaves_its_source_in_the_same_step_and_an_emptied_model_stays()
    {
        var request = new TransferRequest(A, [0], B, ModelTree.TopLevel, null, Copy: false) { FromCut = true };
        var outcome = TopArrives with { Nodes = [new(0, "Bracket", false, false, false), .. TopArrives.Nodes!.Skip(1).Select(static node => node with { Parent = 1 })], Count = 4 };
        _scene.SelectNode(A, 0, additive: false);
        _scene.Cut();

        Assert.True(_scene.CompleteTransfer(request, outcome));

        Assert.Empty(TreeOf(A).Roots);
        Assert.NotNull(_scene.Find(A)); // still listed, with nothing in it (D231)
        Assert.Equal([0, 5], TreeOf(B).Roots);
        Assert.Null(_scene.Clipboard); // a cut is pasted once (assumption 20)
        Assert.Equal("Move to b.step", _scene.UndoLabel);

        _scene.Undo();
        Assert.Equal([0], TreeOf(A).Roots);
        Assert.Equal([0], TreeOf(B).Roots);
    }

    [Fact]
    public void A_second_arrival_is_numbered_after_the_first_and_nothing_changes_when_the_target_has_gone()
    {
        _scene.CompleteTransfer(new TransferRequest(A, [2], B, 0, null, Copy: true), TopArrives);
        _scene.CompleteTransfer(new TransferRequest(A, [2], B, 0, null, Copy: true), TopArrives with { File = "arrival-2.step" });

        var tree = TreeOf(B);
        Assert.Equal(["arrival-1.step", "arrival-2.step"], tree.Edits.Arrivals.Select(static kept => kept.File));
        Assert.Equal(5 + 4 + 3, tree.FileNodeOf(10)); // after the file's 5 and the first arrival's 4

        Assert.False(_scene.CompleteTransfer(new TransferRequest(A, [2], B, 99, null, Copy: true), TopArrives));
        Assert.False(_scene.CompleteTransfer(new TransferRequest(A, [2], new ModelId("gone"), 0, null, Copy: true), TopArrives));
        Assert.False(_scene.CompleteTransfer(new TransferRequest(A, [2], B, 0, null, Copy: true), new TransferOutcome(Error: "no")));
    }

    [Fact]
    public void Objects_that_arrived_survive_the_edits_round_trip()
    {
        _scene.CompleteTransfer(new TransferRequest(A, [2], B, 0, null, Copy: true), TopArrives);
        var edits = TreeOf(B).Edits;

        var (numbers, text) = EditsCodec.Encode(edits);
        var again = ModelEdits.From(EditsCodec.Decode(numbers, text));

        Assert.Equal(edits.Arrivals, again.Arrivals);
        Assert.Equal(edits.Arrived.OrderBy(static item => item.Key), again.Arrived.OrderBy(static item => item.Key));
        Assert.Equal(edits.Arrivals, ModelEdits.From(edits.ToDto()).Arrivals);
    }
}
