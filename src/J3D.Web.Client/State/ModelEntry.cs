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
        new(deleted.Summary) { Hidden = deleted.Hidden, NotKept = deleted.NotKept, IsRestored = true };

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

    /// <summary>Loaded, keeping only those hidden parts (set while it was restored) that are parts of its tree.</summary>
    public ModelEntry AsLoaded(ModelLoadedInfo info)
    {
        var tree = new ModelTree(info.Tree);
        return this with
        {
            Status = ModelStatus.Loaded,
            Phase = null,
            Fraction = null,
            Info = info,
            Error = null,
            Tree = tree,
            Hidden = Hidden.IsEmpty ? Hidden : Hidden.Where(tree.IsPart),
        };
    }

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
