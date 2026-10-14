using J3D.Web.Client.Interop;

namespace J3D.Web.Client.State;

/// <summary>
/// A model's flat tree indexed for lazy expansion (decision D53): its roots, and each node's
/// children in file order. A node whose parent isn't an earlier node is treated as a root.
/// </summary>
public sealed class ModelTree
{
    private readonly TreeColumns _nodes;
    private readonly List<int>?[] _children;
    private readonly List<int> _roots = [];

    public ModelTree(TreeColumns nodes)
    {
        _nodes = nodes;
        _children = new List<int>?[nodes.Count];
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
        }
    }

    public int Count => _nodes.Count;

    public IReadOnlyList<int> Roots => _roots;

    public TreeNode this[int index] => _nodes[index];

    public IReadOnlyList<int> ChildrenOf(int index) => _children[index] ?? (IReadOnlyList<int>)[];

    public bool HasChildren(int index) => _children[index] is not null;
}
