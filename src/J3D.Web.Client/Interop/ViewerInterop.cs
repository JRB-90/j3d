using J3D.Web.Client.Models;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace J3D.Web.Client.Interop;

/// <summary>
/// Typed wrapper around the TypeScript viewer (src/J3D.Viewer/src/index.ts): the only code that
/// calls into it (docs/plan.md §6.4). The viewer calls back through the
/// <see cref="DotNetObjectReference{TValue}"/> it was created with.
/// </summary>
public sealed class ViewerInterop : IAsyncDisposable
{
    internal const string ModulePath = "./viewer/j3d-viewer.js";

    private readonly IJSObjectReference _module;
    private readonly IJSObjectReference _viewer;

    private ViewerInterop(IJSObjectReference module, IJSObjectReference viewer)
    {
        _module = module;
        _viewer = viewer;
    }

    /// <summary>Loads the viewer module and starts the viewer inside <paramref name="host"/>.</summary>
    public static async Task<ViewerInterop> CreateAsync<TCallbacks>(
        IJSRuntime js,
        ElementReference host,
        DotNetObjectReference<TCallbacks> callbacks)
        where TCallbacks : class
    {
        var module = await js.InvokeAsync<IJSObjectReference>("import", ModulePath);
        var viewer = await module.InvokeAsync<IJSObjectReference>("createViewer", host, callbacks);
        return new ViewerInterop(module, viewer);
    }

    /// <summary>Imports the files picked in <paramref name="input"/>; the viewer sets its <c>accept</c> list.</summary>
    public ValueTask AttachFileInputAsync(ElementReference input) => _viewer.InvokeVoidAsync("attachFileInput", input);

    /// <summary>
    /// Cancels an import, deletes a loaded model or dismisses a failed one, for good, with its kept files;
    /// the viewer then reports it removed.
    /// </summary>
    public ValueTask RemoveModelAsync(ModelId id) => _viewer.InvokeVoidAsync("removeModel", id.Value);

    /// <summary>Deletes a model an undo can bring back: the viewer frees it, keeping its files and measurements (M8, D84).</summary>
    public ValueTask DeleteModelAsync(ModelId id) => _viewer.InvokeVoidAsync("removeModel", id.Value, true);

    /// <summary>What was kept when the page opened, once the viewer has put the stored camera back (D82, D111).</summary>
    public ValueTask<StoredScene> RestoreSceneAsync() => _viewer.InvokeAsync<StoredScene>("restoreScene");

    /// <summary>Imports models again from their kept files, under their ids, each with its hidden parts (D117).</summary>
    public ValueTask RestoreModelsAsync(IEnumerable<StoredModel> models)
    {
        StoredModel[] array = [.. models];
        return _viewer.InvokeVoidAsync("restoreModels", (object)array); // one argument, not one per model
    }

    /// <summary>Drops a deleted model's kept files and measurements: no undo can bring it back now.</summary>
    public ValueTask ForgetModelAsync(ModelId id) => _viewer.InvokeVoidAsync("forgetModel", id.Value);

    /// <summary>Removes every model and everything kept (D110).</summary>
    public ValueTask ClearAllAsync() => _viewer.InvokeVoidAsync("clearAll");

    /// <summary>The models the list shows, in order, for the viewer's manifest (D117).</summary>
    public ValueTask SetModelOrderAsync(IEnumerable<ModelId> ids)
    {
        string[] array = [.. ids.Select(static id => id.Value)];
        return _viewer.InvokeVoidAsync("setModelOrder", (object)array);
    }

    /// <summary>Frames every model, keeping the view direction.</summary>
    public ValueTask FitAllAsync() => _viewer.InvokeVoidAsync("fitAll");

    /// <summary>Switches the camera, keeping the framing.</summary>
    public ValueTask SetProjectionAsync(Projection projection) => _viewer.InvokeVoidAsync("setProjection", projection);

