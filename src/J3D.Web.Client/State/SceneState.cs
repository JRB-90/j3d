using System.Collections.Immutable;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

/// <summary>
/// The models in the scene and how their imports are going, in import order (decision D57). The
/// <c>Viewport</c> feeds it from the viewer's callbacks and the <c>ModelList</c> renders it. Scoped
/// (D56): one per tab under WebAssembly, and never shared between the host's prerender requests.
/// </summary>
public sealed class SceneState
{
    /// <summary>Raised after every change to <see cref="Models"/>.</summary>
    public event Action? Changed;

    public ImmutableList<ModelEntry> Models { get; private set; } = [];

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

    /// <summary>The viewer cancelled, deleted or dismissed the model.</summary>
    public void Remove(ModelId id)
    {
        var index = Models.FindIndex(model => model.Id == id);
        if (index >= 0)
        {
            Set(Models.RemoveAt(index));
        }
    }

    /// <summary>Forgets every model, because the viewer that held them has gone.</summary>
    public void Clear()
    {
        if (!Models.IsEmpty)
        {
            Set([]);
        }
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

    private void Set(ImmutableList<ModelEntry> models)
    {
        Models = models;
        Changed?.Invoke();
    }
}
