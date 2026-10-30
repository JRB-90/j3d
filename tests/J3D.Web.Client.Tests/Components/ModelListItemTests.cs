using J3D.Web.Client.Components;
using J3D.Blazor;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

public sealed class ModelListItemTests : BunitTestBase
{
    private readonly List<ModelEntry> _removed = [];

    [Fact]
    public void A_queued_model_shows_its_name_format_and_kind_and_can_be_cancelled()
    {
        var cut = RenderItem(Queued(fileName: "gearbox-assembly.step"));

        Assert.Equal("gearbox-assembly.step", Text(cut, "model-name"));
        Assert.Equal("gearbox-assembly.step", cut.Find("[data-testid=model-name]").GetAttribute("title"));
        Assert.Equal("STEP", Text(cut, "model-format"));
        Assert.Equal("BREP", Text(cut, "model-kind"));
        Assert.Equal("Queued", Text(cut, "model-status"));
        Assert.Equal("queued", cut.Find("[data-testid=model-item]").GetAttribute("data-status"));
        Assert.NotNull(cut.Find("[data-testid=cancel-model]"));
        Assert.Empty(cut.FindAll("[data-testid=delete-model]"));
    }

    [Fact]
    public void Shows_the_kind_only_when_the_format_doesnt_already_say_it()
    {
        Assert.Empty(RenderItem(Queued(fileName: "box.brep", format: ModelFormat.Brep)).FindAll("[data-testid=model-kind]"));
        Assert.Equal("mesh", Text(RenderItem(Queued(fileName: "part.glb", format: ModelFormat.Gltf)), "model-kind"));
    }

    [Fact]
    public void An_import_shows_its_phase_with_a_bar_for_that_phase()
    {
        var cut = RenderItem(Importing(ImportPhase.Meshing, 0.427));

        Assert.Equal("Meshing · 42%", Text(cut, "model-status"));
        Assert.DoesNotContain("mud-progress-indeterminate", cut.Find("[data-testid=model-progress]").ClassName, StringComparison.Ordinal);
        Assert.NotNull(cut.Find("[data-testid=cancel-model]"));
    }

    [Fact]
    public void A_restore_applying_its_edits_says_so() // M16, D203
    {
        Assert.Equal("Applying your edits · 50%", Text(RenderItem(Importing(ImportPhase.Applying, 0.5)), "model-status"));
        Assert.Equal("Applying your edits…", Text(RenderItem(Importing(ImportPhase.Applying, null)), "model-status"));
    }

    [Fact]
    public void A_phase_that_cant_measure_itself_has_an_indeterminate_bar()
    {
        var cut = RenderItem(Importing(ImportPhase.Parsing, null));

        Assert.Equal("Parsing…", Text(cut, "model-status"));
        Assert.Contains("mud-progress-indeterminate", cut.Find("[data-testid=model-progress]").ClassName, StringComparison.Ordinal);
    }

    [Fact]
    public void A_loaded_model_shows_memory_triangles_and_parts_and_can_be_deleted()
    {
        var cut = RenderItem(Loaded());

        Assert.Equal("64 MB in memory · 1.2M triangles · 3 parts", Text(cut, "model-status"));
        Assert.NotNull(cut.Find("[data-testid=delete-model]"));
        Assert.Empty(cut.FindAll("[data-testid=model-progress]"));
        Assert.Empty(cut.FindAll("[data-testid=model-warnings]"));
    }

    [Fact]
    public void Load_warnings_show_as_an_icon_that_names_them()
    {
        var cut = RenderItem(Loaded(warnings: ["Texture \"checker.png\" wasn't supplied."]));

        Assert.Contains("checker.png", cut.Find("[data-testid=model-warnings]").GetAttribute("aria-label"), StringComparison.Ordinal);
    }

    [Fact]
    public void A_model_that_could_not_be_kept_says_why()
    {
        Assert.Empty(RenderItem(Loaded()).FindAll("[data-testid=model-not-kept]"));

        var cut = RenderItem(Loaded().AsNotKept("storage full"));

        Assert.Equal("Not kept: storage full", Text(cut, "model-not-kept"));
    }

    [Fact]
    public void A_failed_model_shows_its_error_and_can_be_dismissed()
    {
        var cut = RenderItem(Failed());

        Assert.Equal("Parse failed: Not a readable STEP file.", Text(cut, "model-status"));
        Assert.NotNull(cut.Find("[data-testid=dismiss-model]"));
        Assert.Empty(cut.FindAll("[data-testid=model-tree-toggle]"));
    }

    [Theory]
    [InlineData(ModelStatus.Queued, "cancel-model")]
    [InlineData(ModelStatus.Loaded, "delete-model")]
    [InlineData(ModelStatus.Failed, "dismiss-model")]
    public void The_action_asks_the_list_to_remove_the_model(ModelStatus status, string button)
    {
        var model = status switch
        {
            ModelStatus.Queued => Queued(),
            ModelStatus.Loaded => Loaded(),
            _ => Failed(),
        };
        var cut = RenderItem(model);

        cut.Find($"[data-testid={button}]").Click();

        Assert.Same(model, Assert.Single(_removed));
    }

