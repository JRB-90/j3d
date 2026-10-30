using J3D.Blazor;
using J3D.Web.Client.Interop;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// J3D's <see cref="J3DViewer"/>. J3D is the page: its keys work wherever they're pressed, and its models
/// are kept (D256). This shows the library's notices as snackbars (decisions D54, D271) and starts what
/// the app's own browser code does around the viewer.
/// </summary>
public sealed partial class Viewport(SceneState scene, AppScripts scripts, ISnackbar snackbar) : IAsyncDisposable
{
    /// <summary>
    /// A menu open in MudBlazor's popover layer: its keys are the menu's (D273). Tooltips use the same
    /// layer, so only a list counts.
    /// </summary>
    private const string OpenMenu = ".mud-popover-open .mud-list";

    private ViewerCapabilities? _capabilities;
    private DotNetObjectReference<Viewport>? _selfReference;
    private IJSObjectReference? _page;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            _selfReference = DotNetObjectReference.Create(this);
            _page = await scripts.InstallPageAsync(_selfReference, OpenMenu);
        }
    }

    /// <summary>
    /// A tree node (<c>model:node</c>) dropped on an assembly or a model's name (M14, D182): moved there, or
    /// copied with Ctrl; since M18 into another model too (D210).
    /// </summary>
    [JSInvokable]
    public void OnTreeDrop(string source, string modelId, int target, bool copy)
    {
        var colon = source.LastIndexOf(':');
        if (colon > 0 && int.TryParse(source.AsSpan(colon + 1), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var node))
        {
            scene.Drop(new ModelId(source[..colon]), node, new ModelId(modelId), target, copy);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_page is not null)
        {
            try
            {
                await _page.InvokeVoidAsync("dispose");
                await _page.DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
                // The page is going away.
            }
        }

        _selfReference?.Dispose();
    }

    private void OnViewerReady(ViewerCapabilities capabilities) => _capabilities = capabilities;

    private void Show(ViewerNotice notice)
    {
        var message = notice.Kind == NoticeKind.OtherTab
            ? "J3D is open in another tab, so the models you import here won't be kept for your next visit."
            : notice.Message;
        var severity = notice.Severity switch
        {
            NoticeSeverity.Error => Severity.Error,
            NoticeSeverity.Warning => Severity.Warning,
            _ => Severity.Info,
        };

        snackbar.Add(message, severity, IsBrief(notice.Kind) ? null : static options => options.VisibleStateDuration = 10_000);
    }

    /// <summary>A passing remark. What's lost or won't work stays up longer.</summary>
    internal static bool IsBrief(NoticeKind kind) =>
        kind is NoticeKind.FileSkipped or NoticeKind.MeasureFailed or NoticeKind.KeepingUnavailable or NoticeKind.TransferRefused;
}
