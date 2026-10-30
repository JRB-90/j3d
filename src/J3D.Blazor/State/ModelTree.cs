using System.Globalization;
using System.Text.RegularExpressions;

namespace J3D.Blazor;

/// <summary>
/// A model's tree indexed for lazy expansion (decision D53): its roots, and each node's children in
/// order. A node whose parent isn't an earlier node is treated as a root. Since M6 it also answers
/// which <em>parts</em> (nodes that draw something) lie under a node, which selection and visibility
/// work with (D77, D78). Since M14 it's the file's tree with the model's <see cref="ModelEdits"/>
/// applied, as the viewer applies them (src/J3D.Viewer/src/edit/structure.ts): copies and new
/// assemblies get ids after the file's nodes, and only nodes reachable from the top level are in the
/// model. It never changes; an edit makes a new tree from new edits (see <see cref="Edit"/>).
/// </summary>
public sealed partial class ModelTree
{
    /// <summary>The model's top level, as a parent.</summary>
    public const int TopLevel = -1;

    /// <summary>The prototype of a piece Expand made, or a node that arrived, that draws something (M15, M18): the viewer knows its real one.</summary>
    internal const int ExpandedPart = int.MaxValue;

    private readonly TreeColumns _file;
    private readonly int[] _parents;
    private readonly int[] _prototypes;
    private readonly int[] _sources;
    private readonly int[] _fileNodes;
    private readonly string[] _addedNames;
    private readonly HashSet<int> _expandable;
    private readonly Dictionary<int, IReadOnlyList<int>> _children = [];
    private readonly bool[] _live;
    private readonly List<int> _parts = [];
    private readonly IReadOnlyList<int>?[] _partsUnder;

    internal ModelTree(TreeColumns nodes, ModelEdits? edits = null)
    {
        _file = nodes;
        Edits = edits ?? ModelEdits.None;
        var fileCount = nodes.Count;
        var count = fileCount + Edits.Added.Count;
        _parents = new int[count];
        _prototypes = new int[count];
        _sources = new int[count];
        _fileNodes = new int[count];
        _addedNames = new string[count - fileCount];
        _expandable = [.. nodes.Expandable ?? []];
        _live = new bool[count];
        _partsUnder = new IReadOnlyList<int>?[count];

        var lists = new Dictionary<int, List<int>>();
        for (var index = 0; index < fileCount; index++)
        {
            var parent = nodes.Parents[index];
            parent = parent >= 0 && parent < index ? parent : TopLevel;
            _parents[index] = parent;
            _prototypes[index] = nodes.Prototypes[index];
            _sources[index] = -1;
            _fileNodes[index] = index;
            (lists.TryGetValue(parent, out var list) ? list : lists[parent] = []).Add(index);
        }

        for (var offset = 0; offset < Edits.Added.Count; offset++)
        {
            var node = fileCount + offset;
            var source = Edits.Added[offset];
            _sources[node] = source;
            _parents[node] = TopLevel;
            if (Edits.Pieces.TryGetValue(node, out var piece))
            {
                // Expand's assembly and pieces (M15) draw nothing of the file's, and are named as Expand named them.
                _fileNodes[node] = -1;
                _prototypes[node] = piece.Part ? ExpandedPart : -1;
                _addedNames[offset] = piece.Name;
            }
            else if (Edits.Arrived.TryGetValue(node, out var arrived))
            {
                // A node that arrived (M18) is numbered after the file's nodes and earlier arrivals', as the
                // viewer's facade numbers it, so Expand can name it as it names a file part.
                _fileNodes[node] = Edits.ArrivalBase(fileCount, arrived.Arrival) + arrived.Index;
                _prototypes[node] = arrived.Part ? ExpandedPart : -1;
                _addedNames[offset] = arrived.Name;
                if (arrived.Expandable)
                {
                    _expandable.Add(_fileNodes[node]);
                }
            }
            else
            {
                _fileNodes[node] = source >= 0 ? _fileNodes[source] : -1;
                _prototypes[node] = source >= 0 ? _prototypes[source] : -1;
                _addedNames[offset] = source >= 0 ? DefaultNameOf(source) : "Assembly";
            }
        }

        foreach (var (parent, list) in lists)
        {
            _children[parent] = list;
        }

        foreach (var (parent, list) in Edits.Children)
        {
            _children[parent] = list;
        }

        foreach (var (parent, list) in _children)
        {
            foreach (var child in list)
            {
                _parents[child] = parent;
            }
        }

        // The live nodes, each before its children: the parts in tree order.
        var pending = new Stack<int>();
        PushChildren(pending, TopLevel);
        while (pending.TryPop(out var node))
        {
            _live[node] = true;
            if (_prototypes[node] >= 0)
            {
                _parts.Add(node);
            }

            PushChildren(pending, node);
        }
    }

    /// <summary>The edits this tree applies to the file's.</summary>
    internal ModelEdits Edits { get; }

    /// <summary>The tree as the file gives it.</summary>
    internal TreeColumns File => _file;

    /// <summary>The nodes the file gives; added nodes' ids follow them.</summary>
    public int FileCount => _file.Count;

    /// <summary>Every node id, the file's and the added ones, in the model or not.</summary>
    public int Count => _parents.Length;

    public IReadOnlyList<int> Roots => ChildrenOf(TopLevel);

    /// <summary>Every part node in the model, in tree order.</summary>
    public IReadOnlyList<int> Parts => _parts;

    public TreeNode this[int index] => new(NameOf(index), _parents[index], _prototypes[index]);

