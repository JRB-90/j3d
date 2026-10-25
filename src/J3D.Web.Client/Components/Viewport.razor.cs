using System.Collections.Immutable;
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
/// selection, visibility and undo, and applies each model's parts back to the viewer (D95). Since M8
/// it lists the models kept from the last visit, and has the viewer delete, restore and forget models
/// as the scene asks, and keep their order (D117). Since M12 it sends the selection mode, relays the
/// selected features, the Measure tool's reference and result, and right clicks for the context menu.
/// </summary>
public sealed partial class Viewport(IJSRuntime js, ViewerSession session, SceneState scene, ISnackbar snackbar) : IAsyncDisposable
{
    private ElementReference _host;
    private ViewerInterop? _viewer;
    private DotNetObjectReference<Viewport>? _selfReference;
    private bool _disposed;
    private bool _restoreStarted;

    /// <summary>What the viewer was last told of the Measure tool and the selection mode, so only changes are sent.</summary>
    private bool _appliedMeasureMode;
    private SelectMode _appliedSelectionMode = SelectMode.Objects;

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
        scene.DeleteRequested += OnDeleteRequested;
        scene.RestoreRequested += OnRestoreRequested;
        scene.ForgetRequested += OnForgetRequested;
        scene.ClearAllRequested += OnClearAllRequested;
        scene.ClearFeaturesRequested += OnClearFeaturesRequested;
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

    /// <summary>
    /// A key the viewer caught (D99, D162): Esc, H, I, Shift+H, M, Ctrl+Z, Ctrl+Y, 1, 2 and 3; W, E and O
    /// (M13); Ctrl+X, Ctrl+C, Ctrl+V, Delete, Ctrl+G, Ctrl+Shift+G and F2 (M14).
    /// </summary>
    [JSInvokable]
    public void OnViewerCommand(string command)
    {
        switch (command)
        {
            case "clearSelection":
                scene.Escape();
                break;
            case "selectModels":
                scene.SetSelectionMode(SelectMode.Models);
                break;
            case "selectObjects":
                scene.SetSelectionMode(SelectMode.Objects);
                break;
            case "selectFeatures":
                scene.SetSelectionMode(SelectMode.Features);
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
            case "measure":
                scene.ToggleMeasureMode();
                break;
            case "moveTranslate":
                scene.SetMoveMode(MoveMode.Translate);
                break;
            case "moveRotate":
                scene.SetMoveMode(MoveMode.Rotate);
                break;
            case "originFrames":
                scene.ToggleOriginFrames();
                break;
            case "cut":
                scene.Cut();
                break;
            case "copy":
                scene.Copy();
                break;
            case "paste":
                scene.Paste();
                break;
            case "delete":
                scene.DeleteSelection();
                break;
            case "group":
                scene.Group();
                break;
            case "ungroup":
                scene.Ungroup();
                break;
            case "rename":
                scene.BeginRename();
                break;
        }
    }

    /// <summary>A tree node (<c>model:node</c>) dropped on an assembly or its model's name (M14, D182): moved there, or copied with Ctrl.</summary>
    [JSInvokable]
    public void OnTreeDrop(string source, string modelId, int target, bool copy)
    {
        var colon = source.LastIndexOf(':');
        if (colon > 0 && int.TryParse(source.AsSpan(colon + 1), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var node))
        {
            scene.Drop(new ModelId(modelId), node, target, copy);
        }
    }

    /// <summary>The Move tool's target and where it is, or null (M13, D148).</summary>
    [JSInvokable]
    public void OnMoveTarget(MoveTargetInfo? info) => scene.ReportMoveTarget(info);

    /// <summary>A drag of the triad ended (D149): the viewer shows the target there already, so only the step is recorded.</summary>
    [JSInvokable]
    public void OnMoved(string modelId, int node, double[] before, double[] after)
    {
        var id = new ModelId(modelId);
        var placement = new Matrix4d(after);
        if (scene.Find(id) is { } model)
        {
            _appliedPlacements[id] = (_appliedPlacements.TryGetValue(id, out var applied) ? applied : model.Placements).SetItem(node, placement);
        }

        scene.RecordMove(id, node, new Matrix4d(before), placement);
    }

