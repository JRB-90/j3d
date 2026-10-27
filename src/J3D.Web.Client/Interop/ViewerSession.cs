using J3D.Web.Client.Models;
using Microsoft.AspNetCore.Components;

namespace J3D.Web.Client.Interop;

/// <summary>
/// The running viewer, shared between the <c>Viewport</c> that creates it and the <c>Toolbar</c> in
/// the app bar (decision D48). Scoped, so one per browser tab under WebAssembly and one per request
/// while prerendering, where the viewer never starts.
/// </summary>
public sealed class ViewerSession
{
    private ViewerInterop? _viewer;

    /// <summary>Raised when the viewer starts or stops, or the projection changes.</summary>
    public event Action? Changed;

    public ViewerCapabilities? Capabilities { get; private set; }

    public Projection Projection { get; private set; } = Projection.Orthographic;

    /// <summary>The viewer is running and can draw (the browser has WebGL2).</summary>
    public bool IsReady => _viewer is not null && Capabilities is { IsSupported: true };

    public async Task AttachFileInputAsync(ElementReference input)
    {
        if (_viewer is not null)
        {
            await _viewer.AttachFileInputAsync(input);
        }
    }

    /// <summary>
    /// Removes a model whatever its state. Works without WebGL2 too, since imports still run; the
    /// list updates when the viewer reports the model removed.
    /// </summary>
    public async Task RemoveModelAsync(ModelId id)
    {
        if (_viewer is not null)
        {
            await _viewer.RemoveModelAsync(id);
        }
    }

    public async Task FitAllAsync()
    {
        if (IsReady)
        {
            await _viewer!.FitAllAsync();
        }
    }

    public async Task SetProjectionAsync(Projection projection)
    {
        if (IsReady && projection != Projection)
        {
            await _viewer!.SetProjectionAsync(projection);
            Projection = projection;
            Changed?.Invoke();
        }
    }

    /// <summary>Scrolls a tree's row into view, e.g. a node a 3D pick revealed (D96), focusing it if asked (D202).</summary>
    public async Task RevealTreeRowAsync(string tree, int index, int rowHeight, string row, bool focus)
    {
        if (_viewer is not null)
        {
            await _viewer.RevealTreeRowAsync(tree, index, rowHeight, row, focus);
        }
    }

    /// <summary>Saves the visible scene, or the selection, as GLB or STL (M9). Null without a viewer.</summary>
    public async Task<ExportOutcome?> ExportMeshAsync(MeshExportFormat format, bool selection) =>
        IsReady ? await _viewer!.ExportMeshAsync(format, selection) : null;

    /// <summary>Saves a BREP model, or its selection (M15, D155), as STEP or BREP (M9). Null without a viewer.</summary>
    public async Task<ExportOutcome?> ExportModelAsync(ModelId id, BrepExportFormat format, bool selection = false) =>
        _viewer is not null ? await _viewer.ExportModelAsync(id, format, selection) : null;

    /// <summary>Expands file parts of a BREP model (M15, D154). Null without a viewer.</summary>
    public async Task<ExpandOutcome?> ExpandPartsAsync(ModelId id, IReadOnlyList<int> fileNodes) =>
        IsReady ? await _viewer!.ExpandPartsAsync(id, fileNodes) : null;

    /// <summary>Moves or copies objects to another model (M18): the arrival. Null without a viewer.</summary>
    public async Task<TransferOutcome?> TransferAsync(ModelId source, IReadOnlyList<int> nodes, ModelId target) =>
        IsReady ? await _viewer!.TransferAsync(source, nodes, target) : null;

    /// <summary>Stops a model's STEP or BREP export (D125).</summary>
    public async Task CancelExportAsync(ModelId id)
    {
        if (_viewer is not null)
        {
            await _viewer.CancelExportAsync(id);
        }
    }

    /// <summary>Copies a measurement's value to the clipboard (M7).</summary>
    public async Task CopyTextAsync(string text)
    {
        if (_viewer is not null)
        {
            await _viewer.CopyTextAsync(text);
        }
    }

    internal void Attach(ViewerInterop viewer, ViewerCapabilities capabilities)
    {
        _viewer = viewer;
        Capabilities = capabilities;
        Projection = Projection.Orthographic; // a new viewer starts orthographic
        Changed?.Invoke();
    }

    /// <summary>The viewer put back the camera kept from the last visit, in this projection (D111).</summary>
    internal void RestoreProjection(Projection projection)
    {
        if (projection != Projection)
        {
            Projection = projection;
            Changed?.Invoke();
        }
    }

    internal void Detach(ViewerInterop viewer)
    {
        if (ReferenceEquals(_viewer, viewer))
        {
            _viewer = null;
            Capabilities = null;
            Changed?.Invoke();
        }
    }
}
