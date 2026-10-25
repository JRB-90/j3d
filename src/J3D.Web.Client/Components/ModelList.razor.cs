using J3D.Web.Client.Interop;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// The models in the drawer, in import order (decision D57), with each one's cancel, delete or
/// dismiss action. Deleting a loaded model asks first (D29) and can be undone (D84); cancelling an
/// import and dismissing a failure don't ask, since there's nothing loaded to lose, and are final.
/// Clear all removes every model and everything kept, after asking (D110).
/// </summary>
public sealed partial class ModelList(SceneState scene, ViewerSession session, IDialogService dialogs) : IDisposable
{
    private SceneState Scene => scene;

    protected override void OnInitialized() => scene.Changed += OnSceneChanged;

    public void Dispose() => scene.Changed -= OnSceneChanged;

    private void OnSceneChanged() => _ = InvokeAsync(StateHasChanged);

    private async Task RemoveAsync(ModelEntry model)
    {
        if (model.Status == ModelStatus.Loaded)
        {
            var name = model.Summary.FileName;
            RenderFragment message = builder =>
            {
                builder.AddContent(0, "Delete ");
                builder.OpenElement(1, "strong");
                builder.AddContent(2, name);
                builder.CloseElement();
                builder.AddContent(3, "? Undo brings it back.");
            };
            if (await ConfirmDialog.AskAsync(dialogs, "Delete model", message, "Delete", Icons.Material.Outlined.Delete, "confirm-delete"))
            {
                scene.Delete(model.Id); // the viewer frees it at once and keeps its files for an undo
            }

            return;
        }

        // The item goes when the viewer reports the model removed.
        await session.RemoveModelAsync(model.Id);
    }

    private async Task ClearAllAsync()
    {
        RenderFragment message = static builder => builder.AddContent(0, "Remove every model, and everything kept for your next visit? This can't be undone.");
        if (await ConfirmDialog.AskAsync(dialogs, "Clear all", message, "Clear all", Icons.Material.Outlined.DeleteSweep, "confirm-clear-all"))
        {
            scene.ClearAll();
        }
    }
}
