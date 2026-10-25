using System.Globalization;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
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
/// nodes are dimmed (assumption 20).
/// </summary>
public sealed partial class ModelListItem(SceneState scene, ViewerSession session, ISnackbar snackbar) : IDisposable
{
    private static readonly BrepExportFormat[] BrepFormats = [BrepExportFormat.Step, BrepExportFormat.Brep];

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


    /// <summary>The tree items made so far, by node, so a reveal can expand them.</summary>
    private readonly Dictionary<int, TreeItemData<int?>> _items = [];

    /// <summary>A node to scroll into view once the tree has rendered it.</summary>
    private int? _pendingScroll;

    /// <summary>The name field while a node is renamed (M14, D183): its text, and whether it still needs focus.</summary>
    private ElementReference _renameInput;
    private string _renameText = "";
    private Renaming? _renaming;
    private bool _focusRename;

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
        ({ } phase, { } fraction) => $"{phase} · {Math.Floor(fraction * 100).ToString(CultureInfo.InvariantCulture)}%",
        ({ } phase, null) => $"{phase}…",
        _ => "Starting…",
    };

    private static string ExportText(ModelExport export) => export.Fraction is { } fraction
        ? $"Exporting {export.Format.DisplayName} · {Math.Floor(fraction * 100).ToString(CultureInfo.InvariantCulture)}%"
        : $"Exporting {export.Format.DisplayName}…";

    /// <summary>The memory the model takes in the browser (its worker's heap for a CAD model), then its counts, as edited (M14).</summary>
    private static string StatsText(ModelLoadedInfo info, ModelStats stats) => string.Join(
        " · ",
        $"{DisplayFormat.Bytes(info.MemoryBytes)} in memory",
        DisplayFormat.Counted(stats.Triangles, "triangle"),
        DisplayFormat.Counted(stats.Instances, "part"));

    /// <summary>Tree nodes drag in Object mode, where edits act on objects (D182, D187).</summary>
    private bool CanDrag => scene.Mode == SelectMode.Objects;

    protected override void OnInitialized() => scene.RevealRequested += OnRevealRequested;

    /// <summary>An edit made a new tree (M14): the open tree shows it, with the same nodes open; and a rename may have started.</summary>
    protected override void OnParametersSet()
    {
        if (_treeOpen && Model.Tree is { } tree && !ReferenceEquals(tree, _tree))
        {
            Refresh(tree);
        }

        var renaming = scene.Renaming is { } current && current.Id == Model.Id ? current : null;
        if (renaming != _renaming)
        {
            _renaming = renaming;
            if (renaming is not null && Model.Tree is { } named && named.Contains(renaming.Node))
            {
                _renameText = named.NameOf(renaming.Node);
                _focusRename = true;
                // A new assembly opens, showing what it holds (D185).
                if (renaming.IsNew && named.HasChildren(renaming.Node) && _items.TryGetValue(renaming.Node, out var item))
                {
                    item.Children = Level(renaming.Node);
                    item.Expanded = true;
                }
            }
        }
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (_pendingScroll is { } node)
        {
            _pendingScroll = null;
            await session.ScrollIntoViewAsync($"[data-tree-node=\"{NodeKey(node)}\"]");
        }

        if (_focusRename && _renaming is not null && _renameInput.Context is not null)
        {
            _focusRename = false;
            await _renameInput.FocusAsync();
        }
    }

    private bool IsRenaming(int node) => _renaming is { } renaming && renaming.Node == node;

    /// <summary>Enter keeps the name typed; Esc keeps the one it had (D186).</summary>
    private void OnRenameKey(KeyboardEventArgs args)
    {
        if (args.Key == "Enter")
        {
            scene.EndRename(_renameText);
        }
        else if (args.Key == "Escape")
        {
            scene.EndRename(null);
        }
    }

    /// <summary>
    /// Shows a new tree after an edit, in place: each level shown so far is filled again from the new
    /// tree, as long as it was, reusing its nodes' items, so open nodes stay open and the tree view's rows
    /// stay as they were apart from those that changed. Making every row again took the large generated
    /// plant's tree a quarter of a second per edit.
    /// </summary>
    private void Refresh(ModelTree tree)
    {
        _tree = tree;
        foreach (var node in _items.Keys.Where(node => !tree.Contains(node)).ToList())
        {
            _items.Remove(node);
        }

        foreach (var (parent, level) in _levels.ToList())
        {
            if (parent != RootLevel && !tree.Contains(parent))
            {
                _levels.Remove(parent);
                continue;
            }

            var shown = level.Count(static item => item.Value >= 0);
            level.Clear();
            AppendPage(parent, level);
            while (level.Count(static item => item.Value >= 0) < shown && level.Count > 0 && IsShowMore(level[^1]))
            {
                level.RemoveAt(level.Count - 1);
                AppendPage(parent, level);
            }
        }

        // Each loaded level is its item's children, which the row shows as updated; a node left with no
        // children closes.
        foreach (var (node, item) in _items)
        {
            if (_levels.TryGetValue(node, out var level))
            {
                item.Children = level;
            }

            if (item.Expanded && !item.Expandable)
            {
                item.Expanded = false;
            }
        }
    }

    public void Dispose() => scene.RevealRequested -= OnRevealRequested;

    private Task RemoveAsync() => OnRemove.InvokeAsync(Model);

    /// <summary>A menu item awaits its click handler before the menu closes, so the export runs on its own.</summary>
    private void StartExport(BrepExportFormat format) => _ = InvokeAsync(() => ExportAsync(format));

    /// <summary>
    /// Saves the model as STEP or BREP: the item shows the export until it ends, the browser saves the
    /// file, and a failure goes to a snackbar (D125). A cancelled export, or a deleted model's, says nothing.
    /// </summary>
    private async Task ExportAsync(BrepExportFormat format)
    {
        if (Model.Export is not null)
        {
            return;
        }

        var id = Model.Id;
        var fileName = Model.Summary.FileName;
        scene.SetExport(id, format);
        try
        {
            var outcome = await session.ExportModelAsync(id, format);
            if (outcome?.Error is { } error)
            {
                snackbar.Add($"Couldn't export {fileName} as {format.DisplayName}: {error}", Severity.Error, static options => options.VisibleStateDuration = 10_000);
            }
        }
        catch (JSException exception)
        {
            snackbar.Add($"Couldn't export {fileName} as {format.DisplayName}: {exception.Message}", Severity.Error, static options => options.VisibleStateDuration = 10_000);
        }
        finally
        {
            scene.SetExport(id, null);
        }
    }

    private Task CancelExportAsync() => session.CancelExportAsync(Model.Id);

    private void ToggleModelVisibility() => scene.ToggleModelVisibility(Model.Id);

    private void SelectNode(int node, MouseEventArgs args) => scene.SelectNode(Model.Id, node, args.CtrlKey || args.MetaKey);

    private void OpenNodeMenu(int node, MouseEventArgs args) => scene.OpenNodeContextMenu(Model.Id, node, args.ClientX, args.ClientY);

    private string NodeKey(int node) => $"{Model.Id.Value}:{node.ToString(CultureInfo.InvariantCulture)}";

    private string NodeClass(int node, PartVisibility visibility) => string.Join(
        ' ',
        "j3d-tree-node",
        Model.IsSelected(node) ? "j3d-tree-node--selected" : "",
        visibility == PartVisibility.Hidden ? "j3d-tree-node--hidden" : "",
        scene.IsCut(Model.Id, node) ? "j3d-tree-node--cut" : "").TrimEnd();

    private static string EyeIcon(PartVisibility visibility) =>
        visibility == PartVisibility.Hidden ? Icons.Material.Outlined.VisibilityOff : Icons.Material.Outlined.Visibility;

    /// <summary>The half eye: an open eye, dimmed, when only some parts are hidden.</summary>
    private static string EyeClass(PartVisibility visibility) =>
        visibility == PartVisibility.Mixed ? "j3d-eye j3d-eye--mixed" : "j3d-eye";

    private static string EyeTitle(PartVisibility visibility) => visibility switch
    {
        PartVisibility.Hidden => "Show",
        PartVisibility.Mixed => "Partly hidden: hide all",
        _ => "Hide",
    };

    /// <summary>Opening the tree starts it collapsed again: the tree view is new each time.</summary>
    private void ToggleTree() => ToggleTree(Model.Tree);

    private void ToggleTree(ModelTree? tree)
    {
        _treeOpen = !_treeOpen;
        _levels.Clear();
        _items.Clear();
        _roots = null;
        if (_treeOpen && tree is not null)
        {
            _tree = tree;
            _roots = Level(RootLevel);
        }
    }

    /// <summary>A part picked in 3D (D96): open the tree, expand its ancestors, page to it, then scroll to it.</summary>
    private void OnRevealRequested(ModelId id, int node)
    {
        // The scene's tree, which an edit may have changed since this item last rendered (New assembly's, M14).
        if (id != Model.Id || scene.Find(id)?.Tree is not { } tree || !tree.Contains(node))
        {
            return;
        }

        if (!_treeOpen)
        {
            ToggleTree(tree);
        }
        else if (!ReferenceEquals(tree, _tree))
        {
            Refresh(tree);
        }

        var parent = RootLevel;
        foreach (var ancestor in tree.AncestorsOf(node))
        {
            EnsureShown(parent, ancestor);
            var item = _items[ancestor];
            item.Children = Level(ancestor);
            item.Expanded = true;
            parent = ancestor;
        }

        EnsureShown(parent, node);
        _pendingScroll = node;
        _ = InvokeAsync(StateHasChanged);
    }

    /// <summary>Appends pages to a level until it shows <paramref name="node"/>.</summary>
    private void EnsureShown(int parent, int node)
    {
        var siblings = parent == RootLevel ? _tree!.Roots : _tree!.ChildrenOf(parent);
        var position = 0;
        while (position < siblings.Count && siblings[position] != node)
        {
            position++;
        }

        var level = Level(parent);
        while (level.Count(static item => item.Value >= 0) <= position && level.Count > 0 && IsShowMore(level[^1]))
        {
            level.RemoveAt(level.Count - 1);
            AppendPage(parent, level);
        }
    }

    /// <summary>The tree view asks for a node's children the first time it's expanded.</summary>
    /// <remarks>
    /// The level is also its item's children: the tree view keeps what it loaded in the row's own state,
    /// and an edit (M14) updates the level in place, which the row then shows.
    /// </remarks>
    private Task<IReadOnlyCollection<TreeItemData<int?>>> LoadChildrenAsync(int? parent)
    {
        var level = Level(parent ?? RootLevel);
        if (parent is { } node && _items.TryGetValue(node, out var item))
        {
            item.Children = level;
        }

        return Task.FromResult<IReadOnlyCollection<TreeItemData<int?>>>(level);
    }

    private static bool IsShowMore(ITreeItemData<int?> item) => item.Value < 0;

    private void ShowMore(ITreeItemData<int?> item)
    {
        var parent = -item.Value!.Value - 2;
        var level = _levels[parent];
        level.RemoveAt(level.Count - 1);
        AppendPage(parent, level);
    }

    /// <summary>A level's nodes, created with its first page (or pages up to <paramref name="minimum"/> nodes) the first time it's asked for.</summary>
    private List<TreeItemData<int?>> Level(int parent, int minimum = 0)
    {
        if (!_levels.TryGetValue(parent, out var level))
        {
            level = [];
            AppendPage(parent, level);
            while (level.Count(static item => item.Value >= 0) < minimum && level.Count > 0 && IsShowMore(level[^1]))
            {
                level.RemoveAt(level.Count - 1);
                AppendPage(parent, level);
            }

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

    /// <summary>A node's item, made once and brought up to date after an edit (M14).</summary>
    private TreeItemData<int?> ToItem(int index)
    {
        var node = _tree![index];
        if (!_items.TryGetValue(index, out var item))
        {
            item = new TreeItemData<int?> { Value = index };
            _items[index] = item;
        }

        item.Text = string.IsNullOrWhiteSpace(node.Name) ? "(unnamed)" : node.Name;
        item.Icon = node.IsPart ? Icons.Material.Outlined.Category : Icons.Material.Outlined.AccountTree;
        item.Expandable = _tree.HasChildren(index);
        return item;
    }
}
