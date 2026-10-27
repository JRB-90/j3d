using System.Collections.Immutable;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

/// <summary>
/// What Cut or Copy took (M14, D152): objects of one model, each with the parent it had then, so a copy
/// of an object deleted since can still go beside where it was (assumption 21). The tab's own, never
/// the system clipboard; a cut is pasted once (assumption 20).
/// </summary>
public sealed record Clipboard(ModelId Id, ImmutableArray<(int Node, int Parent)> Items, bool Cut);

/// <summary>A tree node whose name is being edited in place (D183, D186); <paramref name="IsNew"/> for a new assembly's.</summary>
public sealed record Renaming(ModelId Id, int Node, bool IsNew);

/// <summary>An Expand worked out on a model's tree as it was (<paramref name="Before"/>), not yet made (M16, D199).</summary>
public sealed record ExpandPlan(ModelId Id, ModelTree Before, TreeEdit Edit, IReadOnlyList<int> Assemblies)
{
    private ModelTree? _next;

    /// <summary>The tree after the Expand, built the first time it's asked for: a step that can be a task of its own.</summary>
    public ModelTree Next => _next ??= Edit.Build();
}

/// <summary>
/// Editing models' trees (M14, D151â€“D152, D180â€“D187): Cut, Copy, Paste, Delete, New assembly, Ungroup,
/// Rename and drops in the tree, each one undoable step (D145) that the <c>Viewport</c> sends to the
/// viewer, which keeps it. They act on the selection's objects (assumption 19) in Object mode; Model
/// mode only deletes models, after asking (D187), and Feature mode doesn't edit.
/// </summary>
public sealed partial class SceneState
{
    /// <summary>Raised when Delete should remove whole models (Model mode, D187): the list asks first (D29).</summary>
    public event Action<IReadOnlyList<ModelId>>? DeleteModelsRequested;

    /// <summary>
    /// Raised for a STEP or BREP export from the Export menu (M15, D192): the model's list item runs it,
    /// of its selection, or (false, in Model mode) of the whole model.
    /// </summary>
    public event Action<ModelId, BrepExportFormat, bool>? ModelExportRequested;

    /// <summary>
    /// The one BREP model a STEP or BREP export of the selection comes from (D155, D192): objects all in
    /// one BREP model in Object mode, or one selected BREP model in Model mode; else null.
    /// </summary>
    public ModelEntry? SelectionBrepModel
    {
        get
        {
            List<ModelEntry> models = Mode switch
            {
                SelectMode.Objects => [.. Models.Where(static model => !model.Selected.IsEmpty)],
                SelectMode.Models => [.. Models.Where(IsModelSelected)],
                _ => [],
            };
            return models is [{ Summary.Kind: ModelKind.Brep, Status: ModelStatus.Loaded } only] ? only : null;
        }
    }

    /// <summary>STEP or BREP of the selection's BREP model (D192): its selection, or in Model mode all of it.</summary>
    public void RequestModelExport(BrepExportFormat format)
    {
        if (SelectionBrepModel is { } model)
        {
            ModelExportRequested?.Invoke(model.Id, format, Mode == SelectMode.Objects);
        }
    }

    /// <summary>What Cut or Copy last took, or null.</summary>
    public Clipboard? Clipboard { get; private set; }

    /// <summary>The node whose name is being edited in the tree, or null.</summary>
    public Renaming? Renaming { get; private set; }

    /// <summary>
    /// The objects the selection stands for, in list order then tree order (assumption 19): in each
    /// model, the node last picked in the tree while the selection is exactly its visible parts, or
    /// else the topmost nodes whose visible parts are all selected. None outside Object mode.
    /// </summary>
    public IReadOnlyList<(ModelEntry Model, int Node)> EditObjects => Derive(nameof(EditObjects), FindEditObjects);

