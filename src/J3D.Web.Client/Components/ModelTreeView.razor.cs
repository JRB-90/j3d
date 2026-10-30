using System.Globalization;
using J3D.Blazor;
using J3D.Web.Client.Interop;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components;

namespace J3D.Web.Client.Components;

/// <summary>A row of the open tree: its node, depth, parent and ancestors, and place among its siblings.</summary>
public readonly record struct TreeRowRef(int Node, int Level, int Parent, string Ancestors, int Position, int SetSize);

/// <summary>
/// A model's tree in its list item (M16, D198, D202), replacing M4's <c>MudTreeView</c>: the open rows as
/// one flat list, of which Blazor's <c>Virtualize</c> draws only those on screen, each row rendering again
/// only when its own state changes. With about 120 rows open every change used to render them all,
/// about 1 ms a row (§10 M16), and D60's pages were needed only because every node was drawn.
/// It's an ARIA tree with one tab stop: Up and Down move between rows, Right and Left open, close or go
/// to the parent, Home and End go to the ends, and Enter or Space select (Ctrl adds or removes).
/// A click selects as before (D77, D96), a pick in 3D opens the tree down to its part and scrolls to it,
/// nodes drag onto assemblies (tree-drag.ts, D182) and are renamed in place (D183). On a touch screen
/// (M19) rows are 48 px (D239), a tap adds while Add is on (D237) and else closes the compact layout's
/// drawer (D238), and rows don't drag: a long press's Cut, Copy and Paste move them (D242).
/// </summary>
public sealed partial class ModelTreeView(SceneState scene, AppScripts scripts, ShellState shell) : IDisposable
{
    /// <summary>Every row's height, in px: DESIGN.md's 26 px nodes, which <c>Virtualize</c> counts on.</summary>
    internal const int MouseRowHeight = 26;

    /// <summary>A row's height on a touch screen (M19, D239): a finger's 48 px.</summary>
    internal const int TouchRowHeight = 48;

    private int RowHeight => shell.IsTouch ? TouchRowHeight : MouseRowHeight;

    private readonly HashSet<int> _expanded = [];
    private ModelTree? _tree;
    private List<TreeRowRef> _rows = [];
    private readonly Dictionary<int, int> _indexOf = [];
    private bool _rowsChanged = true;

    /// <summary>The node the tree's one tab stop is on; the first row's when none was focused.</summary>
    private int? _focus;

    /// <summary>A row to scroll to once drawn, and whether to focus it.</summary>
    private (int Node, bool Focus)? _pendingReveal;
    private Renaming? _renaming;

    [Parameter, EditorRequired]
    public required ModelEntry Model { get; set; }

    /// <summary>A node to open the tree down to as it opens: the 3D pick that opened it (D96).</summary>
    [Parameter]
    public int? Reveal { get; set; }

    private List<TreeRowRef> Rows
    {
        get
        {
            if (_rowsChanged)
            {
                BuildRows();
            }

            return _rows;
        }
    }

    private string TreeSelector => $"[data-testid=model-tree][data-tree=\"{Model.Id.Value}\"]";

    protected override void OnInitialized()
    {
        scene.RevealRequested += OnRevealRequested;
        shell.Changed += OnShellChanged;
        _tree = Model.Tree;
        if (Reveal is { } node)
        {
            RevealNode(node, focus: false);
        }
    }

    /// <summary>An edit made a new tree (M14): the same nodes stay open; and a rename may have started.</summary>
    protected override void OnParametersSet()
    {
        if (Model.Tree is { } tree && !ReferenceEquals(tree, _tree))
        {
            UseTree(tree);
        }

        var renaming = scene.Renaming is { } current && current.Id == Model.Id ? current : null;
        if (renaming != _renaming)
        {
            _renaming = renaming;
            // A new assembly opens, showing what it holds (D185).
            if (renaming is { IsNew: true } && _tree is { } named && named.HasChildren(renaming.Node) && _expanded.Add(renaming.Node))
            {
                _rowsChanged = true;
            }
        }
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (_pendingReveal is { } reveal)
        {
            _pendingReveal = null;
            if (_indexOf.TryGetValue(reveal.Node, out var index))
            {
                await scripts.RevealTreeRowAsync(TreeSelector, index, RowHeight, $"[data-tree-node=\"{NodeKey(reveal.Node)}\"]", reveal.Focus);
            }
        }
    }

    public void Dispose()
    {
        scene.RevealRequested -= OnRevealRequested;
        shell.Changed -= OnShellChanged;
    }

    /// <summary>Touch or a mouse changes the rows' height and whether they drag (M19).</summary>
    private void OnShellChanged() => _ = InvokeAsync(StateHasChanged);

    /// <summary>Enter or Space on a row: its parts become the selection, or with Ctrl are added or removed (D77, D96).</summary>
    internal void Select(int node, bool additive)
    {
        _focus = node;
        scene.SelectNode(Model.Id, node, additive);
    }

    /// <summary>
    /// A click or a tap on a row, as <see cref="Select"/>, adding while Add is on (M19, D237); in the
    /// compact layout the drawer then closes so the part can be seen, unless more are being added (D238).
    /// </summary>
    internal void Click(int node, bool additive)
    {
        var adding = additive || scene.AddMode;
        Select(node, adding);
        shell.Picked(adding);
    }

    /// <summary>The row's arrow: opens or closes it. Rows inside stay open or closed as they were.</summary>
    internal void Toggle(int node)
    {
        if (!_expanded.Remove(node))
        {
            _expanded.Add(node);
        }
        else if (_focus is { } focus && _tree!.AncestorsOf(focus).Contains(node))
        {
            _focus = node; // the tab stop doesn't hide inside a closed row
        }

        _rowsChanged = true;
        StateHasChanged();
    }

