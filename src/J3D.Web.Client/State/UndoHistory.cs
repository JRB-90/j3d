using System.Collections.Immutable;
using System.Text.Json;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

/// <summary>What undo works on: the models, with their parts. Measurements left it in M12 (D147).</summary>
public sealed record SceneContent(ImmutableList<ModelEntry> Models);

/// <summary>
/// One undoable change to the scene (decision D84). Steps are pure: each maps the scene to how it was
/// before or after the change, leaving what it didn't touch, or no longer exists, alone.
/// </summary>
public interface ISceneStep
{
    SceneContent Undo(SceneContent scene);

    SceneContent Redo(SceneContent scene);

    /// <summary>The step without a model that has gone, or null when nothing of it is left.</summary>
    ISceneStep? Without(ModelId id);

    /// <summary>What the step did, for Undo's and Redo's tooltips (M17, D224): "Paste", "selecting 3 parts".</summary>
    string Label { get; }
}

/// <summary>
/// A visibility change (hide, isolate, show all, an eye): each changed model's hidden parts before
/// and after. Undoing or redoing it never selects anything again (D98).
/// </summary>
public sealed record VisibilityStep(ImmutableDictionary<ModelId, (PartSet Before, PartSet After)> Changes, string Label = "Hide") : ISceneStep
{
    public SceneContent Undo(SceneContent scene) => scene with { Models = Apply(scene.Models, static change => change.Before) };

    public SceneContent Redo(SceneContent scene) => scene with { Models = Apply(scene.Models, static change => change.After) };

    public ISceneStep? Without(ModelId id)
    {
        var changes = Changes.Remove(id);
        return changes.IsEmpty ? null : this with { Changes = changes };
    }

    private ImmutableList<ModelEntry> Apply(
        ImmutableList<ModelEntry> models,
        Func<(PartSet Before, PartSet After), PartSet> pick) =>
        models.ConvertAll(model => Changes.TryGetValue(model.Id, out var change) ? model.WithParts(pick(change), model.Selected) : model);
}

/// <summary>
/// A move (M13, D145, D149): one node of one model, or the model itself, from one placement in its
/// parent's frame to another; a drop of the triad, or values typed in the fields.
/// </summary>
public sealed record MoveStep(ModelId Id, int Node, Matrix4d Before, Matrix4d After) : ISceneStep
{
    public string Label => "Move";

    public SceneContent Undo(SceneContent scene) => Apply(scene, Before);

    public SceneContent Redo(SceneContent scene) => Apply(scene, After);

    public ISceneStep? Without(ModelId id) => id == Id ? null : this;

    private SceneContent Apply(SceneContent scene, Matrix4d placement) =>
        scene with { Models = scene.Models.ConvertAll(model => model.Id == Id ? model.WithPlacement(Node, placement) : model) };
}

/// <summary>
/// An edit of one model's tree (M14, D145): a move in the hierarchy, a paste, a delete, a new assembly,
/// an ungroup or a rename, with the hidden parts, selection and moves before and after it. Undoing it
/// selects what was selected before (the deleted objects come back selected).
/// </summary>
public sealed record EditStep(ModelId Id, ModelEdit Before, ModelEdit After, string Label = "Edit") : ISceneStep
{
    public SceneContent Undo(SceneContent scene) => Apply(scene, Before);

    public SceneContent Redo(SceneContent scene) => Apply(scene, After);

    public ISceneStep? Without(ModelId id) => id == Id ? null : this;

    private SceneContent Apply(SceneContent scene, ModelEdit edit) =>
        scene with { Models = scene.Models.ConvertAll(model => model.Id == Id ? model.WithEdit(edit) : model) };
}

/// <summary>Several models' edits made as one (M14): a Delete of objects in more than one model. Undone last first.</summary>
public sealed record StepGroup(ImmutableList<ISceneStep> Steps) : ISceneStep
{
    public string Label => Steps.IsEmpty ? "Edit" : Steps[0].Label;

    public SceneContent Undo(SceneContent scene) => Steps.Reverse().Aggregate(scene, static (content, step) => step.Undo(content));

