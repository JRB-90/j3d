using J3D.Web.Client.Interop;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;

namespace J3D.Web.Client.Components;

/// <summary>
/// Import, Fit all and the projection toggle, in the app bar (decision D48), then Hide, Isolate,
/// Show all, Undo and Redo (D97), each enabled when it would do something. Enabled once the viewer
/// is running with WebGL2.
/// </summary>
public sealed partial class Toolbar(ViewerSession session, SceneState scene) : IDisposable
{
    internal const string InputId = "j3d-import-input";

    private ElementReference _input;
    private bool _inputAttached;

    private ViewerSession Session => session;

    private SceneState Scene => scene;

    protected override void OnInitialized()
    {
        session.Changed += OnSessionChanged;
        scene.Changed += OnSceneChanged;
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (session.IsReady && !_inputAttached)
        {
            _inputAttached = true;
            await session.AttachFileInputAsync(_input);
        }
    }

    public void Dispose()
    {
        session.Changed -= OnSessionChanged;
        scene.Changed -= OnSceneChanged;
    }

    private void OnSceneChanged() => _ = InvokeAsync(StateHasChanged);

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
