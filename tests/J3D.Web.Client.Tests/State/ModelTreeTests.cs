using J3D.Web.Client.Interop;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Tests.State;

public sealed class ModelTreeTests
{
    [Fact]
    public void Indexes_roots_and_children_in_file_order()
    {
        var tree = new ModelTree(TestModels.Info().Tree);

        Assert.Equal(5, tree.Count);
        Assert.Equal([0], tree.Roots);
        Assert.Equal([1, 2], tree.ChildrenOf(0));
        Assert.Equal([3, 4], tree.ChildrenOf(2));
        Assert.True(tree.HasChildren(2));
        Assert.False(tree.HasChildren(3));
        Assert.Empty(tree.ChildrenOf(3));
        Assert.Equal("Plate (top)", tree[3].Name);
    }

    [Fact]
    public void Treats_a_node_whose_parent_is_not_an_earlier_node_as_a_root()
    {
        // Parents always come first; anything else would make a cycle or point nowhere.
        var tree = new ModelTree(TreeColumns.From(
        [
            new TreeNode("a", Parent: -1, Prototype: 0),
            new TreeNode("b", Parent: 2, Prototype: 0),
            new TreeNode("c", Parent: 1, Prototype: 0),
            new TreeNode("d", Parent: 99, Prototype: 0),
        ]));

        Assert.Equal([0, 1, 3], tree.Roots);
        Assert.Equal([2], tree.ChildrenOf(1));
    }

    [Fact]
    public void An_empty_tree_has_no_roots() => Assert.Empty(new ModelTree(TreeColumns.From([])).Roots);
}
