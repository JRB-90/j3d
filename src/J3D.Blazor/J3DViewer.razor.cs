using System.Collections.Immutable;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace J3D.Blazor;

/// <summary>
/// The viewer in a Blazor page. The viewer, its camera controls and all model data live in the
/// TypeScript module; this component owns its lifetime, shares it with the page through the
/// <see cref="ViewerSession"/>, and relays its reports into the <see cref="SceneState"/>, which owns
/// selection, visibility and undo, applying each model's parts back to the viewer (D95). It lists the
/// models kept from the last visit, and has the viewer delete, restore and forget models as the scene
/// asks, and keep their order (D117). It has no UI of its own: what's on the view comes as child content,
/// and what the page should say comes through <see cref="OnNotice"/> (D251, D271).
/// </summary>
public sealed partial class J3DViewer(IJSRuntime js, ViewerSession session, SceneState scene) : IAsyncDisposable
{
    private ElementReference _host;
    private ViewerInterop? _viewer;
    private DotNetObjectReference<ViewerCallbacks>? _callbacksReference;
    private bool _disposed;
    private bool _restoreStarted;

    /// <summary>What the viewer was last told of the Measure tool and the selection mode, so only changes are sent.</summary>
    private bool _appliedMeasureMode;
    private SelectMode _appliedSelectionMode = SelectMode.Objects;
    private bool _appliedAddMode;

    /// <summary>The model order the viewer was last given.</summary>
    private string _appliedOrder = "";

    /// <summary>What the viewer was last given for each model, so only changes are sent.</summary>
    private readonly Dictionary<ModelId, (PartSet Hidden, PartSet Selected)> _applied = [];

    /// <summary>Each model's edits as last sent to the viewer (M14).</summary>
    private readonly Dictionary<ModelId, ModelEdits> _appliedEdits = [];

    /// <summary>Each model's moved nodes as last sent to the viewer, or as the viewer reported them after a drag (M13).</summary>
    private readonly Dictionary<ModelId, ImmutableDictionary<int, Matrix4d>> _appliedPlacements = [];

    /// <summary>The Move tool and origin frames as last sent, to send them only when they change.</summary>
    private string _appliedMoveTool = MoveToolKey(null, null, MoveFrame.Local);
    private string _appliedOriginFrames = "";

    /// <summary>The changes last sent, which the next waits for (M16): sending can now yield part-way (D199).</summary>
    private Task _sending = Task.CompletedTask;

    /// <summary>Raised once the viewer has started and reported the browser's capabilities.</summary>
    [Parameter]
    public EventCallback<ViewerCapabilities> OnReady { get; set; }

    /// <summary>Raised for each thing the page should tell its user (D271).</summary>
    [Parameter]
    public EventCallback<ViewerNotice> OnNotice { get; set; }

    /// <summary>Where the viewer takes its keys. Off unless asked for (D256).</summary>
    [Parameter]
    public ViewerKeys Keys { get; set; } = ViewerKeys.Off;

    /// <summary>A CSS selector: while it matches, the viewer leaves keys alone, for a menu or dialog of the page's (D273).</summary>
    [Parameter]
    public string? PauseKeysWhile { get; set; }

    /// <summary>Names the store that keeps models between visits. Nothing is kept unless it's set (D256).</summary>
    [Parameter]
    public string? Keep { get; set; }

    /// <summary>Shows the view cube.</summary>
    [Parameter]
    public bool ViewCube { get; set; } = true;

    /// <summary>Shows the Home button.</summary>
    [Parameter]
    public bool HomeButton { get; set; } = true;

    /// <summary>Shows the Previous view and Next view buttons.</summary>
    [Parameter]
    public bool ViewButtons { get; set; } = true;

    /// <summary>Imports files dropped on the viewer.</summary>
    [Parameter]
    public bool DropFiles { get; set; } = true;

    /// <summary>What's drawn over the view, such as a page's panels.</summary>
    [Parameter]
    public RenderFragment? ChildContent { get; set; }

    /// <summary>Goes on the viewer's element: a class, say, for it needs a size from the page.</summary>
    [Parameter(CaptureUnmatchedValues = true)]
    public IReadOnlyDictionary<string, object>? Attributes { get; set; }

