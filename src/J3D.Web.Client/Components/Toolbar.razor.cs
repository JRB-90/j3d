using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// The app bar's tools in labelled groups (decision D48): Import, Export (M9, D119) and Fit all; the
/// selection mode (D146); Measure, Move and Origin frames; Hide, Isolate and Show all; Undo and Redo
/// (D97). Each is enabled when it would do something, once the viewer is running with WebGL2. The
/// toolbar also runs the exports the context menu asks for (D164). The projection toggle lives by the
/// view cube (<see cref="ViewControls"/>).
/// </summary>
public sealed partial class Toolbar(ViewerSession session, SceneState scene, ISnackbar snackbar) : IDisposable
{
    internal const string InputId = "j3d-import-input";

    internal static readonly MeshExportFormat[] MeshFormats = [MeshExportFormat.Glb, MeshExportFormat.StlBinary, MeshExportFormat.StlAscii];

    /// <summary>A selection in one BREP model also saves as these (M15, D192).</summary>
    internal static readonly BrepExportFormat[] BrepFormats = [BrepExportFormat.Step, BrepExportFormat.Brep];

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

    private static string ModeName(SelectMode mode) => mode switch
    {
        SelectMode.Models => "Model",
        SelectMode.Objects => "Object",
        _ => "Feature",
    };

    private static string ModeTooltip(SelectMode mode) => mode switch
    {
        SelectMode.Models => "Clicks select whole models (1)",
        SelectMode.Objects => "Clicks select parts; the tree selects sub-assemblies too (2)",
        _ => "Clicks select faces, edges and vertices (3)",
    };

    /// <summary>A tool button, tinted while its tool is on.</summary>
    private static string ToolClass(bool on) => on ? "j3d-tool j3d-collapsible j3d-tool--on" : "j3d-tool j3d-collapsible";

    /// <summary>
    /// X, Y and Z axes from one corner, for Origin frames: Material has no axes icon, and its "3D rotation"
    /// read as rotating. Drawn as strokes on Material's 24 px grid, at its 2 px weight.
    /// </summary>
    internal const string OriginFramesIcon =
        "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">" +
        "<path d=\"M6 18V4M3.5 6.5 6 4l2.5 2.5\"/><path d=\"M6 18h14M17.5 15.5 20 18l-2.5 2.5\"/><path d=\"M6 18l-3 3\"/></g>";

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
}
