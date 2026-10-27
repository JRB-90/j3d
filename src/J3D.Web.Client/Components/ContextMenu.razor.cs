using J3D.Web.Client.Models;
using J3D.Web.Client.Interop;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components.Web;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// The context menu (M12, D164), opened where the <see cref="SceneState"/> asks: by a right click in
/// the viewport or on a tree node, whose target is selected by then. On a part or a node it offers
/// the selection's commands (Hide, Isolate, Export the selection), on empty space the scene's (Show
/// all, Fit all, Export the scene), and "Measure from here" wherever there's an entity under the
/// pointer. Iteration 3's later milestones add their commands here.
/// </summary>
public sealed partial class ContextMenu(SceneState scene, ViewerSession session, ISnackbar snackbar) : IDisposable
{
    private MudMenu? _menu;
    private ContextMenuTarget? _target;

    private SceneState Scene => scene;

    protected override void OnInitialized() => scene.ContextMenuRequested += OnContextMenuRequested;

    public void Dispose() => scene.ContextMenuRequested -= OnContextMenuRequested;

    private Task FitAllAsync() => session.FitAllAsync();

    private void OnContextMenuRequested(ContextMenuTarget target) => _ = InvokeAsync(async () =>
    {
        _target = target;
        StateHasChanged();
        if (_menu is not null)
        {
            // A right click while the menu is open moves it: opening an open menu would close it instead.
            await _menu.CloseMenuAsync();
            // MudBlazor places the menu at the event's page coordinates; the app's page never scrolls.
            await _menu.OpenMenuAsync(new MouseEventArgs { ClientX = target.X, ClientY = target.Y, PageX = target.X, PageY = target.Y });
        }
    });

    /// <summary>Expand (M15, D154): the one compound part. A menu item awaits its click handler, so it runs on its own.</summary>
    private void Expand()
    {
        if (Scene.ExpandTarget is { } target)
        {
            _ = InvokeAsync(() => ExpandCommand.RunAsync(scene, session, snackbar, target.Model.Id, [target.Node]));
        }
    }

    /// <summary>Expand all (D154, D197): every compound part in the objects, or in the selected models.</summary>
    private void ExpandAll()
    {
        foreach (var (id, parts) in Scene.ExpandAllTargets)
        {
            _ = InvokeAsync(() => ExpandCommand.RunAsync(scene, session, snackbar, id, parts));
        }
    }

    /// <summary>Move or Rotate (M13; M17, D222): the Move tool on with its arrows or its rings, unless it's in that mode already.</summary>
    private void StartMoving(MoveMode mode)
    {
        if (Scene.Moving != mode)
        {
            Scene.SetMoveMode(mode);
        }
    }
}