    private IReadOnlyList<(ModelEntry Model, int Node)> FindEditObjects()
    {
        if (Mode != SelectMode.Objects)
        {
            return [];
        }

        List<(ModelEntry, int)> objects = [];
        foreach (var model in Models)
        {
            if (model.Tree is not { } tree || model.Selected.IsEmpty)
            {
                continue;
            }

            if (_anchor is { } anchor && anchor.Id == model.Id && tree.Contains(anchor.Node) &&
                model.Selected.SetEquals(tree.PartsUnder(anchor.Node).Where(part => !model.Hidden.Contains(part))))
            {
                objects.Add((model, anchor.Node));
            }
            else
            {
                objects.AddRange(tree.CoveredBy(model.Selected, model.Hidden).Select(node => (model, node)));
            }
        }

        return objects;
    }

    /// <summary>Cut, Copy and New assembly take objects of one model (D180, D185).</summary>
    public bool CanCut => OneModelObjects() is not null;

    public bool CanCopy => CanCut;

    public bool CanGroup => CanCut;

    public bool CanPaste => PasteTarget() is not null;

    /// <summary>Delete removes objects in Object mode, and whole models in Model mode (D187).</summary>
    public bool CanDelete => Mode switch
    {
        SelectMode.Objects => EditObjects.Count > 0,
        SelectMode.Models => Models.Any(IsModelSelected),
        _ => false,
    };

    /// <summary>Ungroup has an assembly among the objects.</summary>
    public bool CanUngroup => EditObjects.Any(item => item.Model.Tree!.IsAssembly(item.Node) && item.Model.Tree.HasChildren(item.Node));

    /// <summary>Rename takes one object.</summary>
    public bool CanRename => EditObjects.Count == 1;

    /// <summary>A node Cut took, not yet pasted: the tree dims it (assumption 20).</summary>
    public bool IsCut(ModelId id, int node) => Clipboard is { Cut: true } clipboard && clipboard.Id == id && clipboard.Items.Any(item => item.Node == node);

    public void Cut() => Take(cut: true);

    public void Copy() => Take(cut: false);

    /// <summary>
    /// Paste (D152, D180): a cut's objects move to the target, keeping where they are in 3D (D151); a
    /// copy's are added there as new instances in the same place. Either way they're then selected.
    /// </summary>
    public void Paste()
    {
        if (PasteTarget() is not { } target || Clipboard is not { } clipboard)
        {
            return;
        }

        var model = target.Model;
        var tree = model.Tree!;
        if (clipboard.Cut)
        {
            List<int> moving = [.. clipboard.Items.Select(static item => item.Node).Where(tree.Contains)];
            Clipboard = null;
            if (target.Parent is not { } parent || moving.All(node => tree.ParentOf(node) == parent))
            {
                Set(Models, always: true);
                return;
            }

            ApplyEdit("Paste", model, tree.Edit().Move(moving, parent, target.After).Build(), model.Hidden, moving);
            return;
        }

        var edit = tree.Edit();
        var copies = edit.Copy(clipboard.Items, target.Parent, target.After);
        var next = edit.Build();
        // A copy of a hidden part is hidden too (assumption 17).
        var hidden = model.Hidden.Union(Enumerable.Range(tree.Count, next.Count - tree.Count).Where(node => model.Hidden.Contains(next.SourceOf(node))));
        ApplyEdit("Paste", model, next, hidden, copies);
    }

    /// <summary>
    /// Delete (D152): in Object mode the objects leave their models, with no question since it can be
    /// undone, and an assembly left empty goes too (D181); in Model mode the list asks before deleting
    /// the selected models (D29, D187).
    /// </summary>
    public void DeleteSelection()
    {
        if (Mode == SelectMode.Models)
        {
            List<ModelId> selected = [.. Models.Where(IsModelSelected).Select(static model => model.Id)];
            if (selected.Count > 0)
            {
                DeleteModelsRequested?.Invoke(selected);
            }

            return;
        }

        var steps = new List<ISceneStep>();
        var models = Models;
        foreach (var group in EditObjects.GroupBy(static item => item.Model.Id))
        {
            var model = group.First().Model;
            var before = model.EditState;
            var next = model.Tree!.Edit().Remove(group.Select(static item => item.Node)).Build();
            var edited = model.WithEdit(before with { Edits = next.Edits, Tree = next, Selected = PartSet.Empty });
            steps.Add(new EditStep(model.Id, before, edited.EditState, "Delete"));
            models = models.Replace(model, edited);
        }

        if (steps.Count > 0)
        {
            Record(steps is [var step] ? step : new StepGroup([.. steps]));
            Set(models);
        }
    }

