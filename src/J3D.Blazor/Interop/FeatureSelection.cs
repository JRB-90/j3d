namespace J3D.Blazor;

/// <summary>
/// The faces, edges and vertices selected in Feature mode (M12, D146, D163; mirrors
/// <c>FeatureSelectionInfo</c> in src/J3D.Viewer/src/view/features.ts): each one's values, in the
/// order they were picked, and the totals that add up. The viewer owns the selection, since only it
/// can name an entity, and reports it once each feature's values are known. Since M17 it also sends
/// every selected feature as one string (<paramref name="Keys"/>, empty for none), which an undone
/// selection hands back to select them again, and whether a click made the change (D219).
/// </summary>
public sealed record FeatureSelection(IReadOnlyList<MeasureInfo> Features, IReadOnlyList<MeasureRow> Totals, string Keys = "", bool ByUser = false)
{
    public static readonly FeatureSelection Empty = new([], []);

    public bool IsEmpty => Features.Count == 0;
}
