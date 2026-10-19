using J3D.Web.Client.Models;

namespace J3D.Web.Client.Interop;

/// <summary>One object to move or draw a frame at: a tree node, or a whole model as node -1 (<c>MoveTarget</c> in src/J3D.Viewer/src/view/move.ts).</summary>
public sealed record MoveTargetRef(ModelId Id, int Node);

/// <summary>
/// The Move tool's target and where it is (M13, D148; mirrors <c>MoveTargetInfo</c> in
/// src/J3D.Viewer/src/view/viewer.ts): its placement in its parent's frame and that frame's placement
/// in the world, column-major, and the model's millimetres per unit (D105). Node -1 is a whole model.
/// </summary>
public sealed record MoveTargetInfo(ModelId Id, int Node, IReadOnlyList<double> Local, IReadOnlyList<double> ParentWorld, double UnitScale)
{
    public Matrix4d LocalMatrix => new(Local);

    public Matrix4d ParentWorldMatrix => new(ParentWorld);
}
