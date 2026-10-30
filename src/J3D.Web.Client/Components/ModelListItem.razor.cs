using System.Globalization;
using J3D.Blazor;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// One model in the list (decision D52): its name, format and kind, and its action; while importing,
/// the phase and a bar for it (D55); once loaded, memory, triangles and parts, any load warnings,
/// and its tree, collapsed until asked for and loaded a level at a time (D53); if it failed, why.
/// Since M6 the model and each tree node have an eye (open, closed or half, D96), clicking a node
/// selects its parts (Ctrl+click adds or removes, D77), and a part picked in 3D opens the tree down to
/// it and scrolls it into view. Since M9 a BREP model's download icon saves it as STEP or BREP, with
/// the export's progress and Cancel in the item (D125). Since M12 a right click on a node opens the
/// context menu (D164), and in Model mode a selected model's item is highlighted (D146). Since M14 the
/// tree follows the model's edits, its nodes drag onto assemblies and the model's name in Object mode
/// (the viewer's tree-drag.ts handles the drag, D182), a node's name is edited in place (D183), and cut
/// nodes are dimmed (assumption 20). Since M15 the STEP and BREP it saves are of the model as edited, and
/// it also writes the Export menu's STEP or BREP of its selection (D192). Since M16 the tree is J3D's own
/// <see cref="ModelTreeView"/> (D198).
/// </summary>
public sealed partial class ModelListItem(SceneState scene, ViewerSession session, ISnackbar snackbar) : IDisposable
{
    private static readonly BrepExportFormat[] BrepFormats = [BrepExportFormat.Step, BrepExportFormat.Brep];

    private bool _treeOpen;

    /// <summary>The node the 3D pick that opened the tree went to: the tree opens down to it (D96).</summary>
    private int? _reveal;

    [Parameter, EditorRequired]
    public required ModelEntry Model { get; set; }

    /// <summary>Cancel, delete or dismiss: the list decides whether to confirm first.</summary>
    [Parameter]
    public EventCallback<ModelEntry> OnRemove { get; set; }

    private SceneState Scene => scene;

    private string StatusName => Model.Status.ToString().ToLowerInvariant();

    /// <summary>Model mode: this model is selected whole (D146).</summary>
    private bool ModelSelected => scene.Mode == SelectMode.Models && SceneState.IsModelSelected(Model);

    private string ItemClass => $"j3d-model j3d-model--{StatusName}{(ModelSelected ? " j3d-model--selected" : "")}";

    private string KindLabel => Model.Summary.Kind == ModelKind.Brep ? "BREP" : "mesh";

    /// <summary>BREP files describe assemblies; mesh files only an object hierarchy.</summary>
    private string TreeLabel => Model.Summary.Kind == ModelKind.Brep ? "Assembly" : "Hierarchy";

    private double Percent => (Model.Fraction ?? 0) * 100;

    private string ProgressText => (Model.Phase, Model.Fraction) switch
    {
        ({ } phase, { } fraction) => $"{PhaseName(phase)} · {Math.Floor(fraction * 100).ToString(CultureInfo.InvariantCulture)}%",
        ({ } phase, null) => $"{PhaseName(phase)}…",
        _ => "Starting…",
    };

    /// <summary>A phase as the item says it: since M16 a restore's edits are "Applying your edits" (D203).</summary>
    private static string PhaseName(ImportPhase phase) => phase == ImportPhase.Applying ? "Applying your edits" : phase.ToString();

    private static string ExportText(ModelExport export) => export.Fraction is { } fraction
        ? $"Exporting {export.Format.DisplayName} · {Math.Floor(fraction * 100).ToString(CultureInfo.InvariantCulture)}%"
        : $"Exporting {export.Format.DisplayName}…";

    /// <summary>Expand or Expand all at work (M16, D199): "Expanding 840 parts…".</summary>
    private static string ExpandingText(int parts) => $"Expanding {DisplayFormat.Counted(parts, "part")}…";

