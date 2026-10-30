using System.Runtime.InteropServices;

namespace J3D.Blazor;

/// <summary>
/// A model's tree packed by the viewer (M16, D204; src/J3D.Viewer/src/model-events.ts's <c>packTree</c>):
/// <c>version, n, parents (n), prototypes (n), name lengths (n), expandable count, expandable...</c> as
/// 32-bit integers, and the names one after another. As JSON columns the large plant's tree, with its
/// kept edits, took 450 ms to read here.
/// </summary>
internal static class TreeCodec
{
    public const int Version = 1;

    public static TreeColumns Decode(byte[] numbers, string text)
    {
        var values = MemoryMarshal.Cast<byte, int>(numbers);
        if (values.Length < 2 || values[0] != Version)
        {
            throw new FormatException("The packed tree is of another version.");
        }

        var count = values[1];
        var parents = values.Slice(2, count).ToArray();
        var prototypes = values.Slice(2 + count, count).ToArray();
        var lengths = values.Slice(2 + (2 * count), count);
        var names = new string[count];
        var at = 0;
        for (var node = 0; node < count; node++)
        {
            names[node] = text.Substring(at, lengths[node]);
            at += lengths[node];
        }

        var expandable = values.Slice(3 + (3 * count), values[2 + (3 * count)]).ToArray();
        return new TreeColumns(names, parents, prototypes, expandable.Length > 0 ? expandable : null);
    }

    /// <summary>The same packing from .NET's side, for tests.</summary>
    public static (byte[] Numbers, string Text) Encode(TreeColumns tree)
    {
        IReadOnlyList<int> expandable = tree.Expandable ?? [];
        List<int> values = [Version, tree.Count, .. tree.Parents, .. tree.Prototypes, .. tree.Names.Select(static name => name.Length), expandable.Count, .. expandable];
        return (MemoryMarshal.AsBytes(CollectionsMarshal.AsSpan(values)).ToArray(), string.Concat(tree.Names));
    }
}
