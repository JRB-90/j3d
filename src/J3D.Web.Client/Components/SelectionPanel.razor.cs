using System.Globalization;
using J3D.Blazor;
using J3D.Web.Client.Interop;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Components;

/// <summary>
/// The floating panel at the viewport's bottom-left (decision D87): the selected part's name and
/// its path from the model down, or how many parts are selected; in Model mode, the selected models
/// (D146). Since M7 it also shows the Measure tool, since M12 as its reference with its values and the
/// reference against the last click, with a copy button per value (D147); the reference's values fold
/// away once there's a result. In Feature mode it lists
/// each selected feature, newest first and open, and the totals that add up (D163). Hidden when there
/// is nothing to show. In the compact layout (M19, D236) it's a sheet along the view's bottom edge that
/// peeks at its first lines until its handle is tapped or dragged up, and it names the tool that's on,
/// or Add, with a Stop button, since the bar may have folded them into ⋮ (D235).
/// </summary>
public sealed partial class SelectionPanel(SceneState scene, AppScripts scripts, ShellState shell) : IDisposable
{
    /// <summary>How far a drag on the sheet's handle goes before it opens or closes the sheet, in px.</summary>
    private const double SheetDrag = 24;

    /// <summary>The sheet is pulled up to half the view, rather than peeking (D236).</summary>
    private bool _sheetOpen;
    private double? _handleDown;
    internal const string PathSeparator = " › ";

    /// <summary>Features whose rows are open. A new feature opens and closes the others, so the panel stays small.</summary>
    private readonly HashSet<string> _expanded = [];
    private string? _newest;

    /// <summary>The reference's rows, which fold away once there's a result so the panel stays small, unless opened again.</summary>
    private bool _referenceOpen;
    private string? _reference;

    private static readonly MoveFrame[] Frames = [MoveFrame.Local, MoveFrame.Parent, MoveFrame.World];
    private static readonly string[] FieldNames = ["X", "Y", "Z", "Rx", "Ry", "Rz"];
    private static readonly string[] FieldLabels = ["X (mm)", "Y (mm)", "Z (mm)", "Rx (degrees)", "Ry (degrees)", "Rz (degrees)"];

    /// <summary>What's been typed in the Move fields since the last Enter: the rest show the pose, following any drag (D149).</summary>
    private readonly string?[] _drafts = new string?[6];

    private SceneState Scene => scene;

    private (string Title, string Detail)? Summary => scene.Mode == SelectMode.Models ? DescribeModels(scene) : Describe(scene);

    private bool IsVisible =>
        scene.Moving is not null || scene.MeasureMode || (shell.IsCompact && scene.AddMode) ||
        (scene.Mode == SelectMode.Features ? !scene.Features.IsEmpty : Summary is not null);

    /// <summary>The tool that's on, named in the compact layout's sheet with a Stop button (D235), or null.</summary>
    private string? ToolOn =>
        !shell.IsCompact ? null
        : scene.Moving == MoveMode.Translate ? "Moving"
        : scene.Moving == MoveMode.Rotate ? "Rotating"
        : scene.MeasureMode ? "Measuring"
        : null;

    private string PanelClass => _sheetOpen ? "j3d-selection-panel j3d-sheet--open" : "j3d-selection-panel";

    protected override void OnInitialized()
    {
        scene.Changed += OnSceneChanged;
        shell.Changed += OnShellChanged;
    }

    private void StopTool()
    {
        if (scene.Moving is not null)
        {
            scene.StopMoving();
        }
        else
        {
            scene.SetMeasureMode(false);
        }
    }

    /// <summary>The handle: a tap opens or closes the sheet, a drag up opens it and a drag down closes it (D236).</summary>
    private void OnHandleDown(Microsoft.AspNetCore.Components.Web.PointerEventArgs args) => _handleDown = args.ClientY;

    private void OnHandleUp(Microsoft.AspNetCore.Components.Web.PointerEventArgs args)
    {
        if (_handleDown is not { } down)
        {
            return;
        }

        _handleDown = null;
        var moved = args.ClientY - down;
        _sheetOpen = moved < -SheetDrag || (moved <= SheetDrag && !_sheetOpen);
    }

    private void OnShellChanged() => _ = InvokeAsync(StateHasChanged);

    /// <summary>The Move tool's target: a node's name, or a whole model's file name.</summary>
    private string TargetName((ModelId Id, int Node) target) =>
        scene.Find(target.Id) is not { } model ? ""
        : target.Node == ModelEntry.ModelFrameNode || model.Tree is not { } tree ? model.Summary.FileName
        : NameOf(tree, target.Node);

    /// <summary>A field's text: what's been typed, or the pose's value (millimetres to 3 decimals, degrees to 2; assumption 13).</summary>
    private string FieldValue(Pose pose, int field) => _drafts[field] ?? (field switch
    {
        0 => pose.X,
        1 => pose.Y,
        2 => pose.Z,
        3 => pose.Rx,
        4 => pose.Ry,
        _ => pose.Rz,
    }).ToString(field < 3 ? "0.000" : "0.00", CultureInfo.InvariantCulture);

