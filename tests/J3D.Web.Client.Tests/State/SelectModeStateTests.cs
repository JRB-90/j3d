using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// Selection modes and the context menu in <see cref="SceneState"/> (M12, decisions D146, D162, D164).
/// Models "a" and "b" are the bracket of <see cref="TestModels.Info"/>: parts 1, 3 and 4, with 3 and 4
/// under the "Top" sub-assembly (node 2).
/// </summary>
public sealed class SelectModeStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    private readonly SceneState _scene = new();
    private readonly List<ContextMenuTarget> _menus = [];
    private int _featureClears;

    public SelectModeStateTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }

        _scene.ContextMenuRequested += _menus.Add;
        _scene.ClearFeaturesRequested += () => _featureClears++;
    }

    [Fact]
    public void Model_mode_selects_a_whole_model_with_its_visible_parts()
    {
        _scene.ToggleNodeVisibility(A, 4);
        _scene.SetSelectionMode(SelectMode.Models);

        _scene.Pick(A, 3, additive: false);
        Assert.Equal([1, 3], Selected(A)); // part 4 is hidden
        Assert.True(SceneState.IsModelSelected(_scene.Find(A)!));

        _scene.Pick(B, 1, additive: true);
        Assert.Equal([1, 3, 4], Selected(B));
        _scene.Pick(B, 4, additive: true); // Ctrl again removes the whole model
        Assert.Empty(Selected(B));

        _scene.SelectNode(B, 2, additive: false); // a tree node selects its model too
        Assert.Equal([1, 3, 4], Selected(B));
        Assert.Empty(Selected(A));
    }

    [Fact]
    public void Switching_modes_converts_or_clears_the_selection()
    {
        _scene.Pick(A, 3, additive: false);

        _scene.SetSelectionMode(SelectMode.Models);
        Assert.Equal([1, 3, 4], Selected(A)); // the part's model, whole
        Assert.Empty(Selected(B));

        _scene.SetSelectionMode(SelectMode.Objects);
        Assert.Equal([1, 3, 4], Selected(A)); // its parts stay selected

        _scene.SetSelectionMode(SelectMode.Features);
        Assert.False(_scene.HasSelection);
        _scene.SetFeatures(Features("f1"));
        Assert.Equal(["f1"], _scene.Features.Features.Select(static f => f.Id));

        _scene.SetSelectionMode(SelectMode.Objects);
        Assert.True(_scene.Features.IsEmpty);
        _scene.SetFeatures(Features("f2")); // a late report outside Feature mode is dropped
        Assert.True(_scene.Features.IsEmpty);
    }

    [Fact]
    public void Clearing_in_feature_mode_asks_the_viewer_to_drop_its_features()
    {
        _scene.SetSelectionMode(SelectMode.Features);
        _scene.ClearSelection();
        Assert.Equal(0, _featureClears); // nothing to drop

        _scene.SetFeatures(Features("f1"));
        _scene.Escape();
        Assert.Equal(1, _featureClears);
        Assert.True(_scene.Features.IsEmpty);
    }

    [Fact]
    public void A_tree_click_in_feature_mode_switches_to_objects()
    {
        _scene.SetSelectionMode(SelectMode.Features);
        _scene.SelectNode(A, 2, additive: false);

        Assert.Equal(SelectMode.Objects, _scene.Mode);
        Assert.Equal([3, 4], Selected(A));
    }

    [Fact]
    public void A_right_click_selects_its_target_unless_it_is_selected_then_opens_the_menu()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.Pick(A, 3, additive: true);

        _scene.OpenContextMenu(A, 3, 10, 20, canMeasure: true); // already selected: both stay
        Assert.Equal([1, 3], Selected(A));
        _scene.OpenContextMenu(B, 4, 30, 40, canMeasure: false); // not selected: it becomes the selection
        Assert.Empty(Selected(A));
        Assert.Equal([4], Selected(B));
        _scene.OpenContextMenu(null, -1, 50, 60, canMeasure: false); // empty space keeps the selection
        Assert.Equal([4], Selected(B));

        Assert.Equal(
            [new ContextMenuTarget(10, 20, true, true), new ContextMenuTarget(30, 40, true, false), new ContextMenuTarget(50, 60, false, false)],
            _menus);
    }

    [Fact]
    public void A_right_click_in_model_or_feature_mode_and_on_a_tree_node()
    {
        _scene.SetSelectionMode(SelectMode.Models);
        _scene.OpenContextMenu(A, 3, 0, 0, canMeasure: true);
        Assert.Equal([1, 3, 4], Selected(A));

        _scene.SetSelectionMode(SelectMode.Objects);
        _scene.OpenNodeContextMenu(B, 2, 0, 0);
        Assert.Equal([3, 4], Selected(B));
        Assert.Empty(Selected(A));

        _scene.SetSelectionMode(SelectMode.Features);
        _scene.OpenContextMenu(A, 3, 0, 0, canMeasure: true); // the viewer selects the feature; no part commands
        Assert.False(_scene.HasSelection);

        Assert.Equal([true, true, false], _menus.Select(static menu => menu.OnTarget));
    }

    private List<int> Selected(ModelId id) => [.. _scene.Find(id)!.Selected.Order()];

    private static FeatureSelection Features(params string[] ids) => new(
        [.. ids.Select(static id => new MeasureInfo(id, $"Face of {id}", "1.000 mm²", [new MeasureRow("Area", "1.000 mm²")], [new MeasurePart(A.Value, 1)], Approximate: false))],
        []);
}
