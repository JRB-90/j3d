using J3D.Web.Client.Interop;

namespace J3D.Web.Client.State;

/// <summary>
/// A model's flat tree indexed for lazy expansion (decision D53): its roots, and each node's
/// children in file order. A node whose parent isn't an earlier node is treated as a root.
/// Since M6 it also answers which <em>parts</em> (nodes that draw something) lie under a node,
/// which selection and visibility work with (D77, D78).
/// </summary>
public sealed class ModelTree
{
    private readonly TreeColumns _nodes;
    private readonly List<int>?[] _children;
    private readonly List<int> _roots = [];
    private readonly List<int> _parts = [];
    private readonly IReadOnlyList<int>?[] _partsUnder;

    public ModelTree(TreeColumns nodes)
    {
        _nodes = nodes;
        _children = new List<int>?[nodes.Count];
        _partsUnder = new IReadOnlyList<int>?[nodes.Count];
        for (var index = 0; index < nodes.Count; index++)
        {
            var parent = nodes.Parents[index];
            if (parent >= 0 && parent < index)
            {
                (_children[parent] ??= []).Add(index);
            }
            else
            {
                _roots.Add(index);
            }

            if (nodes.Prototypes[index] >= 0)
            {
                _parts.Add(index);
            }
        }
    }

    public int Count => _nodes.Count;

    public IReadOnlyList<int> Roots => _roots;

    /// <summary>Every part node, in tree order.</summary>
    public IReadOnlyList<int> Parts => _parts;

    public TreeNode this[int index] => _nodes[index];

    public IReadOnlyList<int> ChildrenOf(int index) => _children[index] ?? (IReadOnlyList<int>)[];

    public bool HasChildren(int index) => _children[index] is not null;

    public bool Contains(int index) => index >= 0 && index < Count;

    public bool IsPart(int index) => Contains(index) && _nodes.Prototypes[index] >= 0;

    /// <summary>The node's parent, or -1 for a root.</summary>
    public int ParentOf(int index)
    {
        var parent = _nodes.Parents[index];
        return parent >= 0 && parent < index ? parent : -1;
    }

    /// <summary>The node's ancestors, from its root down to its parent.</summary>
    public IReadOnlyList<int> AncestorsOf(int index)
    {
        var ancestors = new List<int>();
        for (var parent = ParentOf(index); parent >= 0; parent = ParentOf(parent))
        {
            ancestors.Add(parent);
        }

        ancestors.Reverse();
        return ancestors;
    }

    /// <summary>The parts in a node's subtree, the node itself included; worked out once per node.</summary>
    public IReadOnlyList<int> PartsUnder(int index)
    {
        if (_partsUnder[index] is { } cached)
        {
            return cached;
        }

        var parts = new List<int>();
        var pending = new Stack<int>();
        pending.Push(index);
        while (pending.TryPop(out var node))
        {
            if (_nodes.Prototypes[node] >= 0)
            {
                parts.Add(node);
            }

            var children = ChildrenOf(node);
            for (var i = children.Count - 1; i >= 0; i--)
            {
                pending.Push(children[i]);
            }
        }

        return _partsUnder[index] = parts;
    }
}