    /// <summary>Deletes models after the list asked (Model mode, D187): each its own step, as the list's delete is (D84).</summary>
    public void DeleteModels(IEnumerable<ModelId> ids)
    {
        foreach (var id in ids)
        {
            Delete(id);
        }
    }

    /// <summary>
    /// New assembly (Ctrl+G, D152, D184â€“D186): the objects go into a new assembly at its parent's origin,
    /// in their shared parent, named "Assembly n" and opened for renaming.
    /// </summary>
    public void Group()
    {
        if (OneModelObjects() is not { } objects)
        {
            return;
        }

        var model = objects.Model;
        var tree = model.Tree!;
        var edit = tree.Edit();
        var group = edit.Group(objects.Nodes, tree.NextAssemblyName());
        ApplyEdit("New assembly", model, edit.Build(), model.Hidden, [group]);
        Renaming = new Renaming(model.Id, group, IsNew: true);
        RevealRequested?.Invoke(model.Id, group);
        Set(Models, always: true);
    }

    /// <summary>Ungroup (Ctrl+Shift+G, D183): each assembly among the objects goes, its children taking its place.</summary>
    public void Ungroup()
    {
        foreach (var group in EditObjects.Where(static item => item.Model.Tree!.IsAssembly(item.Node)).GroupBy(static item => item.Model.Id).ToList())
        {
            var model = Find(group.Key)!;
            var tree = model.Tree!;
            List<int> assemblies = [.. group.Select(static item => item.Node)];
            var children = assemblies.SelectMany(tree.ChildrenOf).ToList();
            ApplyEdit("Ungroup", model, tree.Edit().Ungroup(assemblies).Build(), model.Hidden, children);
        }
    }

    /// <summary>F2 or the menu's Rename (D183): the object's name opens for editing in the tree, which shows it.</summary>
    public void BeginRename()
    {
        if (EditObjects is [var only])
        {
            Renaming = new Renaming(only.Model.Id, only.Node, IsNew: false);
            RevealRequested?.Invoke(only.Model.Id, only.Node);
            Set(Models, always: true);
        }
    }

