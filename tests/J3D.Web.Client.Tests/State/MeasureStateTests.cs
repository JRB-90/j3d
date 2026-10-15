using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// The Measure tool's state in <see cref="SceneState"/> (M7, decisions D79, D84, D101, D108). Models
/// "a" and "b" are the bracket of <see cref="TestModels.Info"/> (parts 1, 3 and 4).
/// </summary>
public sealed class MeasureStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    private readonly SceneState _scene = new();

    public MeasureStateTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }
    }

    [Fact]
    public void The_tool_toggles_and_turning_it_off_drops_the_pending_pick()
    {
        _scene.SetPendingMeasure(Measure("", (A, 1)));
        Assert.Null(_scene.PendingMeasure); // not while the tool is off

        _scene.ToggleMeasureMode();
        _scene.SetPendingMeasure(Measure("", (A, 1)));
        Assert.True(_scene.MeasureMode);
        Assert.NotNull(_scene.PendingMeasure);

        _scene.ToggleMeasureMode();
        Assert.False(_scene.MeasureMode);
        Assert.Null(_scene.PendingMeasure);
    }

    [Fact]
    public void Kept_measurements_add_remove_and_clear_as_undoable_steps()
    {
        _scene.AddMeasurement(Measure("m1", (A, 1), (A, 3)));
        _scene.AddMeasurement(Measure("m2", (A, 4), (B, 1)));
        _scene.AddMeasurement(Measure("m2", (A, 4), (B, 1))); // the same id again is ignored
        Assert.Equal(["m1", "m2"], Ids());

        _scene.RemoveMeasurement("m1");
        Assert.Equal(["m2"], Ids());
        _scene.ClearMeasurements();
        Assert.Empty(_scene.Measurements);

        _scene.Undo();
        Assert.Equal(["m2"], Ids());
        _scene.Undo();
        Assert.Equal(["m1", "m2"], Ids());
        _scene.Undo();
        _scene.Undo();
        Assert.Empty(_scene.Measurements);
        Assert.False(_scene.CanUndo);

        _scene.Redo();
        Assert.Equal(["m1"], Ids());
    }

    [Fact]
    public void Measurements_follow_their_parts_visibility()
    {
        _scene.AddMeasurement(Measure("m1", (A, 1), (B, 3)));
        Assert.Equal(["m1"], ShownIds());

        _scene.ToggleNodeVisibility(B, 3);
        Assert.Empty(ShownIds());
        Assert.Single(_scene.Measurements); // still listed, greyed

        _scene.Undo();
        Assert.Equal(["m1"], ShownIds());
    }

    [Fact]
    public void Removing_a_model_removes_its_measurements_and_their_steps()
    {
        _scene.ToggleMeasureMode();
        _scene.AddMeasurement(Measure("m1", (A, 1), (B, 3)));
        _scene.AddMeasurement(Measure("m2", (A, 1), (A, 3)));
        _scene.SetPendingMeasure(Measure("", (B, 1)));

        _scene.Remove(B);

        Assert.Equal(["m2"], Ids());
        Assert.Null(_scene.PendingMeasure);
        _scene.Undo(); // adding m2
        Assert.Empty(_scene.Measurements);
        Assert.False(_scene.CanUndo); // adding m1 went with model b
    }

    [Fact]
    public void A_measurement_of_a_model_no_longer_listed_is_not_kept()
    {
        _scene.AddMeasurement(Measure("m1", (new ModelId("gone"), 1)));
        Assert.Empty(_scene.Measurements);
    }

    private static MeasureInfo Measure(string id, params (ModelId Model, int Node)[] parts) => new(
        id,
        $"Distance {id}",
        "30.000 mm",
        [new MeasureRow("Distance", "30.000 mm")],
        [.. parts.Select(static part => new MeasurePart(part.Model.Value, part.Node))],
        Approximate: false);

    private List<string> Ids() => [.. _scene.Measurements.Select(static m => m.Id)];

    private List<string> ShownIds() => [.. _scene.ShownMeasurements.Select(static m => m.Id)];
}
