namespace J3D.Web.Client.Interop;

/// <summary>
/// What .NET is told about a loaded model (src/J3D.Viewer/src/model-events.ts). The geometry stays
/// in the viewer.
/// </summary>
/// <param name="Tree">The model's tree, flat, with every parent before its children.</param>
/// <param name="Stats">What the model draws.</param>
/// <param name="Bounds">Where the model is.</param>
/// <param name="MemoryBytes">The worker's WASM heap (BREP) or geometry and texture bytes (mesh).</param>
/// <param name="Warnings">Non-fatal problems, such as textures that weren't supplied.</param>
public sealed record ModelLoadedInfo(
    IReadOnlyList<TreeNode> Tree,
    ModelStats Stats,
    Bounds Bounds,
    long MemoryBytes,
    IReadOnlyList<string> Warnings);

/// <summary>One node of a model's tree.</summary>
/// <param name="Name">The node's name in the file; may be empty.</param>
/// <param name="Parent">The parent node's index, or -1 for a root.</param>
/// <param name="Prototype">The prototype a part node draws, or -1 for a group or assembly.</param>
public sealed record TreeNode(string Name, int Parent, int Prototype)
{
    public bool IsPart => Prototype >= 0;
}

/// <summary>What a loaded model draws.</summary>
/// <param name="Nodes">Nodes in the model's tree.</param>
/// <param name="Prototypes">Unique meshes (BREP: unique part and style).</param>
/// <param name="Instances">Placements of those meshes: the parts in the scene.</param>
/// <param name="Triangles">Triangles drawn, counting every instance.</param>
/// <param name="Edges">BREP edge segments drawn, counting every instance; 0 for mesh models.</param>
/// <param name="Textures">Textures referenced by the model's materials.</param>
public sealed record ModelStats(int Nodes, int Prototypes, int Instances, long Triangles, long Edges, int Textures);

/// <summary>Axis-aligned bounds in world (Z-up) coordinates, as [x, y, z].</summary>
public sealed record Bounds(IReadOnlyList<double> Min, IReadOnlyList<double> Max);
