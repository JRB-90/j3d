using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// Import, Export (M9, D119), Fit all and the projection toggle, in the app bar (decision D48), then
/// Hide, Isolate, Show all, Undo and Redo (D97), each enabled when it would do something. Enabled once
/// the viewer is running with WebGL2. Since M12 the selection mode's switch (D146) sits before Measure,
/// and the toolbar also runs the exports the context menu asks for (D164).
/// </summary>
public sealed partial class Toolbar(ViewerSession session, SceneState scene, ISnackbar snackbar) : IDisposable
{
    internal const string InputId = "j3d-import-input";

    internal static readonly MeshExportFormat[] MeshFormats = [MeshExportFormat.Glb, MeshExportFormat.StlBinary, MeshExportFormat.StlAscii];

    private static readonly SelectMode[] SelectModes = [SelectMode.Models, SelectMode.Objects, SelectMode.Features];

    private ElementReference _input;
    private bool _inputAttached;

    /// <summary>A GLB or STL is being written: the Export button is busy (D125).</summary>
    private bool _exporting;

    private ViewerSession Session => session;

    private SceneState Scene => scene;

    /// <summary>What Export saves: the selection when there is one (D83).</summary>
    private string ExportLabel => scene.HasSelection ? "Export the selection" : "Export the visible scene";

    protected override void OnInitialized()
    {
        session.Changed += OnSessionChanged;
        scene.Changed += OnSceneChanged;
        scene.ExportRequested += StartExport;
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
        scene.ExportRequested -= StartExport;
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

    /// <summary>As the viewer names the modes: model, object, feature.</summary>
    private static string ModeKey(SelectMode mode) => mode switch
    {
        SelectMode.Models => "model",
        SelectMode.Objects => "object",
        _ => "feature",
    };

    private static string ModeTooltip(SelectMode mode) => mode switch
    {
        SelectMode.Models => "Select models (1)",
        SelectMode.Objects => "Select objects (2)",
        _ => "Select faces, edges and vertices (3)",
    };

    private static string ModeIcon(SelectMode mode) => mode switch
    {
        SelectMode.Models => Icons.Material.Outlined.ViewInAr,
        SelectMode.Objects => Icons.Material.Outlined.Category,
        _ => Icons.Material.Outlined.Polyline,
    };

    internal static string FormatKey(MeshExportFormat format) => format switch
    {
        MeshExportFormat.Glb => "glb",
        MeshExportFormat.StlBinary => "stl",
        _ => "stl-ascii",
    };

    /// <summary>
    /// A menu item awaits its click handler before the menu closes, so the export runs on its own and
    /// the menu closes at once.
    /// </summary>
    private void StartExport(MeshExportFormat format, bool selection) => _ = InvokeAsync(() => ExportAsync(format, selection));

    /// <summary>Writes the selection, or the visible scene, and the browser saves it; failures go to a snackbar (D125).</summary>
    private async Task ExportAsync(MeshExportFormat format, bool selection)
    {
        if (_exporting)
        {
            return;
        }

        var what = selection ? "the selection" : "the scene";
        _exporting = true;
        StateHasChanged();
        try
        {
            var outcome = await session.ExportMeshAsync(format, selection);
            if (outcome?.Error is { } error)
            {
                snackbar.Add($"Couldn't export {what} as {format.DisplayName}: {error}", Severity.Error, static options => options.VisibleStateDuration = 10_000);
            }
        }
        catch (JSException exception)
        {
            snackbar.Add($"Couldn't export {what} as {format.DisplayName}: {exception.Message}", Severity.Error, static options => options.VisibleStateDuration = 10_000);
        }
        finally
        {
            _exporting = false;
            StateHasChanged();
        }
    }

    private Task FitAllAsync() => session.FitAllAsync();

    private Task SetProjectionAsync(Projection projection) => session.SetProjectionAsync(projection);
}
