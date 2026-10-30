using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

/// <summary>
/// The Measure tool's state in <see cref="SceneState"/> (M12, decisions D79, D147, D164): a reference
/// and a live result, neither kept nor undoable, cleared by Esc with the tool. Model "a" is the
/// bracket of <see cref="TestModels.Info"/> (parts 1, 3 and 4).
/// </summary>
public sealed class MeasureStateTests
{
    private static readonly ModelId A = new("a");

    private readonly SceneState _scene = new();

    public MeasureStateTests()
    {
        _scene.Add(Summary(A.Value, "a.step"));
        _scene.MarkLoaded(A, Info());
    }

    [Fact]
    public void The_tool_holds_a_reference_and_a_result_which_go_when_it_turns_off()
    {
        _scene.SetMeasureReference(Measure("reference", "Face (plane) of Plate (top)"));
        Assert.Null(_scene.MeasureReference); // not while the tool is off

        _scene.ToggleMeasureMode();
        _scene.SetMeasureReference(Measure("reference", "Face (plane) of Plate (top)"));
        _scene.SetMeasureResult(Measure("result", "Distance 30.000 mm"));
        _scene.SetMeasureResult(Measure("result", "Distance 35.000 mm")); // the next click replaces it
        Assert.Equal("Face (plane) of Plate (top)", _scene.MeasureReference?.Title);
        Assert.Equal("Distance 35.000 mm", _scene.MeasureResult?.Title);
        Assert.False(_scene.CanUndo); // measurements aren't steps any more

        _scene.ToggleMeasureMode();
        Assert.False(_scene.MeasureMode);
        Assert.Null(_scene.MeasureReference);
        Assert.Null(_scene.MeasureResult);
    }

    [Fact]
    public void Esc_turns_the_tool_off_and_otherwise_clears_the_selection()
    {
        _scene.Pick(A, 1, additive: false);
        _scene.ToggleMeasureMode();
        _scene.SetMeasureReference(Measure("reference", "Vertex of Pin"));

        _scene.Escape();
        Assert.False(_scene.MeasureMode);
        Assert.Null(_scene.MeasureReference);
        Assert.True(_scene.HasSelection); // the first Esc only ends the measurement

        _scene.Escape();
        Assert.False(_scene.HasSelection);
    }

    [Fact]
    public void Measure_from_here_starts_the_tool_again_and_asks_the_viewport_once()
    {
        _scene.ToggleMeasureMode();
        _scene.SetMeasureReference(Measure("reference", "Vertex of Pin"));

        _scene.MeasureFromHere();
        Assert.True(_scene.MeasureMode);
        Assert.Null(_scene.MeasureReference);
        Assert.True(_scene.TakeMeasureFromContext());
        Assert.False(_scene.TakeMeasureFromContext());
    }

    private static MeasureInfo Measure(string id, string title) => new(
        id,
        title,
        "30.000 mm",
        [new MeasureRow("Distance", "30.000 mm")],
        [new MeasurePart(A.Value, 1)],
        Approximate: false);
}
