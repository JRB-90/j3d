using System.Collections.Immutable;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

/// <summary>
/// The models in the scene and how their imports are going, in import order (decision D57). The
/// <c>Viewport</c> feeds it from the viewer's callbacks and the <c>ModelList</c> renders it. Scoped
/// (D56): one per tab under WebAssembly, and never shared between the host's prerender requests.
/// Since M6 it also owns each model's selected and hidden parts and the undo history (D95): the
/// <c>Viewport</c> applies them to the viewer. Since M7 it holds the Measure tool's mode, its pending
/// first pick and the kept measurements (D101), which follow their parts (D108).
/// </summary>
public sealed class SceneState
{
    private readonly UndoHistory _history = new();

    /// <summary>Raised after every change to <see cref="Models"/> or the history.</summary>
    public event Action? Changed;

    /// <summary>Raised when a part picked in 3D should be shown in its model's tree (D96).</summary>
    public event Action<ModelId, int>? RevealRequested;

    public ImmutableList<ModelEntry> Models { get; private set; } = [];

    /// <summary>The Measure tool is on: clicks pick faces, edges and vertices instead of parts (D79).</summary>
    public bool MeasureMode { get; private set; }

    /// <summary>The Measure tool's first pick, with its properties, until the second (D101).</summary>
    public MeasureInfo? PendingMeasure { get; private set; }

    /// <summary>Kept measurements, oldest first.</summary>
    public ImmutableList<MeasureInfo> Measurements { get; private set; } = [];

    /// <summary>The kept measurements whose parts are all visible: the ones the viewer draws (D108).</summary>
    public IReadOnlyList<MeasureInfo> ShownMeasurements => [.. Measurements.Where(IsShown)];

    /// <summary>A measurement is shown while every part it measures is listed, loaded and visible.</summary>
    public bool IsShown(MeasureInfo measurement) => measurement.Parts.All(part =>
        Find(part.ModelId) is { Tree: not null } model && !model.Hidden.Contains(part.Node));

    public bool CanUndo => _history.CanUndo;

    public bool CanRedo => _history.CanRedo;

    /// <summary>Every selected part, in list order, then tree order.</summary>
    public IReadOnlyList<(ModelEntry Model, int Node)> Selection =>
        [.. Models.SelectMany(model => model.Selected.Order().Select(node => (model, node)))];

    public bool HasSelection => Models.Any(model => !model.Selected.IsEmpty);

    public bool HasHidden => Models.Any(model => !model.Hidden.IsEmpty);

    /// <summary>Isolate would change something: there's a selection and a visible part outside it.</summary>
    public bool CanIsolate => HasSelection && Models.Any(model =>
        model.Tree is { } tree && tree.Parts.Any(part => !model.Hidden.Contains(part) && !model.Selected.Contains(part)));

    public ModelEntry? Find(ModelId id) => Models.Find(model => model.Id == id);

    /// <summary>A model was queued. It goes to the end of the list.</summary>
    public void Add(ModelSummary summary)
    {
        if (Find(summary.Id) is null)
        {
            Set(Models.Add(new ModelEntry(summary)));
        }
    }

    public void ReportProgress(ModelId id, ImportPhase phase, double? fraction) =>
        Update(id, model => model.WithProgress(phase, fraction));

    public void MarkLoaded(ModelId id, ModelLoadedInfo info) => Update(id, model => model.AsLoaded(info));

    public void MarkFailed(ModelId id, ImportError error) => Update(id, model => model.AsFailed(error));

    /// <summary>The viewer cancelled, deleted or dismissed the model. Its undo steps go with it (until M8, D84).</summary>
    public void Remove(ModelId id)
    {
        var index = Models.FindIndex(model => model.Id == id);
        if (index >= 0)
        {
            _history.Forget(id);
            Measurements = Measurements.RemoveAll(measurement => measurement.Touches(id));
            if (PendingMeasure?.Touches(id) == true)
            {
                PendingMeasure = null;
            }

            Set(Models.RemoveAt(index), always: true);
        }
    }

