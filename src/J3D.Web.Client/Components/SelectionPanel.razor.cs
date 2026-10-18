using System.Globalization;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Components;

/// <summary>
/// The floating panel at the viewport's bottom-left (decision D87): the selected part's name and
/// its path from the model down, or how many parts are selected; in Model mode, the selected models
/// (D146). Since M7 it also shows the Measure tool, since M12 as its reference with its values and the
/// reference against the last click, with a copy button per value (D147); the reference's values fold
/// away once there's a result. In Feature mode it lists
/// each selected feature, newest first and open, and the totals that add up (D163). Hidden when there
/// is nothing to show.
/// </summary>
public sealed partial class SelectionPanel(SceneState scene, ViewerSession session) : IDisposable
{
    internal const string PathSeparator = " › ";

    /// <summary>Features whose rows are open. A new feature opens and closes the others, so the panel stays small.</summary>
    private readonly HashSet<string> _expanded = [];
    private string? _newest;

    /// <summary>The reference's rows, which fold away once there's a result so the panel stays small, unless opened again.</summary>
    private bool _referenceOpen;
    private string? _reference;

    private SceneState Scene => scene;

    private (string Title, string Detail)? Summary => scene.Mode == SelectMode.Models ? DescribeModels(scene) : Describe(scene.Selection);

    private bool IsVisible => scene.MeasureMode || (scene.Mode == SelectMode.Features ? !scene.Features.IsEmpty : Summary is not null);

    protected override void OnInitialized() => scene.Changed += OnSceneChanged;

    public void Dispose() => scene.Changed -= OnSceneChanged;

    /// <summary>One part: its name and path. Several: how many, and in how many models.</summary>
    internal static (string Title, string Detail)? Describe(IReadOnlyList<(ModelEntry Model, int Node)> selection)
    {
        switch (selection)
        {
            case []:
                return null;

            case [var (model, node)]:
                var tree = model.Tree!;
                var path = tree.AncestorsOf(node).Select(ancestor => NameOf(tree, ancestor)).Prepend(model.Summary.FileName);
                return (NameOf(tree, node), string.Join(PathSeparator, path));

            default:
                var models = selection.Select(static part => part.Model.Id).Distinct().Count();
                var count = selection.Count.ToString("N0", CultureInfo.InvariantCulture);
                return ($"{count} parts selected", models == 1 ? $"in {selection[0].Model.Summary.FileName}" : $"in {models} models");
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

    private Task CopyAsync(string text) => session.CopyTextAsync(text);

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

        _ = InvokeAsync(StateHasChanged);
    }
}
