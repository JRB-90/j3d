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

    internal void Attach(ViewerInterop viewer, ViewerCapabilities capabilities)
    {
        _viewer = viewer;
        Capabilities = capabilities;
        Projection = Projection.Orthographic; // a new viewer starts orthographic
        Changed?.Invoke();
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
