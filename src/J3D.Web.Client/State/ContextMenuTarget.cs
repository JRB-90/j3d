namespace J3D.Web.Client.State;

/// <summary>
/// Where the context menu opens (M12, D164), in client coordinates, and what for: a part or a tree node
/// (now selected), which has commands of its own, or empty space, which has the scene's; and whether
/// there's an entity under the pointer to measure from.
/// </summary>
public sealed record ContextMenuTarget(double X, double Y, bool OnTarget, bool CanMeasure);