    public SceneContent Redo(SceneContent scene) => Steps.Aggregate(scene, static (content, step) => step.Redo(content));

    public ISceneStep? Without(ModelId id)
    {
        var steps = Steps.Select(step => step.Without(id)).OfType<ISceneStep>().ToImmutableList();
        return steps.IsEmpty ? null : this with { Steps = steps };
    }
}

/// <summary>
/// Deleting a model (M8, D84): the model as it was and where it was in the list. Undoing it lists the
/// model again, queued to be imported from its kept files under the same id (D117); redoing it
/// deletes the model again, whatever its state.
/// </summary>
public sealed record DeleteStep(ModelEntry Model, int Index) : ISceneStep
{
    public ModelId Id => Model.Id;

    public string Label => "Delete";

    public SceneContent Undo(SceneContent scene) => scene.Models.Any(model => model.Id == Id)
        ? scene
        : new SceneContent(scene.Models.Insert(Math.Min(Index, scene.Models.Count), ModelEntry.Restoring(Model)));

    public SceneContent Redo(SceneContent scene) => new(scene.Models.RemoveAll(model => model.Id == Id));

    public ISceneStep? Without(ModelId id) => id == Id ? null : this;
}

/// <summary>
/// What's selected (M17, D219): the mode, each model's selected parts (models with none left out), the
/// features the viewer selected (its keys, empty for none) and the node last picked, which the Move tool
/// moves (D167).
/// </summary>
public sealed record SelectionSnapshot(
    SelectMode Mode,
    ImmutableDictionary<ModelId, PartSet> Selected,
    string Features,
    (ModelId Id, int Node)? Anchor)
{
    /// <summary>Nothing is selected.</summary>
    public bool IsEmpty => Selected.IsEmpty && Features.Length == 0;

    /// <summary>Whether two snapshots select the same, whatever their anchors: a mode switch with nothing selected changes nothing (D219).</summary>
    public bool SelectsSame(SelectionSnapshot other) =>
        (Mode == other.Mode || (IsEmpty && other.IsEmpty)) && Features == other.Features && Selected.Count == other.Selected.Count &&
        Selected.All(item => other.Selected.TryGetValue(item.Key, out var parts) && (ReferenceEquals(parts, item.Value) || parts.SetEquals(item.Value)));

    public SelectionSnapshot Without(ModelId id) => this with
    {
        Selected = Selected.Remove(id),
        Anchor = Anchor is { } anchor && anchor.Id == id ? null : Anchor,
    };
}

/// <summary>
/// A change of the selection the user made (M17, D209, D219): a click, a tree pick, clearing it, or a
/// mode switch that changed it, with what was selected before and after. This puts the parts back; the
/// <c>SceneState</c> puts back the mode, the anchor and the viewer's features.
/// </summary>
public sealed record SelectionStep(SelectionSnapshot Before, SelectionSnapshot After) : ISceneStep
{
    public string Label => Describe(Before, After);

    public SceneContent Undo(SceneContent scene) => Apply(scene, Before);

    public SceneContent Redo(SceneContent scene) => Apply(scene, After);

    public ISceneStep? Without(ModelId id)
    {
        var step = new SelectionStep(Before.Without(id), After.Without(id));
        return step.Before.SelectsSame(step.After) ? null : step;
    }

    private static SceneContent Apply(SceneContent scene, SelectionSnapshot selection) => scene with
    {
        Models = scene.Models.ConvertAll(model => model.Tree is null
            ? model
            : model.WithParts(model.Hidden, selection.Selected.TryGetValue(model.Id, out var parts) ? parts : PartSet.Empty)),
    };

    /// <summary>"switching to Feature mode", "clearing the selection", "selecting 3 parts", "selecting 1 model", "selecting 2 features".</summary>
    private static string Describe(SelectionSnapshot before, SelectionSnapshot after)
    {
        if (before.Mode != after.Mode)
        {
            return $"switching to {after.Mode switch { SelectMode.Models => "Model", SelectMode.Features => "Feature", _ => "Object" }} mode";
        }

        var (count, noun) = after.Mode switch
        {
            SelectMode.Models => (after.Selected.Count, "model"),
            SelectMode.Features => (CountFeatures(after.Features), "feature"),
            _ => (after.Selected.Values.Sum(static parts => parts.Count), "part"),
        };
        return count == 0 ? "clearing the selection" : $"selecting {count} {noun}{(count == 1 ? "" : "s")}";
    }

