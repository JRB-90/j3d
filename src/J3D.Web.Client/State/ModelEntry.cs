using System.Collections.Immutable;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

public enum ModelStatus
{
    Queued,
    Importing,
    Loaded,
    Failed,
}

/// <summary>Whether a node's parts are drawn: all of them, none, or some (the tree's half eye, D96).</summary>
public enum PartVisibility
{
    Visible,
    Hidden,
    Mixed,
}

/// <summary>
/// What an edit changes in a model (M14): its tree's edits, and the hidden parts, selection and moves
/// that go with them, which an undo puts back together.
/// </summary>
public sealed record ModelEdit(ModelEdits Edits, PartSet Hidden, PartSet Selected, ImmutableDictionary<int, Matrix4d> Placements)
{
    /// <summary>The tree these edits make, when it's been built already: building one of 10,000 nodes takes a while under WebAssembly.</summary>
    public ModelTree? Tree { get; init; }
}

/// <summary>A STEP or BREP export of a loaded model in progress (D125): the format, and how far it is (0–1), or null when OCCT can't tell.</summary>
public sealed record ModelExport(BrepExportFormat Format, double? Fraction);

/// <summary>
/// One model in the list. Transitions are pure: each returns the entry it leads to, or this entry
/// when it doesn't apply (docs/plan.md §6.4).
/// </summary>
public sealed record ModelEntry(ModelSummary Summary)
{
    /// <summary>
    /// A model to import again from its kept files (M8): after a reload, or when a delete is undone.
    /// Its hidden parts apply once it has loaded (D82).
    /// </summary>
    public static ModelEntry Restoring(ModelSummary summary, IEnumerable<int> hidden) =>
        new(summary) { Hidden = PartSet.From(hidden), IsRestored = true };

    /// <summary>A deleted model coming back (D84): as it was, but queued, with nothing selected.</summary>
    public static ModelEntry Restoring(ModelEntry deleted) =>
        new(deleted.Summary) { Hidden = deleted.Hidden, Placements = deleted.Placements, NotKept = deleted.NotKept, IsRestored = true };

    public ModelStatus Status { get; private init; } = ModelStatus.Queued;

    /// <summary>The phase being imported; set only while <see cref="ModelStatus.Importing"/>.</summary>
    public ImportPhase? Phase { get; private init; }

    /// <summary>How far through <see cref="Phase"/> the import is (0–1), or null when the phase can't tell.</summary>
    public double? Fraction { get; private init; }

    public ModelLoadedInfo? Info { get; private init; }

    public ImportError? Error { get; private init; }

    /// <summary>The loaded model's tree, indexed once (decisions D53, D77).</summary>
    public ModelTree? Tree { get; private init; }

    /// <summary>The hidden part nodes (D78).</summary>
    public PartSet Hidden { get; private init; } = PartSet.Empty;

    /// <summary>The selected part nodes; never hidden ones (D98).</summary>
    public PartSet Selected { get; private init; } = PartSet.Empty;

    /// <summary>
    /// The nodes moved in this visit, each with its placement in its parent's frame (M13, D145); node
    /// <see cref="ModelFrameNode"/> is the model's own frame (D169). The viewer keeps and draws them;
    /// this is what undo and redo work on, and the <c>Viewport</c> sends a node's when it changes.
    /// </summary>
    public ImmutableDictionary<int, Matrix4d> Placements { get; private init; } = [];

    /// <summary>The node number that stands for the whole model (M13, D169).</summary>
    public const int ModelFrameNode = -1;

    /// <summary>Why the model's files couldn't be kept for the next visit (D115), or null.</summary>
    public string? NotKept { get; private init; }

    /// <summary>Imported again from its kept files, after a reload or an undone delete (M8).</summary>
    public bool IsRestored { get; private init; }

    /// <summary>The STEP or BREP export in progress (M9, D125), or null. A model coming back from a delete has none.</summary>
    public ModelExport? Export { get; private init; }

    public ModelId Id => Summary.Id;

    /// <summary>Queued or importing: removing it cancels the import.</summary>
    public bool IsPending => Status is ModelStatus.Queued or ModelStatus.Importing;

    /// <summary>Progress applies only while the import is pending, so a late report can't undo its outcome.</summary>
    public ModelEntry WithProgress(ImportPhase phase, double? fraction) =>
        IsPending ? this with { Status = ModelStatus.Importing, Phase = phase, Fraction = fraction } : this;

    /// <summary>
    /// Loaded, with its kept edits applied to its tree (M14), keeping only those hidden parts (set while
    /// it was restored) that are parts of it.
    /// </summary>
    public ModelEntry AsLoaded(ModelLoadedInfo info)
    {
        var tree = new ModelTree(info.Tree, ModelEdits.From(info.Edits));
        return this with
        {
            Status = ModelStatus.Loaded,
            Phase = null,
            Fraction = null,
            Info = info,
            Error = null,
            Tree = tree,
            Hidden = Hidden.IsEmpty ? Hidden : Hidden.Where(tree.IsPart),
            EditedStats = null,
        };
    }

