using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// Hosts the Three.js viewer. The viewer, its camera controls and all model data live in the
/// TypeScript module; this component owns its lifetime, shares it with the toolbar and model list
/// through the <see cref="ViewerSession"/>, and relays the viewer's model events into the
/// <see cref="SceneState"/>, with snackbars for failures and rejected files (decision D54).
/// Since M6 it also relays picks and key commands to the <see cref="SceneState"/>, which owns
/// selection, visibility and undo, and applies each model's parts back to the viewer (D95).
/// </summary>
public sealed partial class Viewport(IJSRuntime js, ViewerSession session, SceneState scene, ISnackbar snackbar) : IAsyncDisposable
{
    private ElementReference _host;
    private ViewerInterop? _viewer;
    private DotNetObjectReference<Viewport>? _selfReference;
    private bool _disposed;

    /// <summary>What the viewer was last given for each model, so only changes are sent.</summary>
    private readonly Dictionary<ModelId, (PartSet Hidden, PartSet Selected)> _applied = [];

    /// <summary>Raised once the viewer has started and reported the browser's capabilities.</summary>
    [Parameter]
    public EventCallback<ViewerCapabilities> OnReady { get; set; }

    public ViewerCapabilities? Capabilities { get; private set; }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender)
        {
            return;
        }

        _selfReference = DotNetObjectReference.Create(this);
        var viewer = await ViewerInterop.CreateAsync(js, _host, _selfReference);
        if (_disposed)
        {
            await viewer.DisposeAsync();
            return;
        }

        _viewer = viewer;
        scene.Changed += OnSceneChanged;
        AttachToSession();
    }

    [JSInvokable]
    public async Task OnViewerReady(ViewerCapabilities capabilities)
    {
        Capabilities = capabilities;
        AttachToSession();
        await OnReady.InvokeAsync(capabilities);
        StateHasChanged();
    }

    [JSInvokable]
    public void OnModelQueued(ModelSummary summary) => scene.Add(summary);

    [JSInvokable]
    public void OnModelProgress(ModelId id, ImportPhase phase, double? fraction) => scene.ReportProgress(id, phase, fraction);

    [JSInvokable]
    public void OnModelLoaded(ModelId id, ModelLoadedInfo info) => scene.MarkLoaded(id, info);

    [JSInvokable]
    public void OnModelFailed(ModelId id, ImportError error)
    {
        var fileName = scene.Find(id)?.Summary.FileName ?? "a model";
        scene.MarkFailed(id, error);
        snackbar.Add($"Couldn't import {fileName}: {error.Message}", Severity.Error, options => options.VisibleStateDuration = 10_000);
    }

    [JSInvokable]
    public void OnModelRemoved(ModelId id) => scene.Remove(id);

    /// <summary>A file that won't be imported. It has no list item, so the snackbar is its only report.</summary>
    [JSInvokable]
    public void OnImportRejected(string fileName, string reason) => snackbar.Add($"Skipped {fileName}: {reason}", Severity.Warning);

    /// <summary>A click that didn't drag: a part, or empty space when <paramref name="modelId"/> is null (D77).</summary>
    [JSInvokable]
    public void OnPartPicked(string? modelId, int node, bool additive) =>
        scene.Pick(modelId is null ? null : new ModelId(modelId), node, additive);

    /// <summary>A key the viewer caught (D99): Esc, H, I, Shift+H, Ctrl+Z, Ctrl+Y.</summary>
    [JSInvokable]
    public void OnViewerCommand(string command)
    {
        switch (command)
        {
            case "clearSelection":
                scene.ClearSelection();
                break;
            case "hide":
                scene.HideSelection();
                break;
            case "isolate":
                scene.IsolateSelection();
                break;
            case "showAll":
                scene.ShowAll();
                break;
            case "undo":
                scene.Undo();
                break;
            case "redo":
                scene.Redo();
                break;
        }
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        scene.Changed -= OnSceneChanged;
        if (_viewer is not null)
        {
            session.Detach(_viewer);
            await _viewer.DisposeAsync();
            _viewer = null;
        }

        scene.Clear(); // the models went with the viewer
        _selfReference?.Dispose();
    }

    private void OnSceneChanged() => _ = ApplyPartsAsync();

    /// <summary>Sends each loaded model's hidden and selected parts to the viewer when they've changed.</summary>
    private async Task ApplyPartsAsync()
    {
        if (_viewer is not { } viewer)
        {
            return;
        }

        var pending = new List<ModelEntry>();
        foreach (var model in scene.Models.Where(static model => model.Tree is not null))
        {
            var known = _applied.TryGetValue(model.Id, out var applied);
            if (known ? !ReferenceEquals(applied.Hidden, model.Hidden) || !ReferenceEquals(applied.Selected, model.Selected)
                      : !model.Hidden.IsEmpty || !model.Selected.IsEmpty)
            {
                pending.Add(model);
            }

            _applied[model.Id] = (model.Hidden, model.Selected);
        }

        foreach (var id in _applied.Keys.Where(id => scene.Find(id) is null).ToList())
        {
            _applied.Remove(id);
        }

        try
        {
            foreach (var model in pending)
            {
                await viewer.SetPartStateAsync(model.Id, model.Hidden, model.Selected);
            }
        }
        catch (JSDisconnectedException)
        {
            // The page is going away.
        }
    }

    /// <summary>The viewer reports its capabilities while it starts, so either may be known first.</summary>
    private void AttachToSession()
    {
        if (_viewer is not null && Capabilities is not null)
        {
            session.Attach(_viewer, Capabilities);
        }
    }
}
