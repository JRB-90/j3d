namespace J3D.Blazor.Tests;

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

    [Fact]
    public void Applies_edits_as_the_viewer_does_copies_after_the_file_and_removed_nodes_out_of_the_model()
    {
        // The bracket: Bracket (0) › Plate (bottom) (1), Top (2) › Plate (top) (3), unnamed (4). Copy Top
        // (5, with 6 and 7) beside it, and take Plate (bottom) out.
        var tree = new ModelTree(TestModels.Info().Tree, ModelEdits.From(new ModelEditsDto(
            [2, 3, 4],
            [new ChildList(0, [2, 5]), new ChildList(5, [6, 7])],
            [new NodeName(5, "Top copy")])));

        Assert.Equal(8, tree.Count);
        Assert.Equal(5, tree.FileCount);
        Assert.Equal([2, 5], tree.ChildrenOf(0));
        Assert.Equal([3, 4, 6, 7], tree.Parts);
        Assert.False(tree.Contains(1));
        Assert.Equal(["Top copy", "Plate (top)", ""], [tree.NameOf(5), tree.NameOf(6), tree.NameOf(7)]);
        Assert.Equal([2, 3], [tree.SourceOf(5), tree.SourceOf(6)]);
        Assert.Equal(new TreeNode("Plate (top)", Parent: 5, Prototype: 0), tree[6]);
        Assert.True(tree.IsAssembly(5));
        Assert.True(tree.IsWithin(7, 5));
        Assert.Equal([0, 5], tree.AncestorsOf(7));
    }

    [Fact]
    public void Edits_build_a_new_tree_and_an_emptied_assembly_goes_with_its_last_child()
    {
        var tree = new ModelTree(TestModels.Info().Tree);

        var moved = tree.Edit().Move([3], ModelTree.TopLevel).Build();
        Assert.Equal([0, 3], moved.Roots);
        Assert.True(moved.Contains(2)); // Top still holds node 4

        var emptied = moved.Edit().Remove([4]).Build();
        Assert.False(emptied.Contains(2));
        Assert.Equal([1], emptied.ChildrenOf(0));

        var edit = tree.Edit();
        var group = edit.Group([1, 3], "Assembly 1");
        var grouped = edit.Build();
        Assert.Equal(5, group);
        Assert.Equal([5, 2], grouped.ChildrenOf(0)); // in the first object's place, in their common ancestor (D185)
        Assert.Equal([1, 3], grouped.ChildrenOf(5));
        Assert.Equal("Assembly 1", grouped.NameOf(5));
        Assert.Equal("Assembly 2", grouped.NextAssemblyName());

        var ungrouped = grouped.Edit().Ungroup([5]).Build();
        Assert.Equal([1, 3, 2], ungrouped.ChildrenOf(0));
        Assert.False(ungrouped.Contains(5));
    }

    [Fact]
    public void A_copy_goes_after_its_original_and_keeps_a_rename()
    {
        var renamed = new ModelTree(TestModels.Info().Tree).Edit().Rename(1, "Base").Build();
        var edit = renamed.Edit();

        var copies = edit.Copy([(1, 0)], parent: null);
        var copied = edit.Build();

        Assert.Equal([5], copies);
        Assert.Equal([1, 5, 2], copied.ChildrenOf(0));
        Assert.Equal("Base", copied.NameOf(5));
        Assert.Equal("Plate (bottom)", copied.Edit().Rename(1, "Plate (bottom)").Build().NameOf(1));
        Assert.DoesNotContain(1, copied.Edit().Rename(1, "Plate (bottom)").Build().Edits.Names.Keys); // back to the file's name
    }

    [Fact]
    public void The_objects_of_a_selection_are_the_topmost_nodes_it_covers()
    {
        var tree = new ModelTree(TestModels.Info().Tree);

        Assert.Equal([2], tree.CoveredBy(PartSet.From([3, 4]), PartSet.Empty));
        Assert.Equal([3], tree.CoveredBy(PartSet.From([3]), PartSet.Empty));
        Assert.Equal([0], tree.CoveredBy(PartSet.From([1, 3, 4]), PartSet.Empty));
        // A hidden part goes with the assembly whose visible parts are all selected (assumption 17).
        Assert.Equal([2], tree.CoveredBy(PartSet.From([3]), PartSet.From([4])));
        Assert.Equal([0], tree.CoveredBy(PartSet.From([1, 3]), PartSet.From([4])));
    }
}
