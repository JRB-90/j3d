using System.Collections.Immutable;
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
}

/// <summary>
/// A visibility change (hide, isolate, show all, an eye): each changed model's hidden parts before
/// and after. Undoing or redoing it never selects anything again (D98).
/// </summary>
public sealed record VisibilityStep(ImmutableDictionary<ModelId, (PartSet Before, PartSet After)> Changes) : ISceneStep
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
public sealed record EditStep(ModelId Id, ModelEdit Before, ModelEdit After) : ISceneStep
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

    public SceneContent Undo(SceneContent scene) => scene.Models.Any(model => model.Id == Id)
        ? scene
        : new SceneContent(scene.Models.Insert(Math.Min(Index, scene.Models.Count), ModelEntry.Restoring(Model)));

    public SceneContent Redo(SceneContent scene) => new(scene.Models.RemoveAll(model => model.Id == Id));

    public ISceneStep? Without(ModelId id) => id == Id ? null : this;
}

/// <summary>
/// The scene's undo and redo stacks: per tab, not stored, and the last <see cref="Capacity"/> steps
/// (assumption 11). A new step clears what could be redone.
/// </summary>
public sealed class UndoHistory
{
    public const int Capacity = 50;

    private readonly LinkedList<ISceneStep> _undo = [];
    private readonly Stack<ISceneStep> _redo = [];

    public bool CanUndo => _undo.Count > 0;

    public bool CanRedo => _redo.Count > 0;

    public int Count => _undo.Count;

    /// <summary>Adds a step, and returns the steps that dropped out: the oldest, past the capacity, and what could be redone.</summary>
    public IReadOnlyList<ISceneStep> Push(ISceneStep step)
    {
        List<ISceneStep> dropped = [.. _redo];
        _undo.AddLast(step);
        if (_undo.Count > Capacity)
        {
            dropped.Add(_undo.First!.Value);
            _undo.RemoveFirst();
        }

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
}
