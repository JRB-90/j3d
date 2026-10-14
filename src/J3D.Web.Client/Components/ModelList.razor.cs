using J3D.Web.Client.Interop;
using J3D.Web.Client.State;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// The models in the drawer, in import order (decision D57), with each one's cancel, delete or
/// dismiss action. Deleting a loaded model asks first (D29); cancelling an import and dismissing a
/// failure don't, since there's nothing loaded to lose.
/// </summary>
public sealed partial class ModelList(SceneState scene, ViewerSession session) : IDisposable
{
    private MudMessageBox? _confirmDelete;
    private string _deleteName = "";

    private SceneState Scene => scene;

    protected override void OnInitialized() => scene.Changed += OnSceneChanged;

    public void Dispose() => scene.Changed -= OnSceneChanged;

    private void OnSceneChanged() => _ = InvokeAsync(StateHasChanged);

    private async Task RemoveAsync(ModelEntry model)
    {
        if (model.Status == ModelStatus.Loaded)
        {
            _deleteName = model.Summary.FileName;
            if (await _confirmDelete!.ShowAsync() != true)
            {
                return;
            }
        }

        // The item goes when the viewer reports the model removed.
        await session.RemoveModelAsync(model.Id);
    }
}