    /// <summary>A node's name: as given since the import, else as the file names it (or the node it copies).</summary>
    public string NameOf(int index) => Edits.Names.TryGetValue(index, out var name) ? name : DefaultNameOf(index);

    /// <summary>The node an added node copies, or -1 for the file's nodes and new assemblies.</summary>
    public int SourceOf(int index) => _sources[index];

    /// <summary>A node's children in order (<see cref="TopLevel"/>: the top-level nodes).</summary>
    public IReadOnlyList<int> ChildrenOf(int index) => _children.TryGetValue(index, out var children) ? children : [];

    public bool HasChildren(int index) => ChildrenOf(index).Count > 0;

    /// <summary>The node is in the model: one of its ids, and reachable from its top level.</summary>
    public bool Contains(int index) => index >= 0 && index < Count && _live[index];

    public bool IsPart(int index) => Contains(index) && _prototypes[index] >= 0;

    /// <summary>A node in the model that draws nothing itself: an assembly, or a mesh model's group, which can hold others (D182).</summary>
    public bool IsAssembly(int index) => Contains(index) && _prototypes[index] < 0;

    /// <summary>The node's parent, or -1 for a top-level node (or a removed one).</summary>
    public int ParentOf(int index) => Contains(index) ? _parents[index] : TopLevel;

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

    /// <summary>Whether <paramref name="node"/> is <paramref name="ancestor"/> or lies under it.</summary>
    public bool IsWithin(int node, int ancestor)
    {
        for (var current = node; current >= 0; current = ParentOf(current))
        {
            if (current == ancestor)
            {
                return true;
            }
        }

        return false;
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
            if (_prototypes[node] >= 0)
            {
                parts.Add(node);
            }

            PushChildren(pending, node);
        }

        return _partsUnder[index] = parts;
    }

    /// <summary>
    /// The objects a selection of parts stands for (assumption 19): the topmost nodes whose visible
    /// parts are all selected, at least one of them; a selected part counts as itself. In tree order.
    /// </summary>
    public IReadOnlyList<int> CoveredBy(IReadOnlySet<int> selected, IReadOnlySet<int> hidden)
    {
        // Each node's visible and selected parts, children before parents.
        var visible = new int[Count];
        var chosen = new int[Count];
        var order = new List<int>(Count);
        var pending = new Stack<int>();
        PushChildren(pending, TopLevel);
        while (pending.TryPop(out var node))
        {
            order.Add(node);
            PushChildren(pending, node);
        }

        for (var position = order.Count - 1; position >= 0; position--)
        {
            var node = order[position];
            if (_prototypes[node] >= 0 && !hidden.Contains(node))
            {
                visible[node]++;
                chosen[node] += selected.Contains(node) ? 1 : 0;
            }

            var parent = _parents[node];
            if (parent >= 0)
            {
                visible[parent] += visible[node];
                chosen[parent] += chosen[node];
            }
        }

        var covered = new List<int>();
        var skipUnder = -1;
        foreach (var node in order)
        {
            if (skipUnder >= 0 && IsWithin(node, skipUnder))
            {
                continue;
            }

            skipUnder = -1;
            var part = _prototypes[node] >= 0 && selected.Contains(node);
            if (part || (visible[node] > 0 && chosen[node] == visible[node]))
            {
                covered.Add(node);
                skipUnder = node;
            }
        }

        return covered;
    }

    /// <summary>"Assembly 1", "Assembly 2" and so on: the next number no node in the model has (D186).</summary>
    public string NextAssemblyName()
    {
        var highest = 0;
        for (var node = 0; node < Count; node++)
        {
            if (_live[node] && AssemblyName().Match(NameOf(node)) is { Success: true } match &&
                int.TryParse(match.Groups[1].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var number))
            {
                highest = Math.Max(highest, number);
            }
        }

        return $"Assembly {(highest + 1).ToString(CultureInfo.InvariantCulture)}";
    }

    /// <summary>Starts an edit of this tree; its result is a new tree.</summary>
    internal TreeEdit Edit() => new(this);

    /// <summary>
    /// A compound part Expand can split (M15, D189, D190): one of the file's, or since M18 one that arrived,
    /// or a copy of either, in the model. Expand's own pieces aren't, since it splits down to solids.
    /// </summary>
    public bool IsExpandable(int index) => IsPart(index) && _fileNodes[index] is var file and >= 0 && _expandable.Contains(file);

    /// <summary>
    /// The file node a node draws as: itself, or the one it copies; for a node that arrived, its number
    /// after the file's (M18); -1 for new assemblies and Expand's nodes.
    /// </summary>
    public int FileNodeOf(int index) => _fileNodes[index];

    /// <summary>The name a node has without a rename: its file node's, a piece's as Expand named it, or "Assembly" for a new assembly.</summary>
    internal string DefaultNameOf(int index) => index < FileCount ? _file.Names[index] : _addedNames[index - FileCount];

    internal int PrototypeOf(int index) => _prototypes[index];

    /// <summary>A node's parent as last known, even for a removed node.</summary>
    internal int LastParentOf(int index) => _parents[index];

    private void PushChildren(Stack<int> pending, int node)
    {
        var children = ChildrenOf(node);
        for (var i = children.Count - 1; i >= 0; i--)
        {
            pending.Push(children[i]);
        }
    }

    [GeneratedRegex(@"^Assembly (\d+)$", RegexOptions.CultureInvariant)]
    private static partial Regex AssemblyName();
}
