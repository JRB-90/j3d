using J3D.Blazor;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;

namespace J3D.Web.Client.Components;

/// <summary>
/// What a tree row shows (M16, D198): everything it renders from, so a row whose state is unchanged
/// doesn't render again when the tree does.
/// </summary>
/// <param name="Key">The row's <c>data-tree-node</c>, <c>model:node</c>.</param>
/// <param name="Node">The node's id in the model's tree.</param>
/// <param name="Level">0 for a top-level node.</param>
/// <param name="Parent">The parent node, or -1 at the top level.</param>
/// <param name="Ancestors">The ancestors, root first, space-separated: a dragged node isn't dropped inside itself.</param>
/// <param name="Position">The node's place among its siblings, from 1 (<c>aria-posinset</c>).</param>
/// <param name="SetSize">How many siblings it has, itself included (<c>aria-setsize</c>).</param>
/// <param name="Text">The name shown, "(unnamed)" for none.</param>
/// <param name="RenameText">The name the field starts with while renaming (D183).</param>
/// <param name="IsPart">A part, rather than an assembly.</param>
/// <param name="Expandable">It has children, so an arrow.</param>
/// <param name="Expanded">Its children show.</param>
/// <param name="Selected">Its parts are all selected (D96).</param>
/// <param name="Visibility">Its eye: shown, hidden or partly hidden (D96).</param>
/// <param name="Cut">Cut, until it's pasted (assumption 20).</param>
/// <param name="Renaming">Its name is being edited (D183).</param>
/// <param name="Draggable">It drags onto assemblies (D182).</param>
/// <param name="TabStop">The row the tree's one tab stop is on (D202).</param>
public readonly record struct TreeRowState(
    string Key,
    int Node,
    int Level,
    int Parent,
    string Ancestors,
    int Position,
    int SetSize,
    string Text,
    string RenameText,
    bool IsPart,
    bool Expandable,
    bool Expanded,
    bool Selected,
    PartVisibility Visibility,
    bool Cut,
    bool Renaming,
    bool Draggable,
    bool TabStop);

/// <summary>
/// One node of a model's tree (M16, D198, D202): an ARIA tree item drawn from its <see cref="TreeRowState"/>,
/// rendered again only when that changes. Its clicks, keys and menu go to the <see cref="ModelTreeView"/>.
/// </summary>
public sealed partial class ModelTreeRow
{
    /// <summary>How far each level is indented, in px (DESIGN.md's 16 px step).</summary>
    internal const int IndentStep = 16;

    private TreeRowState? _rendered;
    private ElementReference _renameInput;
    private string _renameText = "";
    private bool _focusRename;

    [Parameter, EditorRequired]
    public TreeRowState State { get; set; }

    [Parameter, EditorRequired]
    public required ModelTreeView Owner { get; set; }

    private string RowClass => string.Join(
        ' ',
        "j3d-tree-node",
        State.Selected ? "j3d-tree-node--selected" : "",
        State.Visibility == PartVisibility.Hidden ? "j3d-tree-node--hidden" : "",
        State.Cut ? "j3d-tree-node--cut" : "").TrimEnd();

    protected override void OnParametersSet()
    {
        // A rename starting: the field takes the name and the focus (D183).
        if (State.Renaming && _rendered is not { Renaming: true })
        {
            _renameText = State.RenameText;
            _focusRename = true;
        }
    }

    protected override bool ShouldRender() => _rendered != State;

    protected override void OnAfterRender(bool firstRender) => _rendered = State;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (_focusRename && State.Renaming && _renameInput.Context is not null)
        {
            _focusRename = false;
            await _renameInput.FocusAsync();
        }
    }

    private void OnClick(MouseEventArgs args) => Owner.Click(State.Node, args.CtrlKey || args.MetaKey);

    private void OnToggle() => Owner.Toggle(State.Node);

    private void OnFocus() => Owner.Focused(State.Node);

    private void OnKeyDown(KeyboardEventArgs args) => Owner.OnKey(State.Node, args.Key, args.CtrlKey || args.MetaKey);

    private void OnContextMenu(MouseEventArgs args) => Owner.OpenMenu(State.Node, args.ClientX, args.ClientY);

    /// <summary>Enter keeps the name typed; Esc keeps the one it had (D186).</summary>
    private void OnRenameKey(KeyboardEventArgs args)
    {
        if (args.Key == "Enter")
        {
            Owner.EndRename(_renameText);
        }
        else if (args.Key == "Escape")
        {
            Owner.EndRename(null);
        }
    }
}