    internal ViewerCapabilities? Capabilities { get; private set; }

    /// <summary>What the viewer calls back: internal, as the entry points must be public (D270).</summary>
    internal ViewerCallbacks Callbacks => field ??= new ViewerCallbacks(this, session, scene);

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender)
        {
            return;
        }

        session.Claim(this);
        _callbacksReference = DotNetObjectReference.Create(Callbacks);
        var options = new ViewerOptions(Keys, PauseKeysWhile, Keep, ViewCube, HomeButton, ViewButtons, DropFiles);
        var viewer = await ViewerInterop.CreateAsync(js, _host, _callbacksReference, options);
        if (_disposed)
        {
            await viewer.DisposeAsync();
            return;
        }

        _viewer = viewer;
        scene.Changed += OnSceneChanged;
        scene.DeleteRequested += OnDeleteRequested;
        scene.RestoreRequested += OnRestoreRequested;
        scene.ForgetRequested += OnForgetRequested;
        scene.ClearAllRequested += OnClearAllRequested;
        scene.ClearFeaturesRequested += OnClearFeaturesRequested;
        scene.TransferRequested += OnTransferRequested;
        scene.ExpandRequested += OnExpandRequested;
        AttachToSession();
    }

    /// <summary>The viewer has started: <see cref="ViewerCallbacks.OnViewerReady"/>.</summary>
    internal async Task ReportReadyAsync(ViewerCapabilities capabilities)
    {
        Capabilities = capabilities;
        AttachToSession();
        await OnReady.InvokeAsync(capabilities);
        StateHasChanged();
    }

    internal void Notify(ViewerNotice notice) => _ = OnNotice.InvokeAsync(notice);

    /// <summary>The viewer put a node there itself, by a drag, so it isn't sent back.</summary>
    internal void ReportMoved(ModelId id, int node, Matrix4d placement)
    {
        if (scene.Find(id) is { } model)
        {
            _appliedPlacements[id] = (_appliedPlacements.TryGetValue(id, out var applied) ? applied : model.Placements).SetItem(node, placement);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        session.Release(this);
        scene.Changed -= OnSceneChanged;
        scene.DeleteRequested -= OnDeleteRequested;
        scene.RestoreRequested -= OnRestoreRequested;
        scene.ForgetRequested -= OnForgetRequested;
        scene.ClearAllRequested -= OnClearAllRequested;
        scene.ClearFeaturesRequested -= OnClearFeaturesRequested;
        scene.TransferRequested -= OnTransferRequested;
        scene.ExpandRequested -= OnExpandRequested;
        if (_viewer is not null)
        {
            session.Detach(_viewer);
            await _viewer.DisposeAsync();
            _viewer = null;
        }

        scene.Clear(); // the models went with the viewer
        _callbacksReference?.Dispose();
    }

    private void OnSceneChanged() => _ = ApplyPartsAsync();

    private void OnDeleteRequested(ModelId id) => _ = CallViewerAsync(viewer => viewer.DeleteModelAsync(id));

    private void OnRestoreRequested(IReadOnlyList<ModelEntry> models) =>
        _ = CallViewerAsync(viewer => viewer.RestoreModelsAsync(models.Select(static model => new StoredModel(model.Summary, [.. model.Hidden.Order()]))));

    private void OnForgetRequested(ModelId id) => _ = CallViewerAsync(viewer => viewer.ForgetModelAsync(id));

    private void OnClearAllRequested() => _ = CallViewerAsync(static viewer => viewer.ClearAllAsync());

    private void OnClearFeaturesRequested() => _ = CallViewerAsync(static viewer => viewer.ClearFeaturesAsync());

    /// <summary>Objects going to another model (M18): the viewer brings them, then the scene makes the edit.</summary>
    private void OnTransferRequested(TransferRequest request) => _ = InvokeAsync(() => TransferCommand.RunAsync(scene, session, Notify, request));

    /// <summary>Expand and Expand all (M15, D154): the viewer expands the parts, then the scene makes the edit.</summary>
    private void OnExpandRequested(ModelId id, IReadOnlyList<int> parts) => _ = InvokeAsync(() => ExpandCommand.RunAsync(scene, session, Notify, id, parts));

    private async Task CallViewerAsync(Func<ViewerInterop, ValueTask> call)
    {
        if (_viewer is { } viewer)
        {
            try
            {
                await call(viewer);
            }
            catch (JSDisconnectedException)
            {
                // The page is going away.
            }
        }
    }

    /// <summary>
    /// Lists the models kept from the last visit, which the viewer then imports again, and says when
    /// this tab won't keep its models (D82, D109). The viewer has put the stored camera back by now.
    /// </summary>
    private async Task RestoreAsync(ViewerInterop viewer)
    {
        StoredScene stored;
        try
        {
            stored = await viewer.RestoreSceneAsync();
        }
        catch (JSDisconnectedException)
        {
            return;
        }

        if (_disposed)
        {
            return;
        }

        if (stored.Camera is { } camera)
        {
            session.RestoreProjection(camera.Projection);
        }

        // Only a viewer that was asked to keep models has anything to say about it (D256).
        if (Keep is not null)
        {
            switch (stored.Status)
            {
                case StoreStatus.OtherTab:
                    Notify(new ViewerNotice(NoticeKind.OtherTab, NoticeSeverity.Info, "This page is open in another tab, so the models you import here won't be kept for your next visit."));
                    break;
                case StoreStatus.Unavailable:
                    Notify(new ViewerNotice(NoticeKind.KeepingUnavailable, NoticeSeverity.Info, "This browser can't keep models for your next visit."));
                    break;
            }
        }

        // A kept model the store couldn't read stays kept, for the next visit (D200).
        if (stored.Unreadable > 0)
        {
            Notify(new ViewerNotice(
                NoticeKind.KeptModelsUnreadable,
                NoticeSeverity.Warning,
                stored.Unreadable == 1
                    ? "A kept model couldn't be read this time. It's still kept, and will be tried again next time."
                    : $"{stored.Unreadable} kept models couldn't be read this time. They're still kept, and will be tried again next time."));
        }

        scene.Restore(stored.Models);
    }

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

        // Edits (M14): sent before the parts, since the selection may hold new nodes. A restored model's
        // kept edits are the viewer's already, so a first look sends only edits made since.
        var edits = new List<(ModelId Id, ModelEdits Edits)>();
        foreach (var model in scene.Models.Where(static model => model.Tree is not null))
        {
            if (_appliedEdits.TryGetValue(model.Id, out var sent) ? !ReferenceEquals(sent, model.Edits) : !model.Edits.IsEmpty && model.Info?.Edits is null)
            {
                edits.Add((model.Id, model.Edits));
            }

            _appliedEdits[model.Id] = model.Edits;
        }

        foreach (var id in _appliedEdits.Keys.Where(id => scene.Find(id) is not { Tree: not null }).ToList())
        {
            _appliedEdits.Remove(id);
        }

        // Moves (M13): each loaded model's nodes whose placements differ from what the viewer has.
        var moves = new List<(ModelId Id, int Node, Matrix4d Placement)>();
        foreach (var model in scene.Models.Where(static model => model.Tree is not null))
        {
            var applied = _appliedPlacements.TryGetValue(model.Id, out var known) ? known : [];
            if (!ReferenceEquals(applied, model.Placements))
            {
                moves.AddRange(model.Placements
                    .Where(item => !applied.TryGetValue(item.Key, out var sent) || !sent.Equals(item.Value))
                    .OrderBy(static item => item.Key)
                    .Select(item => (model.Id, item.Key, item.Value)));
                _appliedPlacements[model.Id] = model.Placements;
            }
        }

        foreach (var id in _appliedPlacements.Keys.Where(id => scene.Find(id) is not { Tree: not null }).ToList())
        {
            _appliedPlacements.Remove(id);
        }

        var moveTarget = scene.Moving is null ? null : scene.MoveTarget;
        var moveTool = MoveToolKey(scene.Moving, moveTarget, scene.Frame);
        var moveToolChanged = moveTool != _appliedMoveTool;
        _appliedMoveTool = moveTool;
        var originFrames = scene.OriginFrameTargets;
        var originFramesKey = string.Join(';', originFrames);
        var originFramesChanged = originFramesKey != _appliedOriginFrames;
        _appliedOriginFrames = originFramesKey;

        List<ModelId> ids = [.. scene.Models.Select(static model => model.Id)];
        var order = string.Join(',', ids);
        var orderChanged = order != _appliedOrder;
        _appliedOrder = order;

        var selectionMode = scene.Mode;
        var selectionModeChanged = selectionMode != _appliedSelectionMode;
        _appliedSelectionMode = selectionMode;
        var addMode = scene.AddMode;
        var addModeChanged = addMode != _appliedAddMode;
        _appliedAddMode = addMode;
        var featuresToRestore = scene.TakeFeaturesToRestore();
        var measureMode = scene.MeasureMode;
        var fromContext = scene.TakeMeasureFromContext();
        var fit = scene.TakeFitRequest();
        var modeChanged = measureMode != _appliedMeasureMode || fromContext;
        _appliedMeasureMode = measureMode;

        // The viewer takes the changes in the order they were made, even when a large edit yields below.
        var previous = _sending;
        var done = new TaskCompletionSource();
        _sending = done.Task;
        try
        {
            await previous;
            if (orderChanged)
            {
                await viewer.SetModelOrderAsync(ids);
            }

            if (selectionModeChanged)
            {
                await viewer.SetSelectionModeAsync(selectionMode);
            }

            if (addModeChanged)
            {
                await viewer.SetAddModeAsync(addMode);
            }

            // The viewer's share of an edit goes in a task after .NET's (D199): for Expand all of the
            // large plant both took a quarter of a second together.
            if (edits.Count > 0)
            {
                await Task.Yield();
            }

            foreach (var (id, modelEdits) in edits)
            {
                if (await viewer.SetStructureAsync(id, modelEdits) is { } stats)
                {
                    scene.ReportStats(id, stats);
                }
            }

            // An edit's selection goes in a task of its own (D199): after Expand all of the large plant,
            // both together took a quarter of a second.
            if (edits.Count > 0 && pending.Count > 0)
            {
                await Task.Yield();
            }

            foreach (var model in pending)
            {
                await viewer.SetPartStateAsync(model.Id, model.Hidden, model.Selected);
            }

            // An undone or redone selection's features (M17, D219), after the mode that clears them.
            if (featuresToRestore is not null)
            {
                await viewer.RestoreFeaturesAsync(featuresToRestore);
            }

            if (fit)
            {
                await viewer.FitAllAsync(); // after Isolate, once the viewer hides the rest
            }

            foreach (var (id, node, placement) in moves)
            {
                await viewer.SetPlacementAsync(id, node, placement);
            }

            if (moveToolChanged)
            {
                await viewer.SetMoveToolAsync(scene.Moving, moveTarget, scene.Frame);
            }

            if (originFramesChanged)
            {
                await viewer.SetOriginFramesAsync(originFrames);
            }

            if (modeChanged)
            {
                await viewer.SetMeasureModeAsync(measureMode, fromContext);
            }
        }
        catch (JSDisconnectedException)
        {
            // The page is going away.
        }
        catch (JSException exception)
        {
            // Nothing awaits this, so a failure would otherwise go unseen (M14 found one).
            Console.Error.WriteLine($"J3D: the viewer couldn't apply a change to the scene: {exception.Message}");
        }
        finally
        {
            done.SetResult();
        }
    }

    private static string MoveToolKey(MoveMode? mode, (ModelId Id, int Node)? target, MoveFrame frame) => $"{mode} {target} {frame}";

    /// <summary>
    /// The viewer reports its capabilities while it starts, so either may be known first. Once both
    /// are, the models kept from the last visit come back (D82).
    /// </summary>
    private void AttachToSession()
    {
        if (_viewer is not null && Capabilities is not null)
        {
            session.Attach(_viewer, Capabilities);
            if (!_restoreStarted)
            {
                _restoreStarted = true;
                _ = RestoreAsync(_viewer);
            }
        }
    }
}
