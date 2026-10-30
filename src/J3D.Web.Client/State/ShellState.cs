using J3D.Web.Client.Interop;
using Microsoft.JSInterop;

namespace J3D.Web.Client.State;

/// <summary>
/// The app's layout (M19): compact below 900 px wide or 500 px tall (D234), touch where the main pointer
/// is a finger (D239), and the model drawer, which sits beside the view in the desktop layout and slides
/// over it in the compact one, closed at start and after a tap on a tree row (D238). Until the page
/// reports (while prerendering, and before the first render) it's the desktop layout with a mouse;
/// app.css lays the page out by the same media queries meanwhile, so a phone never shows the desktop
/// layout. Scoped, so one per browser tab.
/// </summary>
public sealed class ShellState : IAsyncDisposable
{
    private DotNetObjectReference<ShellState>? _self;
    private IJSObjectReference? _watch;
    private bool _desktopDrawerOpen = true;
    private bool _compactDrawerOpen;

    /// <summary>Raised when the layout changes, or the drawer opens or closes.</summary>
    public event Action? Changed;

    /// <summary>A phone either way up, or a tablet held upright (D234).</summary>
    public bool IsCompact { get; private set; }

    /// <summary>The main pointer is a finger (D239): 48 px targets, the Add toggle and long presses.</summary>
    public bool IsTouch { get; private set; }

    /// <summary>In the desktop layout the drawer stays open beside the view until its button closes it.</summary>
    public bool DesktopDrawerOpen => _desktopDrawerOpen;

    /// <summary>In the compact layout the drawer is open over the view (D238).</summary>
    public bool CompactDrawerOpen => _compactDrawerOpen;

    /// <summary>Starts following the page's layout; the first report comes straight back.</summary>
    public async Task StartAsync(IJSRuntime js)
    {
        if (_self is not null)
        {
            return;
        }

        _self = DotNetObjectReference.Create(this);
        var module = await js.InvokeAsync<IJSObjectReference>("import", AppScripts.ModulePath);
        _watch = await module.InvokeAsync<IJSObjectReference>("watchLayout", _self);
    }

    /// <summary>The app bar's menu button: the drawer in whichever layout is showing.</summary>
    public void ToggleDrawer()
    {
        if (IsCompact)
        {
            _compactDrawerOpen = !_compactDrawerOpen;
        }
        else
        {
            _desktopDrawerOpen = !_desktopDrawerOpen;
        }

        Changed?.Invoke();
    }

    /// <summary>The backdrop tapped, or a swipe: the drawer over the view closes (D238).</summary>
    public void CloseDrawer()
    {
        if (_compactDrawerOpen)
        {
            _compactDrawerOpen = false;
            Changed?.Invoke();
        }
    }

    /// <summary>
    /// A tap on a tree row selected something: in the compact layout the drawer closes so the part can
    /// be seen, unless Add is on and more are to be picked (D238).
    /// </summary>
    public void Picked(bool adding)
    {
        if (IsCompact && !adding)
        {
            CloseDrawer();
        }
    }

    [JSInvokable]
    public void OnLayoutChanged(bool compact, bool touch)
    {
        if (compact == IsCompact && touch == IsTouch)
        {
            return;
        }

        if (compact != IsCompact)
        {
            // Each layout starts its drawer as it starts the page: open beside the view, closed over it.
            _compactDrawerOpen = false;
        }

        IsCompact = compact;
        IsTouch = touch;
        Changed?.Invoke();
    }

    [JSInvokable]
    public void OnDrawerSwiped() => CloseDrawer();

    public async ValueTask DisposeAsync()
    {
        if (_watch is not null)
        {
            try
            {
                await _watch.InvokeVoidAsync("dispose");
                await _watch.DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
                // The page is going away.
            }
        }

        _self?.Dispose();
    }
}
