using System.Collections.Immutable;
using J3D.Web.Client.Interop;

namespace J3D.Web.Client.State;

/// <summary>
/// A model's edits to its tree (M14, D151, D152, D180–D187), as the viewer applies them and the store
/// keeps them (mirrors src/J3D.Viewer/src/edit/structure.ts). Node ids from the file's node count up
/// are added nodes, in the order they were added. A changed child list replaces the file's; a node in
/// no list is removed, with everything under it. Placements aren't here: moves keep them (M13).
/// </summary>
/// <param name="Added">Each added node's source: the node it copies (an earlier one), or -1 for a new assembly or an expanded part's node.</param>
/// <param name="Children">Child lists that differ from the file's, by parent; <see cref="ModelTree.TopLevel"/> is the model's top level.</param>
/// <param name="Names">Names given by Rename and New assembly, and copies of renamed nodes.</param>
/// <param name="Pieces">The added nodes Expand made (M15, D154), by node.</param>
public sealed record ModelEdits(
    ImmutableList<int> Added,
    ImmutableDictionary<int, ImmutableList<int>> Children,
    ImmutableDictionary<int, string> Names,
    ImmutableDictionary<int, ExpandedNode> Pieces)
{
    public static ModelEdits None { get; } = new([], [], [], []);

    public bool IsEmpty => Added.IsEmpty && Children.IsEmpty && Names.IsEmpty && Pieces.IsEmpty;

    /// <summary>The edits as they cross interop, child lists in parent order so the same edits always read the same.</summary>
    public ModelEditsDto ToDto() => new(
        Added,
        [.. Children.OrderBy(static item => item.Key).Select(static item => new ChildList(item.Key, item.Value))],
        [.. Names.OrderBy(static item => item.Key).Select(static item => new NodeName(item.Key, item.Value))],
        [.. Pieces.OrderBy(static item => item.Key).Select(static item => new ExpandedNodeDto(item.Key, item.Value.Expands, item.Value.Piece, item.Value.Name, item.Value.Part))]);

    public static ModelEdits From(ModelEditsDto? dto) => dto is null
        ? None
        : new(
            [.. dto.Added],
            dto.Children.ToImmutableDictionary(static list => list.Parent, static list => list.Nodes.ToImmutableList()),
            dto.Names.ToImmutableDictionary(static name => name.Node, static name => name.Name),
            (dto.Pieces ?? []).ToImmutableDictionary(static piece => piece.Node, static piece => new ExpandedNode(piece.Expands, piece.Piece, piece.Name, piece.Part)));
}

/// <summary>
/// An added node that Expand made (M15, D154, D189): the assembly that takes a compound part's place
/// (<paramref name="Piece"/> -1), or one of the part's pieces.
/// </summary>
/// <param name="Expands">The part it expands, which leaves the tree as the assembly takes its place.</param>
/// <param name="Piece">Its piece in the part's expansion, or -1 for the assembly.</param>
/// <param name="Name">Its name before any rename: the file's, or numbered after its parent (D191).</param>
/// <param name="Part">It draws something.</param>
public sealed record ExpandedNode(int Expands, int Piece, string Name, bool Part);
