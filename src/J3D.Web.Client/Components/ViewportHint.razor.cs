using J3D.Web.Client.Interop;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Components;

/// <summary>
/// What to do in an empty view: drop files or Import, which formats, and how the mouse moves the view
/// (right-drag turns it, unlike most web viewers; D16). Shown once the viewer runs and no model is open.
/// On a touch screen (M19, D243) it says to use Import and how fingers move the view.
/// </summary>
public sealed partial class ViewportHint(ViewerSession session, SceneState scene, ShellState shell) : IDisposable
{
    private bool IsVisible => session.IsReady && scene.Models.IsEmpty;

    private ShellState Shell => shell;

    protected override void OnInitialized()
    {
        session.Changed += OnChanged;
        scene.Changed += OnChanged;
        shell.Changed += OnChanged;
    }

    public void Dispose()
    {
        session.Changed -= OnChanged;
        scene.Changed -= OnChanged;
        shell.Changed -= OnChanged;
    }

    private void OnChanged() => _ = InvokeAsync(StateHasChanged);
}
