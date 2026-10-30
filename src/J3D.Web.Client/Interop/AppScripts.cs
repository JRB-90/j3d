using Microsoft.JSInterop;

namespace J3D.Web.Client.Interop;

/// <summary>
/// The app's own browser code (scripts/src/index.ts), which J3D.Blazor knows nothing of: the tree's drag
/// and keys, Escape on a menu, and the clipboard. Its module is imported on first use, so never while
/// prerendering.
/// </summary>
public sealed class AppScripts(IJSRuntime js) : IAsyncDisposable
{
    internal const string ModulePath = "./app/j3d-app.js";

    private Task<IJSObjectReference>? _module;

    private Task<IJSObjectReference> Module => _module ??= js.InvokeAsync<IJSObjectReference>("import", ModulePath).AsTask();

    /// <summary>
    /// What the page does around the viewer; dispose what it returns to stop. <paramref name="callbacks"/>
    /// takes <c>OnTreeDrop</c>, and <paramref name="openMenu"/> is the selector for a menu that's open.
    /// </summary>
    public async Task<IJSObjectReference> InstallPageAsync<TCallbacks>(DotNetObjectReference<TCallbacks> callbacks, string openMenu)
        where TCallbacks : class =>
        await (await Module).InvokeAsync<IJSObjectReference>("installPage", callbacks, openMenu);

    /// <summary>Copies text to the clipboard: a measurement's value (D87).</summary>
    public async Task CopyTextAsync(string text) => await (await Module).InvokeVoidAsync("copyText", text);

    /// <summary>
    /// Scrolls a virtualised tree's row into view by its index (D96, D198), and focuses it once it's drawn
    /// if asked (D202). <paramref name="tree"/> and <paramref name="row"/> are CSS selectors.
    /// </summary>
    public async Task RevealTreeRowAsync(string tree, int index, int rowHeight, string row, bool focus) =>
        await (await Module).InvokeVoidAsync("revealTreeRow", tree, index, rowHeight, row, focus);

    public async ValueTask DisposeAsync()
    {
        if (_module is not null)
        {
            try
            {
                await (await _module).DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
                // The page is going away.
            }
        }
    }
}
