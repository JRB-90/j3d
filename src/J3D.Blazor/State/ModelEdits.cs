using System.Collections.Immutable;

namespace J3D.Blazor;

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
internal sealed record ModelEdits(
    ImmutableList<int> Added,
    ImmutableDictionary<int, ImmutableList<int>> Children,
    ImmutableDictionary<int, string> Names,
    ImmutableDictionary<int, ExpandedNode> Pieces)
{
    public static ModelEdits None { get; } = new([], [], [], []);

    /// <summary>Objects moved or copied in from other models (M18, D225, D227), in the order they came.</summary>
    public ImmutableList<KeptArrival> Arrivals { get; init; } = [];

    /// <summary>The added nodes that arrived (M18), by node.</summary>
    public ImmutableDictionary<int, ArrivedNode> Arrived { get; init; } = [];

    public bool IsEmpty => Added.IsEmpty && Children.IsEmpty && Names.IsEmpty && Pieces.IsEmpty && Arrivals.IsEmpty;

    /// <summary>Where arrival <paramref name="arrival"/> starts in the facade's numbering: after the file's nodes and each earlier arrival's (M18).</summary>
    public int ArrivalBase(int fileCount, int arrival) => fileCount + Arrivals.Take(arrival).Sum(static kept => kept.Nodes);

    /// <summary>The edits as they cross interop, child lists in parent order so the same edits always read the same.</summary>
    internal ModelEditsDto ToDto() => new(
        Added,
        [.. Children.OrderBy(static item => item.Key).Select(static item => new ChildList(item.Key, item.Value))],
        [.. Names.OrderBy(static item => item.Key).Select(static item => new NodeName(item.Key, item.Value))],
        [.. Pieces.OrderBy(static item => item.Key).Select(static item => new ExpandedNodeDto(item.Key, item.Value.Expands, item.Value.Piece, item.Value.Name, item.Value.Part))],
        [.. Arrivals.Select(static kept => new KeptArrivalDto(kept.File, kept.Nodes))],
        [.. Arrived.OrderBy(static item => item.Key).Select(static item => new ArrivedNodeDto(item.Key, item.Value.Arrival, item.Value.Index, item.Value.Name, item.Value.Part, item.Value.Expandable))]);

    internal static ModelEdits From(ModelEditsDto? dto) => dto is null
        ? None
        : new(
            [.. dto.Added],
            dto.Children.ToImmutableDictionary(static list => list.Parent, static list => list.Nodes.ToImmutableList()),
            dto.Names.ToImmutableDictionary(static name => name.Node, static name => name.Name),
            (dto.Pieces ?? []).ToImmutableDictionary(static piece => piece.Node, static piece => new ExpandedNode(piece.Expands, piece.Piece, piece.Name, piece.Part)))
        {
            Arrivals = [.. (dto.Arrivals ?? []).Select(static kept => new KeptArrival(kept.File, kept.Nodes))],
            Arrived = (dto.Arrived ?? []).ToImmutableDictionary(static node => node.Node, static node => new ArrivedNode(node.Arrival, node.Index, node.Name, node.Part, node.Expandable)),
        };
}

/// <summary>
/// Objects moved or copied in from another model (M18, D225, D227, D230): a file of the model's own, whose
/// nodes, its own assembly first, are numbered after the file's and every earlier arrival's.
/// </summary>
/// <param name="File">Its file in the model's folder.</param>
/// <param name="Nodes">How many nodes it has, its own assembly included.</param>
internal sealed record KeptArrival(string File, int Nodes);

/// <summary>An added node that arrived (M18): node <paramref name="Index"/> of an arrival, never 0, the arrival's own assembly.</summary>
/// <param name="Arrival">Its arrival, by its place in <see cref="ModelEdits.Arrivals"/>.</param>
/// <param name="Index">Its node in the arrival.</param>
/// <param name="Name">Its name when it arrived.</param>
/// <param name="Part">It draws something.</param>
/// <param name="Expandable">A compound part Expand would split (D190).</param>
internal sealed record ArrivedNode(int Arrival, int Index, string Name, bool Part, bool Expandable);

/// <summary>
/// An added node that Expand made (M15, D154, D189): the assembly that takes a compound part's place
/// (<paramref name="Piece"/> -1), or one of the part's pieces.
/// </summary>
/// <param name="Expands">The part it expands, which leaves the tree as the assembly takes its place.</param>
/// <param name="Piece">Its piece in the part's expansion, or -1 for the assembly.</param>
/// <param name="Name">Its name before any rename: the file's, or numbered after its parent (D191).</param>
/// <param name="Part">It draws something.</param>
internal sealed record ExpandedNode(int Expands, int Piece, string Name, bool Part);
