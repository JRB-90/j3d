using J3D.Web.Client.Components;
using MudBlazor;

namespace J3D.Web.Client.Layout;

/// <summary>The app shell: app bar (toolbar and About), the model drawer, and the viewport.</summary>
public sealed partial class MainLayout(IDialogService dialogs)
{
    private static readonly DialogOptions AboutOptions = new()
    {
        MaxWidth = MaxWidth.Medium,
        FullWidth = true,
        CloseOnEscapeKey = true,
    };

    private bool _drawerOpen = true;

    private void ToggleDrawer() => _drawerOpen = !_drawerOpen;

    private Task<IDialogReference> OpenAboutAsync() => dialogs.ShowAsync<AboutDialog>("About J3D", AboutOptions);
}
