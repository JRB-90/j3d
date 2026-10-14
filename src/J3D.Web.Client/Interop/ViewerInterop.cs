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

    /// <summary>Cancels an import, deletes a loaded model or dismisses a failed one; the viewer then reports it removed.</summary>
    public ValueTask RemoveModelAsync(ModelId id) => _viewer.InvokeVoidAsync("removeModel", id.Value);

    /// <summary>Frames every model, keeping the view direction.</summary>
    public ValueTask FitAllAsync() => _viewer.InvokeVoidAsync("fitAll");

    /// <summary>Switches the camera, keeping the framing.</summary>
    public ValueTask SetProjectionAsync(Projection projection) => _viewer.InvokeVoidAsync("setProjection", projection);

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
