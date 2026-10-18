namespace J3D.Web.Client.Interop;

/// <summary>
/// The faces, edges and vertices selected in Feature mode (M12, D146, D163; mirrors
/// <c>FeatureSelectionInfo</c> in src/J3D.Viewer/src/view/features.ts): each one's values, in the
/// order they were picked, and the totals that add up. The viewer owns the selection, since only it
/// can name an entity, and reports it once each feature's values are known.
/// </summary>
public sealed record FeatureSelection(IReadOnlyList<MeasureInfo> Features, IReadOnlyList<MeasureRow> Totals)
{
    public static readonly FeatureSelection Empty = new([], []);

    public bool IsEmpty => Features.Count == 0;
}
