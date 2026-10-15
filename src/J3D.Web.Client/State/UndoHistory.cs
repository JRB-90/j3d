using System.Collections.Immutable;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

/// <summary>
/// One undoable change to the scene (decision D84). Steps are pure: each maps the model list to the
/// list before or after the change, leaving models it didn't touch, or no longer has, alone.
/// </summary>
public interface ISceneStep
{
    ImmutableList<ModelEntry> Undo(ImmutableList<ModelEntry> models);

    ImmutableList<ModelEntry> Redo(ImmutableList<ModelEntry> models);

    /// <summary>The step without a model that has gone, or null when nothing of it is left.</summary>
    ISceneStep? Without(ModelId id);
}

/// <summary>
/// A visibility change (hide, isolate, show all, an eye): each changed model's hidden parts before
/// and after. Undoing or redoing it never selects anything again (D98).
/// </summary>
public sealed record VisibilityStep(ImmutableDictionary<ModelId, (PartSet Before, PartSet After)> Changes) : ISceneStep
{
    public ImmutableList<ModelEntry> Undo(ImmutableList<ModelEntry> models) => Apply(models, static change => change.Before);

    public ImmutableList<ModelEntry> Redo(ImmutableList<ModelEntry> models) => Apply(models, static change => change.After);

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

    public void Push(ISceneStep step)
    {
        _undo.AddLast(step);
        if (_undo.Count > Capacity)
        {
            _undo.RemoveFirst();
        }

        _redo.Clear();
    }

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
