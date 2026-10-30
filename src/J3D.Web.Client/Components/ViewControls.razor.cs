using J3D.Blazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// The orthographic and perspective switch under the view cube (D19). It keeps the framing; the viewer
/// does the switching.
/// </summary>
public sealed partial class ViewControls(ViewerSession session) : IDisposable
{
    private ViewerSession Session => session;

    protected override void OnInitialized() => session.Changed += OnSessionChanged;

    public void Dispose() => session.Changed -= OnSessionChanged;

    private string Pressed(Projection projection) => session.Projection == projection ? "true" : "false";

    private void OnSessionChanged() => _ = InvokeAsync(StateHasChanged);

    private Task SetProjectionAsync(Projection projection) => session.SetProjectionAsync(projection);
}
