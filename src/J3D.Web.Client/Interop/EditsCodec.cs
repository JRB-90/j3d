using System.Runtime.InteropServices;
using System.Text;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Interop;

/// <summary>
/// A model's edits packed for the viewer (M16, D199), in the layout src/J3D.Viewer/src/edit/edits-codec.ts
/// reads: the numbers as one buffer of 32-bit integers, which Blazor passes as bytes without JSON, and
/// the names as one string. .NET sends all of a model's edits with each one (§6.4), and as JSON the large
/// plant's after Expand all took 160 ms to serialise under the WebAssembly interpreter, every edit.
/// Child lists, names and pieces go in node order, so the same edits always pack the same. Since M18 the
/// arrivals and the nodes that arrived follow, when there are any.
/// </summary>
internal static class EditsCodec
{
    /// <summary>The first number, so the viewer can tell the layout.</summary>
    public const int Version = 1;

    public static (byte[] Numbers, string Text) Encode(ModelEdits edits)
    {
        List<int> numbers = [Version, edits.Added.Count, .. edits.Added];
        var text = new StringBuilder();
        void AddText(string value)
        {
            numbers.Add(value.Length);
            text.Append(value);
        }

        numbers.Add(edits.Children.Count);
        foreach (var parent in Sorted(edits.Children.Keys))
        {
            var nodes = edits.Children[parent];
            numbers.Add(parent);
            numbers.Add(nodes.Count);
            numbers.AddRange(nodes);
        }

        numbers.Add(edits.Names.Count);
        foreach (var node in Sorted(edits.Names.Keys))
        {
            numbers.Add(node);
            AddText(edits.Names[node]);
        }

        numbers.Add(edits.Pieces.Count);
        foreach (var node in Sorted(edits.Pieces.Keys))
        {
            var piece = edits.Pieces[node];
            numbers.AddRange([node, piece.Expands, piece.Piece, piece.Part ? 1 : 0]);
            AddText(piece.Name);
        }

        if (!edits.Arrivals.IsEmpty || !edits.Arrived.IsEmpty)
        {
            numbers.Add(edits.Arrivals.Count);
            foreach (var kept in edits.Arrivals)
            {
                numbers.Add(kept.Nodes);
                AddText(kept.File);
            }

            numbers.Add(edits.Arrived.Count);
            foreach (var node in Sorted(edits.Arrived.Keys))
            {
                var arrived = edits.Arrived[node];
                numbers.AddRange([node, arrived.Arrival, arrived.Index, arrived.Part ? 1 : 0, arrived.Expandable ? 1 : 0]);
                AddText(arrived.Name);
            }
        }

        return (MemoryMarshal.AsBytes(CollectionsMarshal.AsSpan(numbers)).ToArray(), text.ToString());
    }

    /// <summary>Edits the viewer packed (a restored model's, M16, D204), as they cross interop.</summary>
    public static ModelEditsDto Decode(byte[] numbers, string text)
    {
        var values = MemoryMarshal.Cast<byte, int>(numbers).ToArray();
        var at = 0;
        var textAt = 0;
        int Next() => at < values.Length ? values[at++] : throw new FormatException("The packed edits end early.");
        string NextText()
        {
            var length = Next();
            var value = text.Substring(textAt, length);
            textAt += length;
            return value;
        }

        if (Next() != Version)
        {
            throw new FormatException("The packed edits are of another version.");
        }

        var added = new int[Next()];
        for (var i = 0; i < added.Length; i++)
        {
            added[i] = Next();
        }

        var children = new ChildList[Next()];
        for (var i = 0; i < children.Length; i++)
        {
            var parent = Next();
            var nodes = new int[Next()];
            for (var j = 0; j < nodes.Length; j++)
            {
                nodes[j] = Next();
            }

            children[i] = new ChildList(parent, nodes);
        }

        var names = new NodeName[Next()];
        for (var i = 0; i < names.Length; i++)
        {
            names[i] = new NodeName(Next(), NextText());
        }

        var count = Next();
        ExpandedNodeDto[]? pieces = count < 0 ? null : new ExpandedNodeDto[count];
        for (var i = 0; i < count; i++)
        {
            var (node, expands, piece, part) = (Next(), Next(), Next(), Next());
            pieces![i] = new ExpandedNodeDto(node, expands, piece, NextText(), part != 0);
        }

        if (at >= values.Length)
        {
            return new ModelEditsDto(added, children, names, pieces);
        }

        var arrivals = new KeptArrivalDto[Next()];
        for (var i = 0; i < arrivals.Length; i++)
        {
            var nodes = Next();
            arrivals[i] = new KeptArrivalDto(NextText(), nodes);
        }

        var arrived = new ArrivedNodeDto[Next()];
        for (var i = 0; i < arrived.Length; i++)
        {
            var (node, arrival, index, part, expandable) = (Next(), Next(), Next(), Next(), Next());
            arrived[i] = new ArrivedNodeDto(node, arrival, index, NextText(), part != 0, expandable != 0);
        }

        return new ModelEditsDto(added, children, names, pieces, arrivals, arrived);
    }

    private static int[] Sorted(IEnumerable<int> keys)
    {
        int[] sorted = [.. keys];
        Array.Sort(sorted);
        return sorted;
    }
}