    /// <summary>What the model draws: as the viewer last counted it after an edit (M14), else as imported.</summary>
    public ModelStats? Stats => EditedStats ?? Info?.Stats;

    /// <summary>The viewer's count of what the model draws since its last edit, or null.</summary>
    public ModelStats? EditedStats { get; private init; }

    /// <summary>The model's edits to its tree (M14); none until it has loaded.</summary>
    public ModelEdits Edits => Tree?.Edits ?? ModelEdits.None;

    /// <summary>
    /// The model's tree, parts and moves as an edit leaves them, or as an undo or redo brings them back
    /// (M14). Hidden and selected parts the tree no longer has are dropped (D98). Only a loaded model edits.
    /// </summary>
    public ModelEntry WithEdit(ModelEdit edit)
    {
        if (Tree is not { } current)
        {
            return this;
        }

        var tree = edit.Tree is { } built && ReferenceEquals(built.Edits, edit.Edits) ? built
            : ReferenceEquals(current.Edits, edit.Edits) ? current
            : new ModelTree(current.File, edit.Edits);
        var hidden = edit.Hidden.Where(tree.IsPart);
        return this with
        {
            Tree = tree,
            Hidden = hidden,
            Selected = edit.Selected.Where(node => tree.IsPart(node) && !hidden.Contains(node)),
            Placements = edit.Placements,
        };
    }

    /// <summary>What the model draws after an edit, as the viewer counted it.</summary>
    public ModelEntry WithStats(ModelStats stats) => Status != ModelStatus.Loaded || stats.Equals(Stats) ? this : this with { EditedStats = stats };

    /// <summary>The model's edit state, to undo or redo to (M14).</summary>
    public ModelEdit EditState => new(Edits, Hidden, Selected, Placements) { Tree = Tree };

    /// <summary>A node (or the model) moved to a placement in its parent's frame. Only a loaded model, or one coming back, moves.</summary>
    public ModelEntry WithPlacement(int node, Matrix4d placement) =>
        (Status != ModelStatus.Loaded && !IsRestored) || (Placements.TryGetValue(node, out var current) && current.Equals(placement))
            ? this
            : this with { Placements = Placements.SetItem(node, placement) };

    /// <summary>An export started, moved on or ended (null). Only a loaded model exports.</summary>
    public ModelEntry WithExport(ModelExport? export) =>
        export == Export || (export is not null && Status != ModelStatus.Loaded) ? this : this with { Export = export };

    /// <summary>The model's files couldn't be kept: <paramref name="reason"/> says why (D115).</summary>
    public ModelEntry AsNotKept(string reason) => NotKept == reason ? this : this with { NotKept = reason };

    public ModelEntry AsFailed(ImportError error) =>
        this with { Status = ModelStatus.Failed, Phase = null, Fraction = null, Info = null, Error = error, Tree = null };

    /// <summary>
    /// New hidden and selected parts, keeping only part nodes of this tree, and dropping hidden parts
    /// from the selection (D98). Only a loaded model has parts, but a model being imported again from
    /// its kept files takes hidden parts for when it has loaded (an undo meanwhile, M8). The same sets
    /// return this entry.
    /// </summary>
    public ModelEntry WithParts(IEnumerable<int> hidden, IEnumerable<int> selected)
    {
        if (Tree is not { } tree)
        {
            var pending = PartSet.From(hidden);
            return !IsPending || !IsRestored || pending.SetEquals(Hidden) ? this : this with { Hidden = pending };
        }

        var nextHidden = PartSet.From(hidden).Where(tree.IsPart);
        var nextSelected = PartSet.From(selected).Where(node => tree.IsPart(node) && !nextHidden.Contains(node));
        return nextHidden.SetEquals(Hidden) && nextSelected.SetEquals(Selected)
            ? this
            : this with { Hidden = nextHidden, Selected = nextSelected };
    }

    /// <summary>Whether the parts under a node (the node included) are drawn. A node without parts counts as visible.</summary>
    public PartVisibility VisibilityOf(int node) => Visibility(Tree?.PartsUnder(node) ?? []);

    /// <summary>Whether the whole model's parts are drawn: the list item's eye.</summary>
    public PartVisibility Visibility() => Visibility(Tree?.Parts ?? []);

    /// <summary>A part that is selected, or a node with parts that are all selected.</summary>
    public bool IsSelected(int node)
    {
        var parts = Tree?.PartsUnder(node) ?? [];
        return parts.Count > 0 && parts.All(Selected.Contains);
    }

    private PartVisibility Visibility(IReadOnlyList<int> parts)
    {
        if (Hidden.IsEmpty)
        {
            return PartVisibility.Visible;
        }

        var hidden = parts.Count(Hidden.Contains);
        return hidden == 0 ? PartVisibility.Visible : hidden == parts.Count ? PartVisibility.Hidden : PartVisibility.Mixed;
    }
}
