using System.Globalization;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Components;

/// <summary>
/// The floating panel at the viewport's bottom-left (decision D87): the selected part's name and
/// its path from the model down, or how many parts are selected. Hidden when nothing is. M7 adds
/// the measurement results.
/// </summary>
public sealed partial class SelectionPanel(SceneState scene) : IDisposable
{
    internal const string PathSeparator = " › ";

    private (string Title, string Detail)? Summary => Describe(scene.Selection);

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

    private void OnSceneChanged() => _ = InvokeAsync(StateHasChanged);
}
