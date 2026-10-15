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
/// One model in the list. Transitions are pure: each returns the entry it leads to, or this entry
/// when it doesn't apply (docs/plan.md §6.4).
/// </summary>
public sealed record ModelEntry(ModelSummary Summary)
{
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

    public ModelId Id => Summary.Id;

    /// <summary>Queued or importing: removing it cancels the import.</summary>
    public bool IsPending => Status is ModelStatus.Queued or ModelStatus.Importing;

    /// <summary>Progress applies only while the import is pending, so a late report can't undo its outcome.</summary>
    public ModelEntry WithProgress(ImportPhase phase, double? fraction) =>
        IsPending ? this with { Status = ModelStatus.Importing, Phase = phase, Fraction = fraction } : this;

    public ModelEntry AsLoaded(ModelLoadedInfo info) =>
        this with { Status = ModelStatus.Loaded, Phase = null, Fraction = null, Info = info, Error = null, Tree = new ModelTree(info.Tree) };

    public ModelEntry AsFailed(ImportError error) =>
        this with { Status = ModelStatus.Failed, Phase = null, Fraction = null, Info = null, Error = error, Tree = null };

    /// <summary>
    /// New hidden and selected parts, keeping only part nodes of this tree, and dropping hidden parts
    /// from the selection (D98). Only a loaded model has parts; the same sets return this entry.
    /// </summary>
    public ModelEntry WithParts(IEnumerable<int> hidden, IEnumerable<int> selected)
    {
        if (Tree is not { } tree)
        {
            return this;
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