    /// <summary>
    /// The name typed (Enter, or leaving the field): a rename, unless it's empty or unchanged. Esc ends
    /// it with <paramref name="name"/> null, which keeps the name, a new assembly's default too (D186).
    /// </summary>
    public void EndRename(string? name)
    {
        if (Renaming is not { } renaming)
        {
            return;
        }

        Renaming = null;
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed) || Find(renaming.Id) is not { Tree: { } tree } model || !tree.Contains(renaming.Node) || tree.NameOf(renaming.Node) == trimmed)
        {
            Set(Models, always: true);
            return;
        }

        ApplyEdit("Rename", model, tree.Edit().Rename(renaming.Node, trimmed).Build(), model.Hidden, selectNodes: null);
    }

    /// <summary>
    /// A tree node dropped on an assembly or on its model's name (<paramref name="target"/> -1, the top
    /// level; D182): the selection's objects when the node is one of them, else the node alone, move
    /// there, or with Ctrl are copied there (D183). Refused into the dragged objects' own subtrees, onto
    /// a part, or outside Object mode.
    /// </summary>
    public void Drop(ModelId id, int node, int target, bool copy)
    {
        if (Mode != SelectMode.Objects || Find(id) is not { Tree: { } tree } model || !tree.Contains(node) ||
            (target != ModelTree.TopLevel && !tree.IsAssembly(target)))
        {
            return;
        }

        var selected = EditObjects.Where(item => item.Model.Id == id).Select(static item => item.Node).ToList();
        List<int> nodes = selected.Any(item => tree.IsWithin(node, item)) ? selected : [node];
        if (nodes.Any(item => tree.IsWithin(target, item)))
        {
            return;
        }

        if (copy)
        {
            var edit = tree.Edit();
            var copies = edit.Copy(nodes.Select(item => (item, tree.ParentOf(item))), target);
            var next = edit.Build();
            ApplyEdit("Copy in the tree", model, next, model.Hidden.Union(Enumerable.Range(tree.Count, next.Count - tree.Count).Where(added => model.Hidden.Contains(next.SourceOf(added)))), copies);
        }
        else if (nodes.Any(item => tree.ParentOf(item) != target))
        {
            ApplyEdit("Move in the tree", model, tree.Edit().Move(nodes, target).Build(), model.Hidden, nodes);
        }
    }

    /// <summary>Expand takes one object, a compound part (M15, D154, D190).</summary>
    public (ModelEntry Model, int Node)? ExpandTarget =>
        EditObjects is [var only] && only.Model.Tree!.IsExpandable(only.Node) ? only : null;

    /// <summary>
    /// Expand all (D154, D197): the compound parts under the objects in Object mode, unless the one object
    /// is a compound part (that's Expand), or in the selected models in Model mode; by model, in tree order.
    /// </summary>
    public IReadOnlyList<(ModelId Id, IReadOnlyList<int> Parts)> ExpandAllTargets
    {
        get
        {
            IEnumerable<(ModelId, IReadOnlyList<int>)> targets = Mode switch
            {
                SelectMode.Objects when ExpandTarget is null => EditObjects
                    .GroupBy(static item => item.Model.Id)
                    .Select(static group =>
                    {
                        var tree = group.First().Model.Tree!;
                        IReadOnlyList<int> parts = [.. group.SelectMany(item => tree.PartsUnder(item.Node)).Where(tree.IsExpandable).Distinct()];
                        return (group.Key, parts);
                    }),
                SelectMode.Models => Models
                    .Where(model => IsModelSelected(model) && model.Tree is not null)
                    .Select(static model => (model.Id, (IReadOnlyList<int>)[.. model.Tree!.Parts.Where(model.Tree.IsExpandable)])),
                _ => [],
            };
            return [.. targets.Where(static target => target.Item2.Count > 0)];
        }
    }

    /// <summary>
    /// Expand and Expand all (M15, D154, D189): each part gives way to an assembly of its pieces, as the
    /// viewer's expansions of their file parts give them, all in one step. In Object mode the assemblies
    /// are then selected; a hidden part's pieces stay hidden, as a hidden part's copies do (assumption 17),
    /// and the tree shows the first assembly's pieces.
    /// </summary>
    public void Expand(ModelId id, IReadOnlyList<int> parts, IReadOnlyList<Interop.PartExpansion> expansions)
    {
        if (PlanExpand(id, parts, expansions) is { } plan)
        {
            ApplyExpand(plan);
        }
    }

    /// <summary>
    /// Works out an Expand's new tree without making it (M16, D199), so the work can be split from the
    /// edit: Expand all of the large plant's 840 parts took 0.1 s here alone. Null when nothing expands.
    /// </summary>
    public ExpandPlan? PlanExpand(ModelId id, IReadOnlyList<int> parts, IReadOnlyList<Interop.PartExpansion> expansions)
    {
        if (Find(id) is not { Tree: { } tree })
        {
            return null;
        }

        var pieces = expansions.ToDictionary(static expansion => expansion.Node, static expansion => expansion.Pieces);
        var edit = tree.Edit();
        List<int> assemblies = [];
        foreach (var part in parts)
        {
            if (tree.IsExpandable(part) && pieces.TryGetValue(tree.FileNodeOf(part), out var expansion))
            {
                assemblies.Add(edit.Expand(part, expansion));
            }
        }

        return assemblies.Count == 0 ? null : new ExpandPlan(id, tree, edit, assemblies);
    }

    /// <summary>Makes a planned Expand, unless the model's tree has changed since: then it returns false.</summary>
    public bool ApplyExpand(ExpandPlan plan)
    {
        if (Find(plan.Id) is not { Tree: { } tree } model || !ReferenceEquals(tree, plan.Before))
        {
            return false;
        }

        var next = plan.Next;
        var hidden = model.Hidden.Union(next.Edits.Pieces.Where(item => item.Key >= tree.Count && item.Value.Part && model.Hidden.Contains(item.Value.Expands)).Select(static item => item.Key));
        ApplyEdit("Expand", model, next, hidden, Mode == SelectMode.Objects ? plan.Assemblies : null);
        // The tree opens to the first assembly's pieces, as it does to a new assembly.
        if (next.ChildrenOf(plan.Assemblies[0]) is [var first, ..])
        {
            RevealRequested?.Invoke(model.Id, first);
        }

        return true;
    }

    /// <summary>What a model draws after an edit, as the viewer counted it: its item's figures.</summary>
    public void ReportStats(ModelId id, Interop.ModelStats stats) => Update(id, model => model.WithStats(stats));

    /// <summary>Cut or Copy: the objects of one model, with their parents now.</summary>
    private void Take(bool cut)
    {
        if (OneModelObjects() is { } objects)
        {
            var tree = objects.Model.Tree!;
            Clipboard = new Clipboard(objects.Model.Id, [.. objects.Nodes.Select(node => (node, tree.ParentOf(node)))], cut);
            Set(Models, always: true);
        }
    }

    /// <summary>The objects, when they're all in one model; null for none, or for several models.</summary>
    private (ModelEntry Model, IReadOnlyList<int> Nodes)? OneModelObjects()
    {
        var objects = EditObjects;
        return objects.Count > 0 && objects.All(item => item.Model.Id == objects[0].Model.Id)
            ? (objects[0].Model, [.. objects.Select(static item => item.Node)])
            : null;
    }

    /// <summary>
    /// Where Paste puts the clipboard's objects (D180): into the one selected object if it's an assembly,
    /// beside it if it's a part, or beside the originals (a null parent) with nothing else selected or the
    /// copied objects themselves. Null when there's nothing to paste, or the selection is in another model.
    /// </summary>
    private (ModelEntry Model, int? Parent, int? After)? PasteTarget()
    {
        if (Mode != SelectMode.Objects || Clipboard is not { } clipboard || Find(clipboard.Id) is not { Tree: { } tree } model)
        {
            return null;
        }

        if (clipboard.Cut && !clipboard.Items.Any(item => tree.Contains(item.Node)))
        {
            return null;
        }

        var objects = EditObjects;
        if (objects.Any(item => item.Model.Id != clipboard.Id))
        {
            return null;
        }

        if (objects is [var only] && !clipboard.Items.Any(item => tree.IsWithin(only.Node, item.Node)))
        {
            return tree.IsAssembly(only.Node) ? (model, only.Node, null) : (model, tree.ParentOf(only.Node), only.Node);
        }

        return (model, null, null);
    }

    /// <summary>
    /// Records and applies an edit of one model as one step: its new tree and hidden parts, with what it
    /// selects (the visible parts under <paramref name="selectNodes"/>, or the selection as it was); a
    /// node's moves are dropped once its parent changes, since they're in the old parent's frame and the
    /// viewer keeps its place (D151).
    /// </summary>
    private void ApplyEdit(string label, ModelEntry model, ModelTree next, PartSet hidden, IReadOnlyList<int>? selectNodes)
    {
        var tree = model.Tree!;
        var before = model.EditState;
        List<int> reparented = [.. before.Placements.Keys.Where(node => node >= 0 && (!next.Contains(node) || next.ParentOf(node) != tree.ParentOf(node)))];
        var placements = before.Placements.RemoveRange(reparented);
        var selected = selectNodes is not null
            ? PartSet.From(selectNodes.Where(next.Contains).SelectMany(next.PartsUnder).Where(part => !hidden.Contains(part)))
            // A model selected in Model mode stays selected whole, Expand all's pieces included (M16).
            : Mode == SelectMode.Models && !model.Selected.IsEmpty
                ? PartSet.From(next.Parts.Where(part => !hidden.Contains(part)))
                : model.Selected;
        var edited = model.WithEdit(new ModelEdit(next.Edits, hidden, selected, placements) { Tree = next });
        Record(new EditStep(model.Id, before, edited.EditState, label));
        if (selectNodes is not null)
        {
            _anchor = selectNodes is [var only] ? (model.Id, only) : null;
            // The rest of the scene's selection goes: the edited objects are what's selected now.
            Set(Models.ConvertAll(other => other.Id == model.Id ? edited : other.WithParts(other.Hidden, [])));
        }
        else
        {
            Update(model.Id, _ => edited);
        }
    }
}
