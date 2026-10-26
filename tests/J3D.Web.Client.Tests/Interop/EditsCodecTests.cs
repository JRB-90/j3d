using System.Collections.Immutable;
using System.Runtime.InteropServices;
using J3D.Web.Client.Interop;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Tests.Interop;

/// <summary>
/// M16 (D199): a model's edits packed for the viewer. The example is edits-codec.test.ts's, which the
/// viewer reads back, so the two sides agree on the layout.
/// </summary>
public sealed class EditsCodecTests
{
    [Fact]
    public void Edits_pack_as_numbers_and_one_string_of_names()
    {
        var edits = new ModelEdits(
            [3, -1],
            ImmutableDictionary<int, ImmutableList<int>>.Empty.Add(0, [5, 2]),
            ImmutableDictionary<int, string>.Empty.Add(5, "Bracket set"),
            ImmutableDictionary<int, ExpandedNode>.Empty.Add(6, new ExpandedNode(1, 0, "Bolt é", Part: true)));

        var (numbers, text) = EditsCodec.Encode(edits);

        Assert.Equal([1, 2, 3, -1, 1, 0, 2, 5, 2, 1, 5, 11, 1, 6, 1, 0, 1, 6], MemoryMarshal.Cast<byte, int>(numbers).ToArray());
        Assert.Equal("Bracket setBolt é", text);
    }

    [Fact]
    public void Packed_edits_read_back_as_they_were()
    {
        // The viewer sends a restored model's kept edits this way (D204).
        var edits = new ModelEdits(
            [3, -1, -1],
            ImmutableDictionary<int, ImmutableList<int>>.Empty.Add(0, [5, 2]).Add(5, [6]),
            ImmutableDictionary<int, string>.Empty.Add(5, "Bracket set"),
            ImmutableDictionary<int, ExpandedNode>.Empty.Add(6, new ExpandedNode(1, 0, "Bolt é", Part: true)));
        var (numbers, text) = EditsCodec.Encode(edits);

        var again = ModelEdits.From(EditsCodec.Decode(numbers, text));

        Assert.Equal(edits.Added, again.Added);
        Assert.Equal(edits.Children.OrderBy(static c => c.Key).Select(static c => (c.Key, string.Join(',', c.Value))), again.Children.OrderBy(static c => c.Key).Select(static c => (c.Key, string.Join(',', c.Value))));
        Assert.Equal("Bracket set", again.Names[5]);
        Assert.Equal(edits.Pieces[6], again.Pieces[6]);
        Assert.Throws<FormatException>(() => EditsCodec.Decode(numbers[..8], text));
    }

    [Fact]
    public void A_tree_packed_by_the_viewer_reads_as_its_columns()
    {
        // model-events.test.ts's example: two nodes, the second an expandable part.
        int[] values = [1, 2, -1, 0, -1, 3, 3, 0, 1, 1];
        var tree = TreeCodec.Decode(MemoryMarshal.AsBytes(values.AsSpan()).ToArray(), "set");
        Assert.Equal(["set", ""], tree.Names);
        Assert.Equal([-1, 0], tree.Parents);
        Assert.Equal([-1, 3], tree.Prototypes);
        Assert.Equal([1], tree.Expandable!);
        Assert.Null(TreeCodec.Decode(TreeCodec.Encode(tree with { Expandable = null }).Numbers, "set").Expandable);
    }

    [Fact]
    public void Child_lists_names_and_pieces_go_in_node_order()
    {
        var edits = ModelEdits.None with
        {
            Children = ImmutableDictionary<int, ImmutableList<int>>.Empty.Add(9, [1]).Add(-1, [0]).Add(4, []),
            Names = ImmutableDictionary<int, string>.Empty.Add(8, "b").Add(2, "a"),
        };

        var (numbers, text) = EditsCodec.Encode(edits);

        Assert.Equal([1, 0, 3, -1, 1, 0, 4, 0, 9, 1, 1, 2, 2, 1, 8, 1, 0], MemoryMarshal.Cast<byte, int>(numbers).ToArray());
        Assert.Equal("ab", text);
    }
}
