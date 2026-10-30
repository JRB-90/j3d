using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

public sealed class SceneStateTests
{
    private readonly SceneState _scene = new();
    private int _changes;

    public SceneStateTests() => _scene.Changed += () => _changes++;

    [Fact]
    public void Lists_models_in_import_order_and_ignores_a_repeated_id()
    {
        _scene.Add(Summary("m1", "a.step"));
        _scene.Add(Summary("m2", "b.stl", ModelFormat.Stl));
        _scene.Add(Summary("m1", "a.step"));

        Assert.Equal(["a.step", "b.stl"], _scene.Models.Select(static m => m.Summary.FileName));
        Assert.All(_scene.Models, static m => Assert.Equal(ModelStatus.Queued, m.Status));
        Assert.Equal(2, _changes);
    }

    [Fact]
    public void Progress_makes_a_model_importing_with_its_phase_and_fraction()
    {
        _scene.Add(Summary("m1"));

        _scene.ReportProgress(new ModelId("m1"), ImportPhase.Meshing, 0.42);

        var model = Assert.Single(_scene.Models);
        Assert.Equal((ModelStatus.Importing, ImportPhase.Meshing, 0.42), (model.Status, model.Phase, model.Fraction));
        Assert.True(model.IsPending);

        _scene.ReportProgress(new ModelId("m1"), ImportPhase.Parsing, null);
        Assert.Equal((ImportPhase.Parsing, (double?)null), (_scene.Models[0].Phase, _scene.Models[0].Fraction));
        Assert.Equal(3, _changes);
    }

    [Fact]
    public void Loading_keeps_the_info_and_ends_the_progress()
    {
        _scene.Add(Summary("m1"));
        _scene.ReportProgress(new ModelId("m1"), ImportPhase.Extracting, 0.9);
        var info = Info();

        _scene.MarkLoaded(new ModelId("m1"), info);

        var model = Assert.Single(_scene.Models);
        Assert.Equal(ModelStatus.Loaded, model.Status);
        Assert.Same(info, model.Info);
        Assert.Null(model.Phase);
        Assert.Null(model.Fraction);
        Assert.False(model.IsPending);
    }

    [Fact]
    public void Failing_keeps_the_error_and_ends_the_progress()
    {
        _scene.Add(Summary("m1"));
        _scene.ReportProgress(new ModelId("m1"), ImportPhase.Parsing, null);

        _scene.MarkFailed(new ModelId("m1"), ParseFailed);

        var model = Assert.Single(_scene.Models);
        Assert.Equal((ModelStatus.Failed, ParseFailed), (model.Status, model.Error));
        Assert.Null(model.Phase);
    }

    [Fact]
    public void A_late_progress_report_does_not_undo_the_outcome()
    {
        _scene.Add(Summary("m1"));
        _scene.MarkLoaded(new ModelId("m1"), Info());
        var changes = _changes;

        _scene.ReportProgress(new ModelId("m1"), ImportPhase.Extracting, 1);

        Assert.Equal(ModelStatus.Loaded, _scene.Models[0].Status);
        Assert.Equal(changes, _changes);
    }

    [Fact]
    public void Reports_for_a_model_the_list_no_longer_has_are_ignored()
    {
        var unknown = new ModelId("gone");

        _scene.ReportProgress(unknown, ImportPhase.Reading, 0.5);
        _scene.MarkLoaded(unknown, Info());
        _scene.MarkFailed(unknown, ParseFailed);
        _scene.Remove(unknown);

        Assert.Empty(_scene.Models);
        Assert.Equal(0, _changes);
    }

    [Fact]
    public void Removes_one_model_and_keeps_the_order_of_the_rest()
    {
        _scene.Add(Summary("m1", "a.step"));
        _scene.Add(Summary("m2", "b.step"));
        _scene.Add(Summary("m3", "c.step"));

        _scene.Remove(new ModelId("m2"));

        Assert.Equal(["a.step", "c.step"], _scene.Models.Select(static m => m.Summary.FileName));
        Assert.Null(_scene.Find(new ModelId("m2")));
        Assert.NotNull(_scene.Find(new ModelId("m3")));
    }

    [Fact]
    public void Clear_forgets_every_model_and_says_so_only_if_there_were_any()
    {
        _scene.Clear();
        Assert.Equal(0, _changes);

        _scene.Add(Summary("m1"));
        _scene.Add(Summary("m2"));
        _scene.Clear();

        Assert.Empty(_scene.Models);
        Assert.Equal(3, _changes);
    }
}
