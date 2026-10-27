using System.Collections.Immutable;
using System.Globalization;

namespace J3D.Web.Client.State;

/// <summary>
/// One edit of a <see cref="ModelTree"/> (M14): nodes moved, copied, grouped, ungrouped, removed,
/// renamed, since M15 expanded and since M18 brought in from another model, building the model's next
/// <see cref="ModelEdits"/>. Only the child lists it touches are copied. An assembly a move or removal
/// leaves with nothing in it goes too (D181); empty assemblies the file has stay.
/// </summary>
public sealed class TreeEdit
{
    private readonly ModelTree _tree;
    private readonly List<int> _added;
    private readonly Dictionary<int, List<int>> _lists = [];
    private readonly Dictionary<int, int> _parents = [];
    private readonly HashSet<int> _emptied = [];
    private ImmutableDictionary<int, string> _names;
    private ImmutableDictionary<int, ExpandedNode> _pieces;
    private ImmutableList<KeptArrival> _arrivals;
    private ImmutableDictionary<int, ArrivedNode> _arrived;

    internal TreeEdit(ModelTree tree)
    {
        _tree = tree;
        _added = [.. tree.Edits.Added];
        _names = tree.Edits.Names;
        _pieces = tree.Edits.Pieces;
        _arrivals = tree.Edits.Arrivals;
        _arrived = tree.Edits.Arrived;
    }

    private int Count => _tree.FileCount + _added.Count;

    /// <summary>
    /// Moves nodes into <paramref name="parent"/> (or the top level), after its children or just after
    /// <paramref name="after"/>, in order; a node there already stays where it is. In 3D they stay put:
    /// the viewer works their placements out again (D151).
    /// </summary>
    public TreeEdit Move(IEnumerable<int> nodes, int parent, int? after = null)
    {
        var previous = after;
        foreach (var node in nodes)
        {
            if (ParentOf(node) != parent)
            {
                Detach(node);
                Insert(parent, node, previous);
                previous = node;
            }
        }

        return this;
    }

    /// <summary>
    /// Copies nodes with everything under them, each into <paramref name="parent"/>, after its children
    /// or just after <paramref name="after"/> (D180: beside a selected part), or when the parent is null
    /// beside its original (just after it, or under the parent it had when it was copied, after the rest).
    /// Copies keep their originals' names (D186). Returns the copies' ids.
    /// </summary>
    public IReadOnlyList<int> Copy(IEnumerable<(int Node, int Parent)> items, int? parent, int? after = null)
    {
        var copies = new List<int>();
        var previous = after;
        foreach (var (node, originalParent) in items)
        {
            var copy = CopySubtree(node);
            Insert(parent ?? originalParent, copy, parent is null ? node : previous);
            previous = copy;
            copies.Add(copy);
        }

        return copies;
    }

    /// <summary>
    /// Groups nodes under a new assembly at their parent's origin (D184), in the shared parent or the
    /// nearest common ancestor, in the first node's place (D185). Returns the new assembly's id.
    /// </summary>
    public int Group(IReadOnlyList<int> nodes, string name)
    {
        var parent = CommonParent(nodes);
        var list = ListOf(parent);
        var first = nodes[0];
        var place = list.FindIndex(child => _tree.IsWithin(first, child));
        var group = Count;
        _added.Add(-1);
        _names = _names.SetItem(group, name);
        list.Insert(place < 0 ? list.Count : place, group);
        _parents[group] = parent;
        _lists[group] = [];
        Move(nodes, group);
        return group;
    }

    /// <summary>Removes assemblies, putting their children in their places in their parents.</summary>
    public TreeEdit Ungroup(IEnumerable<int> assemblies)
    {
        foreach (var assembly in assemblies)
        {
            var parent = ParentOf(assembly);
            var list = ListOf(parent);
            var place = list.IndexOf(assembly);
            List<int> children = [.. ListOf(assembly)];
            list.RemoveAt(place);
            list.InsertRange(place, children);
            ListOf(assembly).Clear();
            foreach (var child in children)
            {
                _parents[child] = parent;
            }

            _parents[assembly] = Removed;
        }

        return this;
    }

