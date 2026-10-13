using J3D.Web.Client.Interop;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace J3D.Web.Client.Components;

/// <summary>
/// Hosts the Three.js viewer. The viewer, its camera controls and all model data live in the
/// TypeScript module; this component owns its lifetime and relays callbacks to .NET.
/// </summary>
public sealed partial class Viewport(IJSRuntime js) : IAsyncDisposable
{
    internal const string ModulePath = "./viewer/j3d-viewer.js";

    private ElementReference _host;
    private IJSObjectReference? _module;
    private IJSObjectReference? _viewer;
    private DotNetObjectReference<Viewport>? _selfReference;

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
        _module = await js.InvokeAsync<IJSObjectReference>("import", ModulePath);
        _viewer = await _module.InvokeAsync<IJSObjectReference>("createViewer", _host, _selfReference);
    }

    [JSInvokable]
    public async Task OnViewerReady(ViewerCapabilities capabilities)
    {
        Capabilities = capabilities;
        await OnReady.InvokeAsync(capabilities);
        StateHasChanged();
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_viewer is not null)
            {
                await _viewer.InvokeVoidAsync("dispose");
                await _viewer.DisposeAsync();
            }

            if (_module is not null)
            {
                await _module.DisposeAsync();
            }
        }
        catch (JSDisconnectedException)
        {
            // The page is going away; there is nothing left to clean up on the JS side.
        }

        _selfReference?.Dispose();
    }
}
