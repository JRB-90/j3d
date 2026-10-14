using System.Globalization;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// One model in the list (decision D52): its name, format and kind, and its action; while importing,
/// the phase and a bar for it (D55); once loaded, memory, triangles and parts, any load warnings,
/// and its tree, collapsed until asked for and loaded a level at a time (D53); if it failed, why.
/// </summary>
public sealed partial class ModelListItem
{
    /// <summary>
    /// Nodes shown per level before a "Show more" row. MudTreeView renders every node it's given:
    /// a level of about 1,400 blocked the page for 0.6 s (so a 10,000-part level for several), while
    /// a page of 100 takes about 0.1 s.
    /// </summary>
    internal const int TreePageSize = 100;

    /// <summary>The key of the roots' level in <see cref="_levels"/>.</summary>
    private const int RootLevel = -1;

    private ModelTree? _tree;

    // Node indexes are nullable so that no node equals the tree view's default selected value, which
    // would draw it as selected; the tree is display only (decision D14). "Show more" rows have
    // negative values that encode their level.
    private IReadOnlyCollection<ITreeItemData<int?>>? _roots;

    /// <summary>
    /// The nodes shown so far on each level, by parent index. The tree view keeps the lists it's
    /// given, so "Show more" extends them in place.
    /// </summary>
    private readonly Dictionary<int, List<TreeItemData<int?>>> _levels = [];
    private bool _treeOpen;

    [Parameter, EditorRequired]
    public required ModelEntry Model { get; set; }

    /// <summary>Cancel, delete or dismiss: the list decides whether to confirm first.</summary>
    [Parameter]
    public EventCallback<ModelEntry> OnRemove { get; set; }

    private string StatusName => Model.Status.ToString().ToLowerInvariant();

    private string KindLabel => Model.Summary.Kind == ModelKind.Brep ? "BREP" : "mesh";

    /// <summary>BREP files describe assemblies; mesh files only an object hierarchy.</summary>
    private string TreeLabel => Model.Summary.Kind == ModelKind.Brep ? "Assembly" : "Hierarchy";

    private double Percent => (Model.Fraction ?? 0) * 100;

    private string ProgressText => (Model.Phase, Model.Fraction) switch
    {
        ({ } phase, { } fraction) => $"{phase} · {Math.Floor(fraction * 100).ToString(CultureInfo.InvariantCulture)}%",
        ({ } phase, null) => $"{phase}…",
        _ => "Starting…",
    };

    private static string StatsText(ModelLoadedInfo info) => string.Join(
        " · ",
        DisplayFormat.Bytes(info.MemoryBytes),
        DisplayFormat.Counted(info.Stats.Triangles, "triangle"),
        DisplayFormat.Counted(info.Stats.Instances, "part"));

    private Task RemoveAsync() => OnRemove.InvokeAsync(Model);

    /// <summary>Opening the tree starts it collapsed again: the tree view is new each time.</summary>
    private void ToggleTree()
    {
        _treeOpen = !_treeOpen;
        _levels.Clear();
        _roots = null;
        if (_treeOpen && Model.Info is { } info)
        {
            _tree ??= new ModelTree(info.Tree);
            _roots = Level(RootLevel);
        }
    }

    /// <summary>The tree view asks for a node's children the first time it's expanded.</summary>
    private Task<IReadOnlyCollection<TreeItemData<int?>>> LoadChildrenAsync(int? parent) =>
        Task.FromResult<IReadOnlyCollection<TreeItemData<int?>>>(Level(parent ?? RootLevel));

    private static bool IsShowMore(ITreeItemData<int?> item) => item.Value < 0;

    private void ShowMore(ITreeItemData<int?> item)
    {
        var parent = -item.Value!.Value - 2;
        var level = _levels[parent];
        level.RemoveAt(level.Count - 1);
        AppendPage(parent, level);
    }

    /// <summary>A level's nodes, created with its first page the first time it's asked for.</summary>
    private List<TreeItemData<int?>> Level(int parent)
    {
        if (!_levels.TryGetValue(parent, out var level))
        {
            level = [];
            AppendPage(parent, level);
            _levels[parent] = level;
        }

        return level;
    }

    /// <summary>Adds the next page of a level's nodes, then a "Show more" row if any are left.</summary>
    private void AppendPage(int parent, List<TreeItemData<int?>> level)
    {
        var nodes = parent == RootLevel ? _tree!.Roots : _tree!.ChildrenOf(parent);
        var end = Math.Min(level.Count + TreePageSize, nodes.Count);
        for (var i = level.Count; i < end; i++)
        {
            level.Add(ToItem(nodes[i]));
        }

        var left = nodes.Count - end;
        if (left > 0)
        {
            level.Add(new TreeItemData<int?>
            {
                Value = -parent - 2,
                Text = left > TreePageSize
                    ? $"Show {TreePageSize} more ({left.ToString("N0", CultureInfo.InvariantCulture)} left)"
                    : $"Show {left} more",
            });
        }
    }

    private TreeItemData<int?> ToItem(int index)
    {
        var node = _tree![index];
        return new TreeItemData<int?>
        {
            Value = index,
            Text = string.IsNullOrWhiteSpace(node.Name) ? "(unnamed)" : node.Name,
            Icon = node.IsPart ? Icons.Material.Outlined.Category : Icons.Material.Outlined.AccountTree,
            Expandable = _tree.HasChildren(index),
        };
    }
}