    /// <summary>Removes nodes from the model, with everything under them.</summary>
    public TreeEdit Remove(IEnumerable<int> nodes)
    {
        foreach (var node in nodes)
        {
            Detach(node);
            _parents[node] = Removed;
        }

        return this;
    }

    /// <summary>
    /// Expand (M15, D154, D189–D191): a compound part gives way to a new assembly in its place, named as
    /// the part is now, holding the part's pieces as its expansion has them (each after its piece parent,
    /// -1 being the assembly). A piece the file doesn't name is named after its parent and its place among
    /// its siblings: "Bracket set 1", "Bracket set 2", or "Part 1" under a part with no name. Returns the
    /// assembly's id.
    /// </summary>
    public int Expand(int part, IReadOnlyList<Interop.ExpansionPiece> pieces)
    {
        var parent = ParentOf(part);
        var list = ListOf(parent);
        var assembly = Count;
        var name = _tree.NameOf(part);
        _added.Add(-1);
        _pieces = _pieces.SetItem(assembly, new ExpandedNode(part, -1, name, Part: false));
        list[list.IndexOf(part)] = assembly;
        _parents[assembly] = parent;
        _parents[part] = Removed;
        _lists[assembly] = [];

        var ids = new int[pieces.Count];
        var names = new string[pieces.Count];
        var siblings = new Dictionary<int, int>();
        for (var index = 0; index < pieces.Count; index++)
        {
            var piece = pieces[index];
            var owner = piece.Parent >= 0 && piece.Parent < index ? piece.Parent : -1;
            var place = siblings[owner] = siblings.GetValueOrDefault(owner) + 1;
            var parentName = owner < 0 ? name : names[owner];
            names[index] = piece.Name.Length > 0 ? piece.Name : $"{(parentName.Length > 0 ? parentName : "Part")} {place.ToString(CultureInfo.InvariantCulture)}";
            var id = ids[index] = Count;
            _added.Add(-1);
            _pieces = _pieces.SetItem(id, new ExpandedNode(part, index, names[index], piece.Part));
            var ownerId = owner < 0 ? assembly : ids[owner];
            _lists[ownerId].Add(id);
            _parents[id] = ownerId;
            if (!piece.Part)
            {
                _lists[id] = [];
            }
        }

        return assembly;
    }

    /// <summary>
    /// Objects arriving from another model (M18, D225, D227): a new arrival, after the model's others, whose
    /// nodes (each after its arrival parent, 0 being the arrival's own assembly, which isn't added) come in
    /// as added nodes: the objects themselves into <paramref name="parent"/>, after its children or just
    /// after <paramref name="after"/>, in order, and the rest under them. Returns each node's id, the
    /// arrival's node <c>i</c> at <c>i - 1</c>.
    /// </summary>
    public IReadOnlyList<int> Arrive(string file, IReadOnlyList<Interop.TransferNode> nodes, int parent, int? after = null)
    {
        var arrival = _arrivals.Count;
        _arrivals = _arrivals.Add(new KeptArrival(file, nodes.Count + 1));
        var ids = new int[nodes.Count];
        var previous = after;
        for (var i = 0; i < nodes.Count; i++)
        {
            var node = nodes[i];
            var id = ids[i] = Count;
            _added.Add(-1);
            _arrived = _arrived.SetItem(id, new ArrivedNode(arrival, i + 1, node.Name, node.Part, node.Expandable));
            if (!node.Part)
            {
                _lists[id] = [];
            }

            if (node.Parent >= 1 && node.Parent <= i)
            {
                var owner = ids[node.Parent - 1];
                _lists[owner].Add(id);
                _parents[id] = owner;
            }
            else
            {
                Insert(parent, id, previous);
                previous = id;
            }
        }

        return ids;
    }

    public TreeEdit Rename(int node, string name)
    {
        _names = node < _tree.Count && name == _tree.DefaultNameOf(node) ? _names.Remove(node) : _names.SetItem(node, name);
        return this;
    }

