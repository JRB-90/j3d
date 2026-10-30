using System.Collections;
using System.Runtime.CompilerServices;

namespace J3D.Blazor;

/// <summary>
/// An immutable set of part nodes: a model's hidden or selected parts (decisions D78, D95). Every
/// change makes a new set. It wraps a <see cref="HashSet{T}"/> rather than using
/// <c>ImmutableHashSet</c>: under the interpreted WebAssembly runtime, building an immutable hash set
/// of 10,437 parts took most of a 230 ms task, which a hash set builds in a fraction of that (M6).
/// </summary>
[CollectionBuilder(typeof(PartSet), nameof(Create))]
public sealed class PartSet : IReadOnlySet<int>
{
    private readonly HashSet<int> _nodes;

    private PartSet(HashSet<int> nodes) => _nodes = nodes;

    public static PartSet Empty { get; } = new([]);

    public int Count => _nodes.Count;

    public bool IsEmpty => _nodes.Count == 0;

    public static PartSet Create(ReadOnlySpan<int> nodes) => nodes.IsEmpty ? Empty : new([.. nodes]);

    public static PartSet From(IEnumerable<int> nodes) => nodes as PartSet ?? Wrap([.. nodes]);

    public bool Contains(int item) => _nodes.Contains(item);

    public PartSet Add(int node) => Contains(node) ? this : Wrap([.. _nodes, node]);

    public PartSet Remove(int node) => Contains(node) ? Where(other => other != node) : this;

    public PartSet Union(IEnumerable<int> nodes)
    {
        var union = new HashSet<int>(_nodes);
        union.UnionWith(nodes);
        return union.Count == Count ? this : Wrap(union);
    }

    public PartSet Except(IEnumerable<int> nodes)
    {
        var rest = new HashSet<int>(_nodes);
        rest.ExceptWith(nodes);
        return rest.Count == Count ? this : Wrap(rest);
    }

    public PartSet Where(Func<int, bool> keep)
    {
        var kept = new HashSet<int>(_nodes.Count);
        foreach (var node in _nodes)
        {
            if (keep(node))
            {
                kept.Add(node);
            }
        }

        return kept.Count == Count ? this : Wrap(kept);
    }

    public bool SetEquals(IEnumerable<int> other) => ReferenceEquals(this, other) || _nodes.SetEquals(other);

    public bool IsProperSubsetOf(IEnumerable<int> other) => _nodes.IsProperSubsetOf(other);

    public bool IsProperSupersetOf(IEnumerable<int> other) => _nodes.IsProperSupersetOf(other);

    public bool IsSubsetOf(IEnumerable<int> other) => _nodes.IsSubsetOf(other);

    public bool IsSupersetOf(IEnumerable<int> other) => _nodes.IsSupersetOf(other);

    public bool Overlaps(IEnumerable<int> other) => _nodes.Overlaps(other);

    public IEnumerator<int> GetEnumerator() => _nodes.GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    // Takes ownership of the hash set; a collection expression would copy it.
#pragma warning disable IDE0028
    private static PartSet Wrap(HashSet<int> nodes) => nodes.Count == 0 ? Empty : new(nodes);
#pragma warning restore IDE0028
}
