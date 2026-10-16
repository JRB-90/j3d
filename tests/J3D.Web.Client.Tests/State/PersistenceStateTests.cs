using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// The scene's part in persistence (M8, decisions D82, D84, D108, D110, D115, D117): models kept from
/// the last visit, deleting as an undoable step, forgetting what no step can bring back, Clear all,
/// and models that couldn't be kept. Models "a", "b" and "c" are the bracket of
/// <see cref="TestModels.Info"/> (parts 1, 3 and 4).
/// </summary>
public sealed class PersistenceStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");
    private static readonly ModelId C = new("c");

    private readonly SceneState _scene = new();
    private readonly List<string> _requests = [];

    public PersistenceStateTests()
    {
        _scene.DeleteRequested += id => _requests.Add($"delete {id}");
        _scene.RestoreRequested += models => _requests.Add($"restore {string.Join(',', models.Select(static model => model.Id))}");
        _scene.ForgetRequested += id => _requests.Add($"forget {id}");
        _scene.ClearAllRequested += () => _requests.Add("clear");
    }

    [Fact]
    public void Kept_models_are_listed_in_order_and_their_hidden_parts_apply_once_loaded()
    {
        _scene.Restore([new StoredModel(Summary("k1", "a.step"), [0, 1, 3, 99]), new StoredModel(Summary("k2", "b.step"), [])]);

        Assert.Equal(["k1", "k2"], ModelIds());
        Assert.All(_scene.Models, static model => Assert.True(model.IsRestored && model.Status == ModelStatus.Queued));
        Assert.Equal(["restore k1,k2"], _requests);
        Assert.False(_scene.CanUndo); // coming back from the last visit isn't a step

        _scene.MarkLoaded(new ModelId("k1"), Info());
        var loaded = _scene.Find(new ModelId("k1"))!;
        Assert.Equal([1, 3], loaded.Hidden.Order()); // only the tree's parts: not its assembly, nor a node it hasn't
        Assert.Equal(PartVisibility.Mixed, loaded.VisibilityOf(2));

        _scene.Restore([new StoredModel(Summary("k1", "a.step"), [])]); // already listed
        Assert.Equal(["k1", "k2"], ModelIds());
        Assert.Single(_requests);
    }

    [Fact]
    public void Deleting_a_model_is_undone_into_its_place_with_its_hidden_parts_and_measurements()
    {
        LoadAll();
        _scene.ToggleNodeVisibility(B, 1);
        _scene.AddMeasurement(Measure("m1", (B, 3), (A, 3)));
        _scene.AddMeasurement(Measure("m2", (A, 1)));
        _scene.ToggleMeasureMode();
        _scene.SetPendingMeasure(Measure("", (B, 4)));

        _scene.Delete(B);
        Assert.Equal(["a", "c"], ModelIds());
        Assert.Equal(["m2"], MeasurementIds());
        Assert.Null(_scene.PendingMeasure);
        Assert.Equal(["delete b"], _requests);

        _scene.Undo();
        Assert.Equal(["a", "b", "c"], ModelIds());
        var restored = _scene.Find(B)!;
        Assert.True(restored.IsRestored);
        Assert.Equal(ModelStatus.Queued, restored.Status);
        Assert.Equal([1], restored.Hidden.Order());
        Assert.Equal(["m2", "m1"], MeasurementIds());
        Assert.DoesNotContain(_scene.ShownMeasurements, static m => m.Id == "m1"); // until it has loaded (D108)
        Assert.Equal(["delete b", "restore b"], _requests);

        _scene.MarkLoaded(B, Info());
        Assert.Contains(_scene.ShownMeasurements, static m => m.Id == "m1");

        _scene.Redo();
        Assert.Equal(["a", "c"], ModelIds());
        Assert.Equal(["m2"], MeasurementIds());
        Assert.Equal(["delete b", "restore b", "delete b"], _requests);
    }

    [Fact]
    public void Undoing_a_visibility_change_while_a_model_comes_back_applies_once_it_has_loaded()
    {
        LoadAll();
        _scene.ToggleNodeVisibility(B, 1);
        _scene.Delete(B);

        _scene.Undo(); // the delete: b is queued again, part 1 hidden
        _scene.Undo(); // the hide, while b is still importing
        Assert.True(_scene.Find(B)!.Hidden.IsEmpty);

        _scene.Redo();
        Assert.Equal([1], _scene.Find(B)!.Hidden.Order());
        _scene.MarkLoaded(B, Info());
        Assert.Equal([1], _scene.Find(B)!.Hidden.Order());
    }

    [Fact]
    public void A_deleted_model_is_forgotten_once_no_step_can_bring_it_back()
    {
        LoadAll();
        _scene.Delete(B);
        for (var step = 1; step < UndoHistory.Capacity; step++)
        {
            _scene.ToggleNodeVisibility(A, 1);
        }

        Assert.DoesNotContain("forget b", _requests); // the delete is still the oldest step
        _scene.ToggleNodeVisibility(A, 1);
        Assert.Contains("forget b", _requests);
    }

    [Fact]
    public void A_delete_dropped_from_redo_forgets_nothing_while_the_model_is_listed_or_deleted_again()
    {
        LoadAll();
        _scene.Delete(B);
        _scene.Undo();
        _scene.ToggleNodeVisibility(A, 1); // drops the redo of the delete; b is listed
        _scene.Undo();
        _scene.Delete(B); // drops the redo again, while a new step can bring b back

        Assert.DoesNotContain(_requests, static request => request.StartsWith("forget", StringComparison.Ordinal));
        _scene.Undo();
        Assert.Equal(["a", "b", "c"], ModelIds());
    }

    [Fact]
    public void Cancelling_a_model_as_it_comes_back_forgets_its_steps()
    {
        LoadAll();
        _scene.ToggleNodeVisibility(B, 1);
        _scene.Delete(B);
        _scene.Undo();

        _scene.Remove(B); // the viewer reports the import cancelled: gone for good
        Assert.Equal(["a", "c"], ModelIds());
        Assert.False(_scene.CanRedo);
        Assert.False(_scene.CanUndo); // the hide was b's only other step
    }

    [Fact]
    public void Clear_all_removes_every_model_measurement_and_step()
    {
        LoadAll();
        Assert.True(_scene.CanClearAll);
        _scene.AddMeasurement(Measure("m1", (A, 1)));
        _scene.Delete(B);
        _scene.Delete(A);
        _scene.Delete(C);
        Assert.True(_scene.CanClearAll); // nothing is listed, but an undo could bring the models back

        _scene.ClearAll();
        Assert.Empty(_scene.Models);
        Assert.Empty(_scene.Measurements);
        Assert.False(_scene.CanUndo || _scene.CanRedo || _scene.CanClearAll);
        Assert.Equal("clear", _requests[^1]);
    }

    [Fact]
    public void A_model_that_could_not_be_kept_says_why_even_after_an_undone_delete()
    {
        LoadAll();
        _scene.MarkNotKept(A, full: true);
        _scene.MarkNotKept(C, full: false);
        Assert.Equal("storage full", _scene.Find(A)!.NotKept);
        Assert.Equal("couldn't be stored", _scene.Find(C)!.NotKept);
        Assert.Null(_scene.Find(B)!.NotKept);

        _scene.Delete(A);
        _scene.Undo();
        Assert.Equal("storage full", _scene.Find(A)!.NotKept);
    }

    [Fact]
    public void A_fresh_import_takes_no_hidden_parts_before_it_has_loaded()
    {
        _scene.Add(Summary("q"));
        var queued = _scene.Find(new ModelId("q"))!;
        Assert.Same(queued, queued.WithParts([1], []));

        var restored = ModelEntry.Restoring(Summary("r"), []);
        Assert.Equal([1], restored.WithParts([1], [1]).Hidden.Order());
        Assert.True(restored.WithParts([1], [1]).Selected.IsEmpty);
    }

    private void LoadAll()
    {
        foreach (var id in new[] { A, B, C })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }
    }

    private static MeasureInfo Measure(string id, params (ModelId Model, int Node)[] parts) => new(
        id,
        $"Distance {id}",
        "30.000 mm",
        [new MeasureRow("Distance", "30.000 mm")],
        [.. parts.Select(static part => new MeasurePart(part.Model.Value, part.Node))],
        Approximate: false);

    private List<string> ModelIds() => [.. _scene.Models.Select(static model => model.Id.Value)];

    private List<string> MeasurementIds() => [.. _scene.Measurements.Select(static m => m.Id)];
}
