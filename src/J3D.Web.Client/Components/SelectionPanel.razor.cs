using System.Globalization;
using J3D.Web.Client.Interop;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Components;

/// <summary>
/// The floating panel at the viewport's bottom-left (decision D87): the selected part's name and
/// its path from the model down, or how many parts are selected. Since M7 it also shows the Measure
/// tool: its pending first pick with a copy button per value, a hint, and the kept measurements,
/// newest first and expandable, each removable, with Clear for them all (D101). Hidden when there is
/// nothing to show.
/// </summary>
public sealed partial class SelectionPanel(SceneState scene, ViewerSession session) : IDisposable
{
    internal const string PathSeparator = " › ";

    /// <summary>Measurements whose rows are open. A new measurement opens and closes the others, so the panel stays small.</summary>
    private readonly HashSet<string> _expanded = [];
    private string? _newest;

    private SceneState Scene => scene;

    private (string Title, string Detail)? Summary => scene.MeasureMode ? null : Describe(scene.Selection);

    private bool IsVisible => Summary is not null || scene.MeasureMode || !scene.Measurements.IsEmpty;

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
        if (scene.Measurements.LastOrDefault() is { } newest && newest.Id != _newest)
        {
            _newest = newest.Id;
            _expanded.Clear();
            _expanded.Add(newest.Id);
        }

        _ = InvokeAsync(StateHasChanged);
    }
}
