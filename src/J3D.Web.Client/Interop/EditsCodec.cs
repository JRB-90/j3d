using System.Runtime.InteropServices;
using System.Text;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Interop;

/// <summary>
/// A model's edits packed for the viewer (M16, D199), in the layout src/J3D.Viewer/src/edit/edits-codec.ts
/// reads: the numbers as one buffer of 32-bit integers, which Blazor passes as bytes without JSON, and
/// the names as one string. .NET sends all of a model's edits with each one (§6.4), and as JSON the large
/// plant's after Expand all took 160 ms to serialise under the WebAssembly interpreter, every edit.
/// Child lists, names and pieces go in node order, so the same edits always pack the same.
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

        return (MemoryMarshal.AsBytes(CollectionsMarshal.AsSpan(numbers)).ToArray(), text.ToString());
    }

    private static int[] Sorted(IEnumerable<int> keys)
    {
        int[] sorted = [.. keys];
        Array.Sort(sorted);
        return sorted;
    }
}