    /// <summary>The Measure tool's reference, or null when it's gone (D147).</summary>
    [JSInvokable]
    public void OnMeasureReference(MeasureInfo? info) => scene.SetMeasureReference(info);

    /// <summary>The reference against the last click, or null.</summary>
    [JSInvokable]
    public void OnMeasureResult(MeasureInfo? info) => scene.SetMeasureResult(info);

    /// <summary>The features selected in Feature mode (D146).</summary>
    [JSInvokable]
    public void OnFeaturesSelected(FeatureSelection selection) => scene.SetFeatures(selection);

    /// <summary>A right click that didn't drag, on a part or on nothing (D164).</summary>
    [JSInvokable]
    public void OnContextMenu(string? modelId, int node, double x, double y, bool canMeasure) =>
        scene.OpenContextMenu(modelId is null ? null : new ModelId(modelId), node, x, y, canMeasure);

    [JSInvokable]
    public void OnMeasureFailed(string message) => snackbar.Add($"Couldn't measure that: {message}", Severity.Warning);

    /// <summary>How far a model's STEP or BREP export is (D125): a fraction, or null while OCCT writes a STEP file.</summary>
    [JSInvokable]
    public void OnExportProgress(ModelId id, double? fraction) => scene.ReportExportProgress(id, fraction);

    /// <summary>A loaded model's files couldn't be kept for the next visit (D115); it stays loaded.</summary>
    [JSInvokable]
    public void OnModelNotKept(ModelId id, bool full)
    {
        var fileName = scene.Find(id)?.Summary.FileName ?? "a model";
        scene.MarkNotKept(id, full);
        snackbar.Add(
            full
                ? $"Couldn't keep {fileName} for your next visit: the browser's storage is full. It stays open until the page is closed."
                : $"Couldn't keep {fileName} for your next visit. It stays open until the page is closed.",
            Severity.Warning,
            options => options.VisibleStateDuration = 10_000);
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        scene.Changed -= OnSceneChanged;
        scene.DeleteRequested -= OnDeleteRequested;
        scene.RestoreRequested -= OnRestoreRequested;
        scene.ForgetRequested -= OnForgetRequested;
        scene.ClearAllRequested -= OnClearAllRequested;
        scene.ClearFeaturesRequested -= OnClearFeaturesRequested;
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

    private void OnDeleteRequested(ModelId id) => _ = CallViewerAsync(viewer => viewer.DeleteModelAsync(id));

    private void OnRestoreRequested(IReadOnlyList<ModelEntry> models) =>
        _ = CallViewerAsync(viewer => viewer.RestoreModelsAsync(models.Select(static model => new StoredModel(model.Summary, [.. model.Hidden.Order()]))));

    private void OnForgetRequested(ModelId id) => _ = CallViewerAsync(viewer => viewer.ForgetModelAsync(id));

    private void OnClearAllRequested() => _ = CallViewerAsync(static viewer => viewer.ClearAllAsync());

    private void OnClearFeaturesRequested() => _ = CallViewerAsync(static viewer => viewer.ClearFeaturesAsync());

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

        switch (stored.Status)
        {
            case StoreStatus.OtherTab:
                snackbar.Add(
                    "J3D is open in another tab, so the models you import here won't be kept for your next visit.",
                    Severity.Info,
                    options => options.VisibleStateDuration = 10_000);
                break;
            case StoreStatus.Unavailable:
                snackbar.Add("This browser can't keep models for your next visit.", Severity.Info);
                break;
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
        var measureMode = scene.MeasureMode;
        var fromContext = scene.TakeMeasureFromContext();
        var fit = scene.TakeFitRequest();
        var modeChanged = measureMode != _appliedMeasureMode || fromContext;
        _appliedMeasureMode = measureMode;

        try
        {
            if (orderChanged)
            {
                await viewer.SetModelOrderAsync(ids);
            }

            if (selectionModeChanged)
            {
                await viewer.SetSelectionModeAsync(selectionMode);
            }

            foreach (var (id, modelEdits) in edits)
            {
                if (await viewer.SetStructureAsync(id, modelEdits.ToDto()) is { } stats)
                {
                    scene.ReportStats(id, stats);
                }
            }

            foreach (var model in pending)
            {
                await viewer.SetPartStateAsync(model.Id, model.Hidden, model.Selected);
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