    /// <summary>Objects arriving from another model (M18, D233): "Bringing 241 parts…".</summary>
    private static string BringingText(int parts) => $"Bringing {DisplayFormat.Counted(parts, "part")}…";

    /// <summary>The memory the model takes in the browser (its worker's heap for a CAD model), then its counts, as edited (M14).</summary>
    private static string StatsText(long memoryBytes, ModelStats stats) => string.Join(
        " · ",
        $"{DisplayFormat.Bytes(memoryBytes)} in memory",
        DisplayFormat.Counted(stats.Triangles, "triangle"),
        DisplayFormat.Counted(stats.Instances, "part"));

    protected override void OnInitialized()
    {
        scene.RevealRequested += OnRevealRequested;
        scene.ModelExportRequested += OnModelExportRequested;
    }

    /// <summary>The Export menu's STEP or BREP of this model's selection, or of it all (M15, D192): written as the item's own.</summary>
    private void OnModelExportRequested(ModelId id, BrepExportFormat format, bool selection)
    {
        if (id == Model.Id)
        {
            _ = InvokeAsync(() => ExportAsync(format, selection));
        }
    }

    public void Dispose()
    {
        scene.RevealRequested -= OnRevealRequested;
        scene.ModelExportRequested -= OnModelExportRequested;
    }

    private Task RemoveAsync() => OnRemove.InvokeAsync(Model);

    /// <summary>A menu item awaits its click handler before the menu closes, so the export runs on its own.</summary>
    private void StartExport(BrepExportFormat format) => _ = InvokeAsync(() => ExportAsync(format));

    /// <summary>
    /// Saves the model as STEP or BREP, as edited, or its selection (M15, D145, D155): the item shows the
    /// export until it ends, the browser saves the file, and a failure goes to a snackbar (D125). A
    /// cancelled export, or a deleted model's, says nothing.
    /// </summary>
    private async Task ExportAsync(BrepExportFormat format, bool selection = false)
    {
        if (Model.Export is not null)
        {
            return;
        }

        var id = Model.Id;
        var what = selection ? $"the selection of {Model.Summary.FileName}" : Model.Summary.FileName;
        scene.SetExport(id, format);
        try
        {
            var outcome = await session.ExportModelAsync(id, format, selection);
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
            scene.SetExport(id, null);
        }
    }

    private Task CancelExportAsync() => session.CancelExportAsync(Model.Id);

    private void ToggleModelVisibility() => scene.ToggleModelVisibility(Model.Id);

    internal static string EyeIcon(PartVisibility visibility) =>
        visibility == PartVisibility.Hidden ? Icons.Material.Outlined.VisibilityOff : Icons.Material.Outlined.Visibility;

    /// <summary>The half eye: an open eye, dimmed, when only some parts are hidden.</summary>
    internal static string EyeClass(PartVisibility visibility) =>
        visibility == PartVisibility.Mixed ? "j3d-eye j3d-eye--mixed" : "j3d-eye";

    internal static string EyeTitle(PartVisibility visibility) => visibility switch
    {
        PartVisibility.Hidden => "Show",
        PartVisibility.Mixed => "Partly hidden: hide all",
        _ => "Hide",
    };

    /// <summary>Opening the tree starts it collapsed again: the tree view is new each time.</summary>
    private void ToggleTree()
    {
        _treeOpen = !_treeOpen;
        _reveal = null;
    }

    /// <summary>
    /// A part picked in 3D (D96), or a node pasted or renamed: a closed tree opens down to it. An open
    /// tree reveals it itself.
    /// </summary>
    private void OnRevealRequested(ModelId id, int node)
    {
        if (id == Model.Id && !_treeOpen && scene.Find(id)?.Tree is { } tree && tree.Contains(node))
        {
            _treeOpen = true;
            _reveal = node;
            _ = InvokeAsync(StateHasChanged);
        }
    }
}