    /// <summary>Forgets every model, because the viewer that held them has gone.</summary>
    public void Clear()
    {
        _history.Clear();
        PendingMeasure = null;
        var hadMeasurements = !Measurements.IsEmpty;
        Measurements = [];
        if (!Models.IsEmpty || hadMeasurements)
        {
            Set([], always: true);
        }
    }

    /// <summary>The toolbar's Measure button or the M key (D79). Turning it off drops a pending pick.</summary>
    public void ToggleMeasureMode() => SetMeasureMode(!MeasureMode);

    public void SetMeasureMode(bool on)
    {
        if (on != MeasureMode)
        {
            MeasureMode = on;
            PendingMeasure = on ? PendingMeasure : null;
            Set(Models, always: true);
        }
    }

    /// <summary>The viewer's first pick, or null when it was dropped or finished.</summary>
    public void SetPendingMeasure(MeasureInfo? pending)
    {
        if (pending != PendingMeasure)
        {
            PendingMeasure = MeasureMode ? pending : null;
            Set(Models, always: true);
        }
    }

    /// <summary>A measurement the viewer has kept: listed and undoable (D84, D101).</summary>
    public void AddMeasurement(MeasureInfo measurement)
    {
        if (Measurements.Any(kept => kept.Id == measurement.Id) || !measurement.Parts.All(part => Find(part.ModelId) is not null))
        {
            return;
        }

        ChangeMeasurements(Measurements.Add(measurement));
    }

    public void RemoveMeasurement(string id) => ChangeMeasurements(Measurements.RemoveAll(measurement => measurement.Id == id));

    /// <summary>The panel's Clear: removes every kept measurement, as one undoable step.</summary>
    public void ClearMeasurements() => ChangeMeasurements([]);

    /// <summary>
    /// A click in the viewport (D77): on a part, it becomes the selection, or with Ctrl it's added
    /// or removed; on empty space (no model), the selection is cleared unless Ctrl was held. The
    /// tree then reveals the part (D96).
    /// </summary>
    public void Pick(ModelId? id, int node, bool additive)
    {
        var target = id is { } modelId ? Find(modelId) : null;
        if (target?.Tree is not { } tree || !tree.IsPart(node) || target.Hidden.Contains(node))
        {
            if (!additive)
            {
                ClearSelection();
            }

            return;
        }

        if (additive)
        {
            var removed = target.Selected.Remove(node);
            var selected = removed.Count < target.Selected.Count ? removed : target.Selected.Add(node);
            Update(target.Id, model => model.WithParts(model.Hidden, selected));
        }
        else
        {
            Set(Models.ConvertAll(model => model.WithParts(model.Hidden, model.Id == target.Id ? [node] : [])));
        }

        if (Find(target.Id)!.Selected.Contains(node))
        {
            RevealRequested?.Invoke(target.Id, node);
        }
    }

    /// <summary>
    /// A click on a tree node: the visible parts under it become the selection, or with Ctrl are
    /// added, or removed when they're all selected already (D77, D96).
    /// </summary>
    public void SelectNode(ModelId id, int node, bool additive)
    {
        if (Find(id) is not { Tree: { } tree } target || !tree.Contains(node))
        {
            return;
        }

        var parts = tree.PartsUnder(node).Where(part => !target.Hidden.Contains(part)).ToList();
        if (!additive)
        {
            Set(Models.ConvertAll(model => model.WithParts(model.Hidden, model.Id == id ? parts : [])));
        }
        else if (parts.Count > 0)
        {
            var selected = parts.All(target.Selected.Contains) ? target.Selected.Except(parts) : target.Selected.Union(parts);
            Update(id, model => model.WithParts(model.Hidden, selected));
        }
    }

    public void ClearSelection() => Set(Models.ConvertAll(model => model.WithParts(model.Hidden, [])));