    [Fact]
    public void The_tree_is_collapsed_until_asked_for_and_loads_a_level_at_a_time()
    {
        var cut = RenderItem(Loaded());
        Assert.Empty(cut.FindAll("[data-testid=model-tree]"));
        Assert.Equal("Assembly", Text(cut, "model-tree-toggle"));

        cut.Find("[data-testid=model-tree-toggle]").Click();
        Assert.Equal(["Bracket"], NodeTexts(cut));
        Assert.Equal("tree", cut.Find("[data-testid=model-tree]").GetAttribute("role"));

        ExpandNode(cut, "Bracket");
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Top"], NodeTexts(cut)));

        ExpandNode(cut, "Top");
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Top", "Plate (top)", "(unnamed)"], NodeTexts(cut)));
        Assert.All(cut.FindAll("[data-testid=model-tree-node]"), static row => Assert.Equal("false", row.GetAttribute("aria-selected")));

        // An ARIA tree (D202): levels, positions, open rows, and parents for the tests and the drag.
        var plate = Row(cut, "Plate (top)");
        Assert.Equal(("treeitem", "3", "1", "2", null), (plate.GetAttribute("role"), plate.GetAttribute("aria-level"), plate.GetAttribute("aria-posinset"), plate.GetAttribute("aria-setsize"), plate.GetAttribute("aria-expanded")));
        Assert.Equal(("2", "0 2"), (plate.GetAttribute("data-tree-parent"), plate.GetAttribute("data-tree-ancestors")));
        Assert.Equal("true", Row(cut, "Top").GetAttribute("aria-expanded"));
        Assert.Equal(["0", "-1", "-1", "-1", "-1"], cut.FindAll("[data-testid=model-tree-node]").Select(static row => row.GetAttribute("tabindex")));

        cut.Find("[data-testid=model-tree-toggle]").Click();
        Assert.Empty(cut.FindAll("[data-testid=model-tree]"));
    }

    [Fact]
    public void A_wide_level_shows_all_its_nodes_without_pages()
    {
        // 250 top-level nodes: a group of 150 parts, then 249 loose parts. M16 (D198): the tree is
        // virtualised, so D60's "Show more" pages are gone, and only a window of rows is drawn.
        List<TreeNode> tree = [new("Group", Parent: -1, Prototype: -1)];
        tree.AddRange(Enumerable.Range(1, 150).Select(static i => new TreeNode($"Inner {i}", Parent: 0, Prototype: 0)));
        tree.AddRange(Enumerable.Range(1, 249).Select(static i => new TreeNode($"Loose {i}", Parent: -1, Prototype: 0)));
        var cut = RenderItem(Queued().AsLoaded(Info() with { Tree = TreeColumns.From(tree) }));

        cut.Find("[data-testid=model-tree-toggle]").Click();
        Assert.Empty(cut.FindAll("[data-testid=model-tree-more]"));
        Assert.InRange(NodeCount(cut), 1, 249);
        Assert.Equal("250", Row(cut, "Group").GetAttribute("aria-setsize"));

        ExpandNode(cut, "Group");
        cut.WaitForAssertion(() => Assert.Equal(["Group", "Inner 1"], NodeTexts(cut)[..2]));
        Assert.Equal(("150", "2"), (Row(cut, "Inner 1").GetAttribute("aria-setsize"), Row(cut, "Inner 1").GetAttribute("aria-level")));
    }

    [Fact]
    public void A_mesh_model_shows_its_hierarchy() =>
        Assert.Equal("Hierarchy", Text(RenderItem(Loaded(fileName: "part.glb", format: ModelFormat.Gltf)), "model-tree-toggle"));

    private IRenderedComponent<ModelListItem> RenderItem(ModelEntry model) =>
        Render<ModelListItem>(parameters => parameters
            .Add(item => item.Model, model)
            .Add(item => item.OnRemove, _removed.Add));

    private static string Text(IRenderedComponent<ModelListItem> cut, string testId) =>
        cut.Find($"[data-testid={testId}]").TextContent.Trim();

    private static List<string> NodeTexts(IRenderedComponent<ModelListItem> cut) =>
        [.. cut.FindAll("[data-testid=model-tree-node] .j3d-tree-node-name").Select(static node => node.TextContent.Trim())];

    private static int NodeCount(IRenderedComponent<ModelListItem> cut) => cut.FindAll("[data-testid=model-tree-node]").Count;

    private static AngleSharp.Dom.IElement Row(IRenderedComponent<ModelListItem> cut, string text) =>
        cut.FindAll("[data-testid=model-tree-node]").Single(row => row.QuerySelector(".j3d-tree-node-name")?.TextContent.Trim() == text);

    /// <summary>Clicking a row selects it (M6), so expanding takes its arrow.</summary>
    private static void ExpandNode(IRenderedComponent<ModelListItem> cut, string text) =>
        Row(cut, text).QuerySelector("[data-testid=tree-node-toggle]")!.Click();
}
