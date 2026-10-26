namespace J3D.Web.Client.Interop;

/// <summary>A model's edits to its tree as they cross interop (M14; src/J3D.Viewer/src/edit/structure.ts's <c>ModelEdits</c>).</summary>
/// <param name="Added">Each added node's source, or -1 for a new assembly.</param>
/// <param name="Children">Child lists that differ from the file's.</param>
/// <param name="Names">Names given since the import.</param>
/// <param name="Pieces">The added nodes Expand made (M15); absent from edits kept before M15.</param>
public sealed record ModelEditsDto(IReadOnlyList<int> Added, IReadOnlyList<ChildList> Children, IReadOnlyList<NodeName> Names, IReadOnlyList<ExpandedNodeDto>? Pieces = null);

/// <summary>An added node Expand made (M15): see <see cref="State.ExpandedNode"/>.</summary>
public sealed record ExpandedNodeDto(int Node, int Expands, int Piece, string Name, bool Part);

/// <summary>A node's children, in order; parent -1 is the model's top level.</summary>
public sealed record ChildList(int Parent, IReadOnlyList<int> Nodes);

/// <summary>A node's name, given since the import.</summary>
public sealed record NodeName(int Node, string Name);