    /// <summary>The tree as edited: assemblies left empty go first (D181).</summary>
    public ModelTree Build()
    {
        foreach (var assembly in _emptied.ToList())
        {
            RemoveIfEmpty(assembly);
        }

        var children = _tree.Edits.Children;
        foreach (var (parent, list) in _lists)
        {
            // Lists only read, or as the file has them, add nothing.
            var unchanged = list.SequenceEqual(parent < _tree.Count ? _tree.ChildrenOf(parent) : []);
            if (!unchanged || children.ContainsKey(parent))
            {
                children = children.SetItem(parent, [.. list]);
            }
        }

        return new ModelTree(_tree.File, new ModelEdits([.. _added], children, _names, _pieces) { Arrivals = _arrivals, Arrived = _arrived });
    }

    private const int Removed = -2;

    private int ParentOf(int node) =>
        _parents.TryGetValue(node, out var parent) ? parent : node < _tree.Count && _tree.Contains(node) ? _tree.ParentOf(node) : Removed;

    /// <summary>Puts a node in a parent's list just after <paramref name="after"/>, or last when that isn't there.</summary>
    private void Insert(int parent, int node, int? after)
    {
        var list = ListOf(parent);
        var place = after is { } sibling ? list.IndexOf(sibling) : -1;
        list.Insert(place >= 0 ? place + 1 : list.Count, node);
        _parents[node] = parent;
    }

    private List<int> ListOf(int parent)
    {
        if (!_lists.TryGetValue(parent, out var list))
        {
            list = parent < _tree.Count ? [.. _tree.ChildrenOf(parent)] : [];
            _lists[parent] = list;
        }

        return list;
    }

    /// <summary>Takes a node out of its parent's list; an assembly that loses its last child is noted.</summary>
    private void Detach(int node)
    {
        var parent = ParentOf(node);
        if (parent == Removed)
        {
            return;
        }

        ListOf(parent).Remove(node);
        if (parent >= 0)
        {
            _emptied.Add(parent);
        }
    }

    private void RemoveIfEmpty(int assembly)
    {
        if (ParentOf(assembly) == Removed || ListOf(assembly).Count > 0 || (assembly < _tree.Count ? _tree.PrototypeOf(assembly) : -1) >= 0)
        {
            return;
        }

        var parent = ParentOf(assembly);
        ListOf(parent).Remove(assembly);
        _parents[assembly] = Removed;
        if (parent >= 0)
        {
            RemoveIfEmpty(parent);
        }
    }

    /// <summary>Adds a copy of a node and of everything under it, in order; returns the copy's id.</summary>
    private int CopySubtree(int source)
    {
        var copy = Count;
        _added.Add(source);
        var name = _tree.NameOf(source);
        if (name != _tree.DefaultNameOf(source))
        {
            _names = _names.SetItem(copy, name); // a renamed original's copy keeps the name it has now
        }

        List<int> children = [];
        foreach (var child in ListOf(source).ToList())
        {
            var childCopy = CopySubtree(child);
            _parents[childCopy] = copy;
            children.Add(childCopy);
        }

        _lists[copy] = children;
        return copy;
    }

    /// <summary>The nodes' shared parent, or their nearest common ancestor; never a part (D185).</summary>
    private int CommonParent(IReadOnlyList<int> nodes)
    {
        var common = _tree.AncestorsOf(nodes[0]).ToList();
        foreach (var node in nodes.Skip(1))
        {
            var ancestors = _tree.AncestorsOf(node);
            var shared = 0;
            while (shared < common.Count && shared < ancestors.Count && common[shared] == ancestors[shared])
            {
                shared++;
            }

            common.RemoveRange(shared, common.Count - shared);
        }

        while (common.Count > 0 && _tree.IsPart(common[^1]))
        {
            common.RemoveAt(common.Count - 1);
        }

        return common.Count > 0 ? common[^1] : ModelTree.TopLevel;
    }
}