    /// <summary>Applies a model's hidden and selected part nodes (decision D95).</summary>
    public ValueTask SetPartStateAsync(ModelId id, IEnumerable<int> hidden, IEnumerable<int> selected) =>
        _viewer.InvokeVoidAsync("setPartState", id.Value, hidden.Order().ToArray(), selected.Order().ToArray());

    /// <summary>
    /// Turns the Measure tool on or off (M7, D79), from the entity under the last right click when
    /// <paramref name="fromContext"/> ("Measure from here", D164), else from the last selected feature (D147).
    /// </summary>
    public ValueTask SetMeasureModeAsync(bool active, bool fromContext = false) =>
        _viewer.InvokeVoidAsync("setMeasureMode", active, fromContext);

    /// <summary>What a click selects: models, objects or features (M12, D146).</summary>
    public ValueTask SetSelectionModeAsync(SelectMode mode) => _viewer.InvokeVoidAsync("setSelectionMode", mode);

    /// <summary>Drops the features selected in Feature mode, which the viewer holds (D146).</summary>
    public ValueTask ClearFeaturesAsync() => _viewer.InvokeVoidAsync("clearFeatures");

    /// <summary>The Move tool (M13, D149): its mode (null: off), the one object it moves, and the frame its triad and fields use (D148).</summary>
    public ValueTask SetMoveToolAsync(MoveMode? mode, (ModelId Id, int Node)? target, MoveFrame frame) =>
        _viewer.InvokeVoidAsync("setMoveTool", mode, target is { } moved ? new MoveTargetRef(moved.Id, moved.Node) : null, frame);

    /// <summary>A node (or a model, node -1) to a placement in its parent's frame (D145): typed, undone or redone.</summary>
    public ValueTask SetPlacementAsync(ModelId id, int node, Matrix4d placement) =>
        _viewer.InvokeVoidAsync("setPlacement", id.Value, node, placement.ToArray());

    /// <summary>The objects to draw origin frames at (D150), or none.</summary>
    public ValueTask SetOriginFramesAsync(IEnumerable<(ModelId Id, int Node)> targets)
    {
        var array = targets.Select(static target => new MoveTargetRef(target.Id, target.Node)).ToArray();
        return _viewer.InvokeVoidAsync("setOriginFrames", (object)array); // one argument, not one per target
    }

    /// <summary>Saves the visible scene, or only the selection, as GLB or STL: a browser download (M9, D119, D120).</summary>
    public ValueTask<ExportOutcome> ExportMeshAsync(MeshExportFormat format, bool selection) =>
        _viewer.InvokeAsync<ExportOutcome>("exportMesh", format, selection);

    /// <summary>
    /// Saves a BREP model as imported, as STEP or BREP (D83). Its progress arrives through
    /// <c>OnExportProgress</c> until it ends (D125).
    /// </summary>
    public ValueTask<ExportOutcome> ExportModelAsync(ModelId id, BrepExportFormat format) =>
        _viewer.InvokeAsync<ExportOutcome>("exportModel", id.Value, format);

    /// <summary>Stops a model's STEP or BREP export, which then ends cancelled.</summary>
    public ValueTask CancelExportAsync(ModelId id) => _viewer.InvokeVoidAsync("cancelExport", id.Value);

    /// <summary>Copies text to the clipboard: a measurement's value (D87).</summary>
    public ValueTask CopyTextAsync(string text) => _module.InvokeVoidAsync("copyText", text);

    /// <summary>Scrolls the element a CSS selector finds into view, if it isn't already (D96).</summary>
    public ValueTask ScrollIntoViewAsync(string selector) => _module.InvokeVoidAsync("scrollIntoView", selector);

    public async ValueTask DisposeAsync()
    {
        try
        {
            await _viewer.InvokeVoidAsync("dispose");
            await _viewer.DisposeAsync();
            await _module.DisposeAsync();
        }
        catch (JSDisconnectedException)
        {
            // The page is going away; there is nothing left to clean up on the JS side.
        }
    }
}
