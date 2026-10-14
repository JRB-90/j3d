using J3D.Web.Client.Interop;
using Microsoft.AspNetCore.Components;

namespace J3D.Web.Client.Components;

/// <summary>
/// Import, Fit all and the projection toggle, in the app bar (decision D48). Enabled once the
/// viewer is running with WebGL2.
/// </summary>
public sealed partial class Toolbar(ViewerSession session) : IDisposable
{
    internal const string InputId = "j3d-import-input";

    private ElementReference _input;
    private bool _inputAttached;

    private ViewerSession Session => session;

    protected override void OnInitialized() => session.Changed += OnSessionChanged;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (session.IsReady && !_inputAttached)
        {
            _inputAttached = true;
            await session.AttachFileInputAsync(_input);
        }
    }

    public void Dispose() => session.Changed -= OnSessionChanged;

    private void OnSessionChanged()
    {
        if (!session.IsReady)
        {
            _inputAttached = false; // a new viewer needs the input attaching again
        }

        _ = InvokeAsync(StateHasChanged);
    }

    private Task FitAllAsync() => session.FitAllAsync();

    private Task SetProjectionAsync(Projection projection) => session.SetProjectionAsync(projection);
}
