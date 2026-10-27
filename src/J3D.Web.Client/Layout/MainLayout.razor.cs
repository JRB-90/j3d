using J3D.Web.Client.Components;
using J3D.Web.Client.State;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Layout;

/// <summary>
/// The app shell: app bar (toolbar and About), the model drawer, and the viewport. Since M19 it follows
/// the page's layout (<see cref="ShellState"/>): compact on a phone or a tablet held upright, where the
/// drawer slides over the view (D234, D238).
/// </summary>
public sealed partial class MainLayout(IDialogService dialogs, ShellState shell, IJSRuntime js) : IDisposable
{
    private static readonly DialogOptions AboutOptions = new()
    {
        MaxWidth = MaxWidth.Medium,
        FullWidth = true,
        CloseOnEscapeKey = true,
    };

    private ShellState Shell => shell;

    /// <summary>Whether the drawer shows in the layout the page has now.</summary>
    private bool DrawerShown => shell.IsCompact ? shell.CompactDrawerOpen : shell.DesktopDrawerOpen;

    private string DrawerClass => shell.CompactDrawerOpen ? "j3d-drawer j3d-drawer--compact-open" : "j3d-drawer";

    protected override void OnInitialized() => shell.Changed += OnShellChanged;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            await shell.StartAsync(js);
        }
    }

    private void OnShellChanged() => _ = InvokeAsync(StateHasChanged);

    private Task<IDialogReference> OpenAboutAsync() => dialogs.ShowAsync<AboutDialog>("About J3D", AboutOptions);

    public void Dispose() => shell.Changed -= OnShellChanged;
}