    internal void ToggleVisibility(int node) => scene.ToggleNodeVisibility(Model.Id, node);

    internal void OpenMenu(int node, double x, double y) => scene.OpenNodeContextMenu(Model.Id, node, x, y);

    internal void EndRename(string? name) => scene.EndRename(name);

    /// <summary>A row took the focus (a click, or the keys): the tab stop follows it.</summary>
    internal void Focused(int node)
    {
        if (_focus != node)
        {
            _focus = node;
            StateHasChanged();
        }
    }

    /// <summary>A key on a focused row (D202).</summary>
    internal void OnKey(int node, string key, bool additive)
    {
        if (!_indexOf.TryGetValue(node, out var index))
        {
            return;
        }

        var row = _rows[index];
        var open = _expanded.Contains(node) && _tree!.HasChildren(node);
        switch (key)
        {
            case "ArrowDown":
                MoveFocus(index + 1);
                break;
            case "ArrowUp":
                MoveFocus(index - 1);
                break;
            case "Home":
                MoveFocus(0);
                break;
            case "End":
                MoveFocus(_rows.Count - 1);
                break;
            case "ArrowRight" when open:
                MoveFocus(index + 1); // its first child
                break;
            case "ArrowRight" when _tree!.HasChildren(node):
                Toggle(node);
                break;
            case "ArrowLeft" when open:
                Toggle(node);
                break;
            case "ArrowLeft" when row.Parent >= 0:
                MoveFocus(_indexOf[row.Parent]);
                break;
            case "Enter" or " ":
                Select(node, additive);
                break;
        }
    }

    private void MoveFocus(int index)
    {
        if (_rows.Count == 0)
        {
            return;
        }

        var node = _rows[Math.Clamp(index, 0, _rows.Count - 1)].Node;
        _focus = node;
        _pendingReveal = (node, true);
        StateHasChanged();
    }

    /// <summary>A part picked in 3D (D96), a pasted or renamed node: open the tree down to it and scroll to it.</summary>
    private void OnRevealRequested(ModelId id, int node)
    {
        // The scene's tree, which an edit may have changed since this tree last rendered (New assembly's, M14).
        if (id == Model.Id && scene.Find(id)?.Tree is { } tree && tree.Contains(node))
        {
            if (!ReferenceEquals(tree, _tree))
            {
                UseTree(tree);
            }

            RevealNode(node, focus: false);
            _ = InvokeAsync(StateHasChanged);
        }
    }

    private void RevealNode(int node, bool focus)
    {
        if (_tree is not { } tree || !tree.Contains(node))
        {
            return;
        }

        foreach (var ancestor in tree.AncestorsOf(node))
        {
            _rowsChanged |= _expanded.Add(ancestor);
        }

        _pendingReveal = (node, focus);
    }

    /// <summary>Shows a new tree: open nodes that are still in it stay open.</summary>
    private void UseTree(ModelTree tree)
    {
        _tree = tree;
        _expanded.RemoveWhere(node => !tree.Contains(node));
        if (_focus is { } focus && !tree.Contains(focus))
        {
            _focus = null;
        }

        _rowsChanged = true;
    }

    /// <summary>The open rows, in tree order: the top-level nodes and the children of open nodes.</summary>
    private void BuildRows()
    {
        _rowsChanged = false;
        _indexOf.Clear();
        List<TreeRowRef> rows = [];
        if (_tree is { } tree)
        {
            Add(tree.Roots, level: 0, parent: -1, ancestors: "");
        }

        _rows = rows;

        void Add(IReadOnlyList<int> siblings, int level, int parent, string ancestors)
        {
            for (var i = 0; i < siblings.Count; i++)
            {
                var node = siblings[i];
                _indexOf[node] = rows.Count;
                rows.Add(new TreeRowRef(node, level, parent, ancestors, i + 1, siblings.Count));
                if (_expanded.Contains(node) && _tree!.HasChildren(node))
                {
                    var key = node.ToString(CultureInfo.InvariantCulture);
                    Add(_tree.ChildrenOf(node), level + 1, node, ancestors.Length == 0 ? key : $"{ancestors} {key}");
                }
            }
        }
    }

    /// <summary>What a row shows now: only rows on screen are asked.</summary>
    private TreeRowState StateOf(TreeRowRef row)
    {
        var tree = _tree!;
        var node = row.Node;
        var name = tree.NameOf(node);
        var renaming = _renaming?.Node == node;
        var expandable = tree.HasChildren(node);
        return new TreeRowState(
            Key: NodeKey(node),
            Node: node,
            Level: row.Level,
            Parent: row.Parent,
            Ancestors: row.Ancestors,
            Position: row.Position,
            SetSize: row.SetSize,
            Text: string.IsNullOrWhiteSpace(name) ? "(unnamed)" : name,
            RenameText: renaming ? name : "",
            IsPart: tree.IsPart(node),
            Expandable: expandable,
            Expanded: expandable && _expanded.Contains(node),
            Selected: Model.IsSelected(node),
            Visibility: Model.VisibilityOf(node),
            Cut: scene.IsCut(Model.Id, node),
            Renaming: renaming,
            // Nodes drag in Object mode, where edits act on objects (D182, D187).
            // Not by touch (M19, D242): a long press opens the menu instead.
            Draggable: scene.Mode == SelectMode.Objects && !renaming && !shell.IsTouch,
            TabStop: node == (_focus ?? (_rows.Count > 0 ? _rows[0].Node : -1)));
    }

    private string NodeKey(int node) => $"{Model.Id.Value}:{node.ToString(CultureInfo.InvariantCulture)}";
}
