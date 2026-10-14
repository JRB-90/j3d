using J3D.Web.Client.Interop;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace J3D.Web.Client.Components;

/// <summary>
/// Hosts the Three.js viewer. The viewer, its camera controls and all model data live in the
/// TypeScript module; this component owns its lifetime, relays callbacks to .NET and shares it with
/// the toolbar through the <see cref="ViewerSession"/>.
/// </summary>
public sealed partial class Viewport(IJSRuntime js, ViewerSession session) : IAsyncDisposable
{
    private ElementReference _host;
    private ViewerInterop? _viewer;
    private DotNetObjectReference<Viewport>? _selfReference;
    private bool _disposed;

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

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        if (_viewer is not null)
        {
            session.Detach(_viewer);
            await _viewer.DisposeAsync();
            _viewer = null;
        }

        _selfReference?.Dispose();
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
