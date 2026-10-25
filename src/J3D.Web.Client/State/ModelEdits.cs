using System.Collections.Immutable;
using J3D.Web.Client.Interop;

namespace J3D.Web.Client.State;

/// <summary>
/// A model's edits to its tree (M14, D151, D152, D180–D187), as the viewer applies them and the store
/// keeps them (mirrors src/J3D.Viewer/src/edit/structure.ts). Node ids from the file's node count up
/// are added nodes, in the order they were added. A changed child list replaces the file's; a node in
/// no list is removed, with everything under it. Placements aren't here: moves keep them (M13).
/// </summary>
/// <param name="Added">Each added node's source: the node it copies (an earlier one), or -1 for a new assembly.</param>
/// <param name="Children">Child lists that differ from the file's, by parent; <see cref="ModelTree.TopLevel"/> is the model's top level.</param>
/// <param name="Names">Names given by Rename and New assembly, and copies of renamed nodes.</param>
public sealed record ModelEdits(
    ImmutableList<int> Added,
    ImmutableDictionary<int, ImmutableList<int>> Children,
    ImmutableDictionary<int, string> Names)
{
    public static ModelEdits None { get; } = new([], [], []);

    public bool IsEmpty => Added.IsEmpty && Children.IsEmpty && Names.IsEmpty;

    /// <summary>The edits as they cross interop, child lists in parent order so the same edits always read the same.</summary>
    public ModelEditsDto ToDto() => new(
        Added,
        [.. Children.OrderBy(static item => item.Key).Select(static item => new ChildList(item.Key, item.Value))],
        [.. Names.OrderBy(static item => item.Key).Select(static item => new NodeName(item.Key, item.Value))]);

    public static ModelEdits From(ModelEditsDto? dto) => dto is null
        ? None
        : new(
            [.. dto.Added],
            dto.Children.ToImmutableDictionary(static list => list.Parent, static list => list.Nodes.ToImmutableList()),
            dto.Names.ToImmutableDictionary(static name => name.Node, static name => name.Name));
}