    private static int CountFeatures(string keys)
    {
        if (string.IsNullOrEmpty(keys))
        {
            return 0;
        }

        try
        {
            using var document = JsonDocument.Parse(keys);
            return document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement.GetArrayLength() : 0;
        }
        catch (JsonException)
        {
            return 0;
        }
    }
}

/// <summary>
/// The scene's undo and redo stacks: per tab, not stored, and the last <see cref="Capacity"/> steps
/// (assumption 11). A new step clears what could be redone. Selection steps (M17, D218) don't count
/// against the <see cref="Capacity"/>: the last <see cref="SelectionCapacity"/> of them are kept besides,
/// and they're the ones that go when there are more, so edits and undoable deletes keep their places.
/// </summary>
public sealed class UndoHistory
{
    public const int Capacity = 50;

    public const int SelectionCapacity = 50;

    private readonly LinkedList<ISceneStep> _undo = [];
    private readonly Stack<ISceneStep> _redo = [];

    public bool CanUndo => _undo.Count > 0;

    public bool CanRedo => _redo.Count > 0;

    public int Count => _undo.Count;

    /// <summary>The step Undo would undo, or null (D224).</summary>
    public ISceneStep? NextUndo => _undo.Last?.Value;

    /// <summary>The step Redo would redo, or null.</summary>
    public ISceneStep? NextRedo => _redo.TryPeek(out var step) ? step : null;

    /// <summary>Adds a step, and returns the steps that dropped out: the oldest, past the capacities, and what could be redone.</summary>
    public IReadOnlyList<ISceneStep> Push(ISceneStep step)
    {
        List<ISceneStep> dropped = [.. _redo];
        _undo.AddLast(step);
        DropOldest(static step => step is SelectionStep, SelectionCapacity, dropped);
        DropOldest(static step => step is not SelectionStep, Capacity, dropped);
        _redo.Clear();
        return dropped;
    }

    /// <summary>Whether a step can still undo or redo the deletion of this model (M8).</summary>
    public bool CanRestore(ModelId id) => _undo.Concat(_redo).Any(step => step is DeleteStep delete && delete.Id == id);

    /// <summary>The step to undo, now redoable, or null.</summary>
    public ISceneStep? Undo()
    {
        if (_undo.Last is not { } last)
        {
            return null;
        }

        _undo.RemoveLast();
        _redo.Push(last.Value);
        return last.Value;
    }

    /// <summary>The step to redo, now undoable again, or null.</summary>
    public ISceneStep? Redo()
    {
        if (!_redo.TryPop(out var step))
        {
            return null;
        }

        _undo.AddLast(step);
        return step;
    }

    /// <summary>Drops a removed model from every step, and the steps left empty.</summary>
    public void Forget(ModelId id)
    {
        for (var node = _undo.First; node is not null;)
        {
            var next = node.Next;
            if (node.Value.Without(id) is { } step)
            {
                node.Value = step;
            }
            else
            {
                _undo.Remove(node);
            }

            node = next;
        }

        var redo = _redo.Reverse().Select(step => step.Without(id)).OfType<ISceneStep>().ToList();
        _redo.Clear();
        redo.ForEach(_redo.Push);
    }

    public void Clear()
    {
        _undo.Clear();
        _redo.Clear();
    }

    /// <summary>Drops the oldest steps of one kind until no more than <paramref name="capacity"/> of them are left.</summary>
    private void DropOldest(Func<ISceneStep, bool> kind, int capacity, List<ISceneStep> dropped)
    {
        var count = _undo.Count(kind);
        for (var node = _undo.First; node is not null && count > capacity;)
        {
            var next = node.Next;
            if (kind(node.Value))
            {
                dropped.Add(node.Value);
                _undo.Remove(node);
                count--;
            }

            node = next;
        }
    }
}
