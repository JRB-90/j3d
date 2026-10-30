using Microsoft.JSInterop;

namespace J3D.Blazor;

/// <summary>
/// What the viewer calls back: its reports go to the <see cref="SceneState"/>, which owns selection,
/// visibility and undo (D95), with a notice for what has no place there (D271). Apart from
/// <see cref="J3DViewer"/> because a JS entry point must be public, and these aren't its API (D270).
/// </summary>
internal sealed class ViewerCallbacks(J3DViewer viewer, ViewerSession session, SceneState scene)
{
    [JSInvokable]
    public Task OnViewerReady(ViewerCapabilities capabilities) => viewer.ReportReadyAsync(capabilities);

    [JSInvokable]
    public void OnModelQueued(ModelSummary summary) => scene.Add(summary);

    [JSInvokable]
    public void OnModelProgress(ModelId id, ImportPhase phase, double? fraction) => scene.ReportProgress(id, phase, fraction);

    [JSInvokable]
    public void OnModelLoaded(ModelId id, ModelLoadedInfo info, byte[] tree, string names, byte[]? edits, string? editNames)
    {
        // Since M16 the tree and a restored model's edits cross packed (D204).
        scene.MarkLoaded(id, info with { Tree = TreeCodec.Decode(tree, names), Edits = edits is null ? null : EditsCodec.Decode(edits, editNames ?? "") });
    }

    [JSInvokable]
    public void OnModelFailed(ModelId id, ImportError error)
    {
        var fileName = scene.Find(id)?.Summary.FileName ?? "a model";
        scene.MarkFailed(id, error);
        viewer.Notify(new ViewerNotice(NoticeKind.ImportFailed, NoticeSeverity.Error, $"Couldn't import {fileName}: {error.Message}"));
    }

    [JSInvokable]
    public void OnModelRemoved(ModelId id) => scene.Remove(id);

    /// <summary>A file that won't be imported. It has no list item, so the notice is its only report.</summary>
    [JSInvokable]
    public void OnImportRejected(string fileName, string reason) =>
        viewer.Notify(new ViewerNotice(NoticeKind.FileSkipped, NoticeSeverity.Warning, $"Skipped {fileName}: {reason}"));

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

    /// <summary>The Move tool's target and where it is, or null (M13, D148).</summary>
    [JSInvokable]
    public void OnMoveTarget(MoveTargetInfo? info) => scene.ReportMoveTarget(info);

    /// <summary>A drag of the triad ended (D149): the viewer shows the target there already, so only the step is recorded.</summary>
    [JSInvokable]
    public void OnMoved(string modelId, int node, double[] before, double[] after)
    {
        var id = new ModelId(modelId);
        var placement = new Matrix4d(after);
        viewer.ReportMoved(id, node, placement);
        scene.RecordMove(id, node, new Matrix4d(before), placement);
    }

    /// <summary>The Measure tool's reference, or null when it's gone (D147).</summary>
    [JSInvokable]
    public void OnMeasureReference(MeasureInfo? info) => scene.SetMeasureReference(info);

    /// <summary>The reference against the last click, or null.</summary>
    [JSInvokable]
    public void OnMeasureResult(MeasureInfo? info) => scene.SetMeasureResult(info);

    /// <summary>Previous view or Next view changed the projection (M17, D220): the switch under the view cube follows.</summary>
    [JSInvokable]
    public void OnProjectionChanged(Projection projection) => session.RestoreProjection(projection);

    /// <summary>The features selected in Feature mode (D146).</summary>
    [JSInvokable]
    public void OnFeaturesSelected(FeatureSelection selection) => scene.SetFeatures(selection);

    /// <summary>A right click that didn't drag, on a part or on nothing (D164).</summary>
    [JSInvokable]
    public void OnContextMenu(string? modelId, int node, double x, double y, bool canMeasure) =>
        scene.OpenContextMenu(modelId is null ? null : new ModelId(modelId), node, x, y, canMeasure);

    [JSInvokable]
    public void OnMeasureFailed(string message) =>
        viewer.Notify(new ViewerNotice(NoticeKind.MeasureFailed, NoticeSeverity.Warning, $"Couldn't measure that: {message}"));

    /// <summary>How far a model's STEP or BREP export is (D125): a fraction, or null while OCCT writes a STEP file.</summary>
    [JSInvokable]
    public void OnExportProgress(ModelId id, double? fraction) => scene.ReportExportProgress(id, fraction);

    /// <summary>A loaded model's files couldn't be kept for the next visit (D115); it stays loaded.</summary>
    [JSInvokable]
    public void OnModelNotKept(ModelId id, bool full)
    {
        var fileName = scene.Find(id)?.Summary.FileName ?? "a model";
        scene.MarkNotKept(id, full);
        viewer.Notify(new ViewerNotice(
            NoticeKind.ModelNotKept,
            NoticeSeverity.Warning,
            full
                ? $"Couldn't keep {fileName} for your next visit: the browser's storage is full. It stays open until the page is closed."
                : $"Couldn't keep {fileName} for your next visit. It stays open until the page is closed."));
    }
}