    /// <summary>Enter applies all six fields as one move (D148), as Apply does; Esc drops what's been typed.</summary>
    private void OnFieldKey(Microsoft.AspNetCore.Components.Web.KeyboardEventArgs args, Pose pose)
    {
        if (args.Key == "Escape")
        {
            Array.Clear(_drafts);
            return;
        }

        if (args.Key == "Enter")
        {
            Apply(pose);
        }
    }

    /// <summary>
    /// What the fields hold in this frame: in Local a move by the values about the object's own axes,
    /// otherwise its position in the parent's or the world's frame (D148). Said above them, since the same
    /// six fields mean a move in one frame and a place in the others.
    /// </summary>
    private string FieldsHeading => scene.Frame switch
    {
        MoveFrame.Local => "Move by",
        MoveFrame.Parent => "Position in its parent",
        _ => "Position in the world",
    };

    /// <summary>Applies all six fields as one move, from Enter or the Apply button; a field that isn't a number keeps what was typed.</summary>
    private void Apply(Pose pose)
    {
        var values = new double[6];
        for (var field = 0; field < 6; field++)
        {
            var text = FieldValue(pose, field).Replace(',', '.');
            if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out values[field]) || !double.IsFinite(values[field]))
            {
                return; // the field keeps what was typed
            }
        }

        Array.Clear(_drafts);
        scene.MoveTo(new Pose(values[0], values[1], values[2], values[3], values[4], values[5]));
    }

    private void SetFrame(MoveFrame frame)
    {
        Array.Clear(_drafts);
        scene.SetMoveFrame(frame);
    }

    /// <summary>The panel's Move | Rotate switch (M17, D223): the triad's arrows or rings; picking the one that's on keeps it on.</summary>
    private void SetMoveMode(MoveMode mode)
    {
        if (scene.Moving != mode)
        {
            scene.SetMoveMode(mode);
        }
    }

    public void Dispose()
    {
        scene.Changed -= OnSceneChanged;
        shell.Changed -= OnShellChanged;
    }

    /// <summary>
    /// One part: its name and path. Several: how many, and in how many models, counted by model, since
    /// listing thousands of selected parts on every render was slow (M16).
    /// </summary>
    internal static (string Title, string Detail)? Describe(SceneState scene)
    {
        List<ModelEntry> selected = [.. scene.Models.Where(static model => !model.Selected.IsEmpty)];
        var parts = selected.Sum(static model => model.Selected.Count);
        switch (selected)
        {
            case []:
                return null;

            case [var model] when parts == 1:
                var tree = model.Tree!;
                var node = model.Selected.Single();
                var path = tree.AncestorsOf(node).Select(ancestor => NameOf(tree, ancestor)).Prepend(model.Summary.FileName);
                return (NameOf(tree, node), string.Join(PathSeparator, path));

            default:
                var count = parts.ToString("N0", CultureInfo.InvariantCulture);
                return ($"{count} parts selected", selected.Count == 1 ? $"in {selected[0].Summary.FileName}" : $"in {selected.Count} models");
        }
    }

    /// <summary>Model mode (D146): the selected model's name and its parts, or how many models.</summary>
    internal static (string Title, string Detail)? DescribeModels(SceneState scene)
    {
        List<ModelEntry> selected = [.. scene.Models.Where(model => !model.Selected.IsEmpty)];
        var parts = selected.Sum(static model => model.Selected.Count).ToString("N0", CultureInfo.InvariantCulture);
        return selected switch
        {
            [] => null,
            [var model] => (model.Summary.FileName, $"Whole model · {parts} {(parts == "1" ? "part" : "parts")}"),
            _ => ($"{selected.Count} models selected", $"{parts} parts"),
        };
    }

    private static string NameOf(ModelTree tree, int node) =>
        string.IsNullOrWhiteSpace(tree[node].Name) ? "(unnamed)" : tree[node].Name;

    private void Toggle(string id)
    {
        if (!_expanded.Remove(id))
        {
            _expanded.Add(id);
        }
    }

    private Task CopyAsync(string text) => scripts.CopyTextAsync(text);

    private void OnSceneChanged()
    {
        if (scene.Features.Features is [.., var newest] && newest.Id != _newest)
        {
            _newest = newest.Id;
            _expanded.Clear();
            _expanded.Add(newest.Id);
        }

        if (scene.MeasureReference?.Title != _reference)
        {
            _reference = scene.MeasureReference?.Title;
            _referenceOpen = false;
        }

        if (!IsVisible)
        {
            _sheetOpen = false; // the sheet comes back peeking
        }

        _ = InvokeAsync(StateHasChanged);
    }
}