    /// <summary>Hides the selected parts, which leaves the selection empty (D78, D98).</summary>
    public void HideSelection() => ChangeVisibility(model => model.Hidden.Union(model.Selected));

    /// <summary>Hides every part outside the selection, in every model (assumption 9).</summary>
    public void IsolateSelection()
    {
        if (CanIsolate)
        {
            ChangeVisibility(model => [.. model.Tree?.Parts.Where(part => !model.Selected.Contains(part)) ?? []]);
        }
    }

    /// <summary>Shows every part of every model.</summary>
    public void ShowAll() => ChangeVisibility(static _ => []);

    /// <summary>A tree node's eye: shows its parts when they're all hidden, otherwise hides them all.</summary>
    public void ToggleNodeVisibility(ModelId id, int node)
    {
        if (Find(id) is not { Tree: { } tree } target || !tree.Contains(node))
        {
            return;
        }

        var parts = tree.PartsUnder(node);
        var hidden = target.VisibilityOf(node) == PartVisibility.Hidden ? target.Hidden.Except(parts) : target.Hidden.Union(parts);
        ChangeVisibility(model => model.Id == id ? hidden : model.Hidden);
    }

    /// <summary>A list item's eye: the same for the whole model.</summary>
    public void ToggleModelVisibility(ModelId id)
    {
        if (Find(id) is not { Tree: { } tree } target)
        {
            return;
        }

        var hidden = target.Visibility() == PartVisibility.Hidden ? [] : PartSet.From(tree.Parts);
        ChangeVisibility(model => model.Id == id ? hidden : model.Hidden);
    }

    public void Undo()
    {
        if (_history.Undo() is { } step)
        {
            Apply(step.Undo(new SceneContent(Models, Measurements)));
        }
    }

    public void Redo()
    {
        if (_history.Redo() is { } step)
        {
            Apply(step.Redo(new SceneContent(Models, Measurements)));
        }
    }

    private void Apply(SceneContent content)
    {
        Measurements = content.Measurements;
        Set(content.Models, always: true);
    }

    private void ChangeMeasurements(ImmutableList<MeasureInfo> measurements)
    {
        if (measurements.SequenceEqual(Measurements))
        {
            return;
        }

        _history.Push(new MeasurementsStep(Measurements, measurements));
        Measurements = measurements;
        Set(Models, always: true);
    }

    /// <summary>Applies new hidden parts to loaded models and records the change as one undoable step, if anything changed.</summary>
    private void ChangeVisibility(Func<ModelEntry, PartSet> hidden)
    {
        var changes = ImmutableDictionary.CreateBuilder<ModelId, (PartSet Before, PartSet After)>();
        var models = Models.ConvertAll(model =>
        {
            if (model.Tree is null)
            {
                return model;
            }

            var next = model.WithParts(hidden(model), model.Selected);
            if (!next.Hidden.SetEquals(model.Hidden))
            {
                changes[model.Id] = (model.Hidden, next.Hidden);
            }

            return next;
        });

        if (changes.Count > 0)
        {
            _history.Push(new VisibilityStep(changes.ToImmutable()));
        }

        Set(models);
    }

    /// <summary>Applies a transition to a known model; an id the list no longer has is ignored.</summary>
    private void Update(ModelId id, Func<ModelEntry, ModelEntry> transition)
    {
        var index = Models.FindIndex(model => model.Id == id);
        if (index < 0)
        {
            return;
        }

        var current = Models[index];
        var next = transition(current);
        if (!ReferenceEquals(next, current))
        {
            Set(Models.SetItem(index, next));
        }
    }

    /// <summary>Raises <see cref="Changed"/> only when an entry changed, unless the history did (<paramref name="always"/>).</summary>
    private void Set(ImmutableList<ModelEntry> models, bool always = false)
    {
        if (!always && (ReferenceEquals(models, Models) || models.SequenceEqual(Models, ReferenceEqualityComparer.Instance)))
        {
            return;
        }

        Models = models;
        Changed?.Invoke();
    }
}
