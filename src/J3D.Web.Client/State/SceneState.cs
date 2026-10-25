using System.Collections.Immutable;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

/// <summary>
/// The models in the scene and how their imports are going, in import order (decision D57). The
/// <c>Viewport</c> feeds it from the viewer's callbacks and the <c>ModelList</c> renders it. Scoped
/// (D56): one per tab under WebAssembly, and never shared between the host's prerender requests.
/// Since M6 it also owns each model's selected and hidden parts and the undo history (D95): the
/// <c>Viewport</c> applies them to the viewer. Since M8 it lists the models kept from the last visit,
/// and deleting a model is an undoable step (D84): the viewer frees the model, keeping its files, and
/// an undo imports it again under the same id (D117). Since M12 it holds the selection mode (D146) and
/// the features the viewer reports selected, the Measure tool's reference and result (D147), which
/// aren't kept or undoable, and asks for the context menu (D164). Since M13 it holds the Move tool, its
/// frame and target, and the origin frames (D148–D150), and moves are undoable steps (D145). Since M14
/// it edits models' trees, with a clipboard of its own (SceneState.Editing.cs).
/// </summary>
public sealed partial class SceneState
{
    private readonly UndoHistory _history = new();

    /// <summary>Raised after every change to <see cref="Models"/>, the history, the mode, the features or the measurement.</summary>
    public event Action? Changed;

    /// <summary>Raised when a part picked in 3D should be shown in its model's tree (D96).</summary>
    public event Action<ModelId, int>? RevealRequested;

    /// <summary>Raised when a model is deleted, or a delete redone: the viewer frees it but keeps its files (D84).</summary>
    public event Action<ModelId>? DeleteRequested;

    /// <summary>Raised when models are listed again, from the last visit or by an undo: the viewer imports them from their kept files.</summary>
    public event Action<IReadOnlyList<ModelEntry>>? RestoreRequested;

    /// <summary>Raised when no step can bring a deleted model back any more: the viewer drops its files.</summary>
    public event Action<ModelId>? ForgetRequested;

    /// <summary>Raised by Clear all (D110): the viewer removes every model and everything kept.</summary>
    public event Action? ClearAllRequested;

    /// <summary>Raised when the selected features should go (Esc, D146): the viewer owns them.</summary>
    public event Action? ClearFeaturesRequested;

    /// <summary>Raised when the context menu should open (D164), after its target has been selected.</summary>
    public event Action<ContextMenuTarget>? ContextMenuRequested;

    /// <summary>Raised when the context menu asks for a GLB or STL export: of the selection, or of the visible scene.</summary>
    public event Action<MeshExportFormat, bool>? ExportRequested;

    public ImmutableList<ModelEntry> Models { get; private set; } = [];

    /// <summary>What a click selects (D146).</summary>
    public SelectMode Mode { get; private set; } = SelectMode.Objects;

    /// <summary>The faces, edges and vertices selected in Feature mode, as the viewer reports them (D146, D163).</summary>
    public FeatureSelection Features { get; private set; } = FeatureSelection.Empty;

    /// <summary>The Measure tool is on: clicks pick faces, edges and vertices instead of selecting (D79).</summary>
    public bool MeasureMode { get; private set; }

    /// <summary>The Measure tool's reference and its values, until Esc (D147).</summary>
    public MeasureInfo? MeasureReference { get; private set; }

    /// <summary>The reference against the last click, replaced by each click (D147).</summary>
    public MeasureInfo? MeasureResult { get; private set; }

    /// <summary>The Measure tool was asked to start from the entity under the last right click, not yet passed to the viewer.</summary>
    public bool MeasureFromContextRequested { get; private set; }

    /// <summary>The Move tool's mode (M13, D149), or null when it's off.</summary>
    public MoveMode? Moving { get; private set; }

    /// <summary>The frame the fields and the triad use (D148).</summary>
    public MoveFrame Frame { get; private set; } = MoveFrame.Local;

    /// <summary>The origin frames are drawn at the selected objects (D150, D171).</summary>
    public bool OriginFrames { get; private set; }

    /// <summary>Where the viewer says the Move tool's target is, or null (D148).</summary>
    public MoveTargetInfo? TargetPlacement { get; private set; }

    /// <summary>The most origin frames drawn at once: past it, a selection of thousands of parts would be a cloud of axes.</summary>
    public const int MaxOriginFrames = 256;

    /// <summary>The part picked in the view, or the node picked in the tree, last: what the Move tool moves while it's still the selection (D167).</summary>
    private (ModelId Id, int Node)? _anchor;

    /// <summary>
    /// The one object the Move tool moves (D167): in Model mode a single selected model (node
    /// <see cref="ModelEntry.ModelFrameNode"/>); in Object mode the node last picked in the tree, or the
    /// part picked in the view, while the selection is exactly its visible parts, or else a single
    /// selected part. Nothing in Feature mode, or for any other selection.
    /// </summary>
    public (ModelId Id, int Node)? MoveTarget
    {
        get
        {
            if (Mode == SelectMode.Features || Models.Where(model => !model.Selected.IsEmpty).ToList() is not [var model])
            {
                return null;
            }

            if (Mode == SelectMode.Models)
            {
                return IsModelSelected(model) ? (model.Id, ModelEntry.ModelFrameNode) : null;
            }

            if (_anchor is { } anchor && anchor.Id == model.Id && model.Tree is { } tree && tree.Contains(anchor.Node) &&
                model.Selected.SetEquals(tree.PartsUnder(anchor.Node).Where(part => !model.Hidden.Contains(part))))
            {
                return anchor;
            }

            return model.Selected.Count == 1 ? (model.Id, model.Selected.Single()) : null;
        }
    }

    /// <summary>Why the Move tool has nothing to move, while it's on without a target.</summary>
    public string? MoveHint => Moving is null || MoveTarget is not null
        ? null
        : Mode == SelectMode.Features
            ? "Feature mode selects faces, edges and vertices: switch to Model or Object mode (1 or 2) to move."
            : HasSelection
                ? "Select one part, a sub-assembly in the tree, or one model in Model mode to move it."
                : "Select a part, a sub-assembly or a model to move it.";

    /// <summary>
    /// Where the origin frames go (D150): the Move tool's target, or else each selected model (Model
    /// mode) or part (Object mode), at most <see cref="MaxOriginFrames"/>. None while they're off.
    /// </summary>
    public IReadOnlyList<(ModelId Id, int Node)> OriginFrameTargets
    {
        get
        {
            if (!OriginFrames || Mode == SelectMode.Features)
            {
                return [];
            }

            if (MoveTarget is { } target)
            {
                return [target];
            }

            return Mode == SelectMode.Models
                ? [.. Models.Where(IsModelSelected).Select(model => (model.Id, ModelEntry.ModelFrameNode))]
                : [.. Selection.Take(MaxOriginFrames).Select(item => (item.Model.Id, item.Node))];
        }
    }

    /// <summary>The target's pose in the chosen frame, as the fields show it (D148): always zero in Local.</summary>
    public Pose? TargetPose => TargetPlacement is not { } placement || MoveTarget is not { } target || (placement.Id, placement.Node) != target
        ? null
        : Frame switch
        {
            MoveFrame.Local => Pose.Zero,
            MoveFrame.Parent => Pose.Of(CurrentLocal(placement), placement.UnitScale),
            _ => Pose.Of(placement.ParentWorldMatrix * CurrentLocal(placement), placement.UnitScale),
        };

    public bool CanUndo => _history.CanUndo;

    public bool CanRedo => _history.CanRedo;

    /// <summary>Clear all has something to clear: a model, or a deleted one an undo could bring back (D110).</summary>
    public bool CanClearAll => !Models.IsEmpty || CanUndo || CanRedo;

    /// <summary>Every selected part, in list order, then tree order.</summary>
    public IReadOnlyList<(ModelEntry Model, int Node)> Selection =>
        [.. Models.SelectMany(model => model.Selected.Order().Select(node => (model, node)))];

    public bool HasSelection => Models.Any(model => !model.Selected.IsEmpty);

    public bool HasHidden => Models.Any(model => !model.Hidden.IsEmpty);

    /// <summary>Isolate would change something: there's a selection and a visible part outside it.</summary>
    public bool CanIsolate => HasSelection && Models.Any(model =>
        model.Tree is { } tree && tree.Parts.Any(part => !model.Hidden.Contains(part) && !model.Selected.Contains(part)));

    /// <summary>The toolbar's Export menu has something to save: a selection, or a visible part (M9).</summary>
    public bool CanExport => HasSelection || Models.Any(model =>
        model.Tree is { } tree && tree.Parts.Any(part => !model.Hidden.Contains(part)));

    public ModelEntry? Find(ModelId id) => Models.Find(model => model.Id == id);

    /// <summary>A model was queued. It goes to the end of the list.</summary>
    public void Add(ModelSummary summary)
    {
        if (Find(summary.Id) is null)
        {
            Set(Models.Add(new ModelEntry(summary)));
        }
    }

    public void ReportProgress(ModelId id, ImportPhase phase, double? fraction) =>
        Update(id, model => model.WithProgress(phase, fraction));

    public void MarkLoaded(ModelId id, ModelLoadedInfo info) => Update(id, model => model.AsLoaded(info));

    public void MarkFailed(ModelId id, ImportError error) => Update(id, model => model.AsFailed(error));

    /// <summary>
    /// The models kept from the last visit, in their order, each to be imported again with its hidden
    /// parts (D82). They follow any already listed.
    /// </summary>
    public void Restore(IEnumerable<StoredModel> models)
    {
        List<ModelEntry> added = [.. models
            .Where(model => Find(model.Summary.Id) is null)
            .DistinctBy(model => model.Summary.Id)
            .Select(model => ModelEntry.Restoring(model.Summary, model.Hidden))];
        if (added.Count > 0)
        {
            Set(Models.AddRange(added));
            RestoreRequested?.Invoke(added);
        }
    }

    /// <summary>Deletes a model as an undoable step (D84): the viewer frees it at once, keeping its files for an undo.</summary>
    public void Delete(ModelId id)
    {
        var index = Models.FindIndex(model => model.Id == id);
        if (index < 0)
        {
            return;
        }

        var step = new DeleteStep(Models[index], index);
        Record(step);
        Apply(step.Redo(new SceneContent(Models)));
    }

    /// <summary>Clear all (D110): every model and step goes, and the viewer removes everything kept. It can't be undone.</summary>
    public void ClearAll()
    {
        _history.Clear();
        MeasureReference = null;
        MeasureResult = null;
        Features = FeatureSelection.Empty;
        Set([], always: true);
        ClearAllRequested?.Invoke();
    }

    /// <summary>A model's STEP or BREP export started (its format, no progress yet), or ended (null) (D125).</summary>
    public void SetExport(ModelId id, BrepExportFormat? format) =>
        Update(id, model => model.WithExport(format is { } started ? new ModelExport(started, null) : null));

    /// <summary>How far a model's export is: a fraction, or null while OCCT can't tell.</summary>
    public void ReportExportProgress(ModelId id, double? fraction) =>
        Update(id, model => model.Export is { } export ? model.WithExport(export with { Fraction = fraction }) : model);

    /// <summary>The viewer couldn't keep a model's files for the next visit (D115).</summary>
    public void MarkNotKept(ModelId id, bool full) =>
        Update(id, model => model.AsNotKept(full ? "storage full" : "couldn't be stored"));

    /// <summary>The viewer cancelled or dismissed the model: it's gone for good, and its undo steps go with it.</summary>
    public void Remove(ModelId id)
    {
        var index = Models.FindIndex(model => model.Id == id);
        if (index >= 0)
        {
            _history.Forget(id);
            Set(Models.RemoveAt(index), always: true);
        }
    }

    /// <summary>Forgets every model, because the viewer that held them has gone.</summary>
    public void Clear()
    {
        _history.Clear();
        MeasureReference = null;
        MeasureResult = null;
        Features = FeatureSelection.Empty;
        if (!Models.IsEmpty)
        {
            Set([], always: true);
        }
    }

    /// <summary>
    /// The toolbar's mode switch or the keys 1, 2 and 3 (D146, D162). The selection is converted: from
    /// Object to Model, every model with a selected part is selected whole; from Model to Object, its
    /// parts stay selected; switching to or from Feature clears it.
    /// </summary>
    public void SetSelectionMode(SelectMode mode)
    {
        if (mode == Mode)
        {
            return;
        }

        var models = Models;
        if (mode == SelectMode.Features || Mode == SelectMode.Features)
        {
            models = models.ConvertAll(model => model.WithParts(model.Hidden, []));
        }
        else if (mode == SelectMode.Models)
        {
            models = models.ConvertAll(model => model.Selected.IsEmpty ? model : model.WithParts(model.Hidden, VisibleParts(model)));
        }

        Mode = mode;
        Features = FeatureSelection.Empty; // the viewer drops its own as it changes mode
        Set(models, always: true);
    }

    /// <summary>The features the viewer has selected, once their values are known (D146).</summary>
    public void SetFeatures(FeatureSelection features)
    {
        Features = Mode == SelectMode.Features ? features : FeatureSelection.Empty;
        Set(Models, always: true);
    }

    /// <summary>The toolbar's Measure button or the M key (D79). Turning it off drops the reference and the result (D147).</summary>
    public void ToggleMeasureMode() => SetMeasureMode(!MeasureMode);

    public void SetMeasureMode(bool on)
    {
        if (on != MeasureMode)
        {
            MeasureMode = on;
            Moving = on ? null : Moving;
            MeasureReference = null;
            MeasureResult = null;
            MeasureFromContextRequested = false;
            Set(Models, always: true);
        }
    }

    /// <summary>"Measure from here" (D164): the Measure tool starts again, from the entity under the right click.</summary>
    public void MeasureFromHere()
    {
        MeasureMode = true;
        Moving = null;
        MeasureReference = null;
        MeasureResult = null;
        MeasureFromContextRequested = true;
        Set(Models, always: true);
    }

    /// <summary>Isolate has changed what's visible, and the view should fit what's left once the viewer has it.</summary>
    public bool FitRequested { get; private set; }

    /// <summary>The <c>Viewport</c> has fitted the view after an Isolate.</summary>
    public bool TakeFitRequest()
    {
        var requested = FitRequested;
        FitRequested = false;
        return requested;
    }

    /// <summary>The <c>Viewport</c> has passed a "Measure from here" on to the viewer.</summary>
    public bool TakeMeasureFromContext()
    {
        var requested = MeasureFromContextRequested;
        MeasureFromContextRequested = false;
        return requested;
    }

    /// <summary>The viewer's reference, or null when it's gone (D147).</summary>
    public void SetMeasureReference(MeasureInfo? reference)
    {
        MeasureReference = MeasureMode ? reference : null;
        Set(Models, always: true);
    }

    /// <summary>The reference against the last click, or null.</summary>
    public void SetMeasureResult(MeasureInfo? result)
    {
        MeasureResult = MeasureMode ? result : null;
        Set(Models, always: true);
    }

    /// <summary>
    /// Esc (D99, D147): the Measure tool's measurement goes and the tool turns off; otherwise the
    /// selection is cleared.
    /// </summary>
    public void Escape()
    {
        if (MeasureMode)
        {
            SetMeasureMode(false);
        }
        else if (Moving is not null)
        {
            StopMoving();
        }
        else
        {
            ClearSelection();
        }
    }

    /// <summary>
    /// A click in the viewport (D77): on a part, it becomes the selection, or with Ctrl it's added
    /// or removed; on empty space (no model), the selection is cleared unless Ctrl was held. The
    /// tree then reveals the part (D96). In Model mode the part's whole model is selected (D146).
    /// </summary>
    public void Pick(ModelId? id, int node, bool additive)
    {
        var target = id is { } modelId ? Find(modelId) : null;
        if (target?.Tree is not { } tree || !tree.IsPart(node) || target.Hidden.Contains(node))
        {
            if (!additive)
            {
                ClearSelection();
            }

            return;
        }

        if (Mode == SelectMode.Models)
        {
            SelectModel(target, additive);
            return;
        }

        if (!additive)
        {
            _anchor = (target.Id, node);
        }

        if (additive)
        {
            var removed = target.Selected.Remove(node);
            var selected = removed.Count < target.Selected.Count ? removed : target.Selected.Add(node);
            Update(target.Id, model => model.WithParts(model.Hidden, selected));
        }
        else
        {
            Set(Models.ConvertAll(model => model.WithParts(model.Hidden, model.Id == target.Id ? [node] : [])));
        }

        if (Find(target.Id)!.Selected.Contains(node))
        {
            RevealRequested?.Invoke(target.Id, node);
        }
    }

    /// <summary>
    /// A click on a tree node: the visible parts under it become the selection, or with Ctrl are
    /// added, or removed when they're all selected already (D77, D96). In Model mode its whole model
    /// is selected; in Feature mode, which has no parts selected, it switches to Object first (D146).
    /// </summary>
    public void SelectNode(ModelId id, int node, bool additive)
    {
        if (Find(id) is not { Tree: { } tree } target || !tree.Contains(node))
        {
            return;
        }

        if (Mode == SelectMode.Models)
        {
            SelectModel(target, additive);
            return;
        }

        if (Mode == SelectMode.Features)
        {
            SetSelectionMode(SelectMode.Objects);
            target = Find(id)!;
        }

        var parts = tree.PartsUnder(node).Where(part => !target.Hidden.Contains(part)).ToList();
        if (!additive)
        {
            _anchor = (id, node);
            Set(Models.ConvertAll(model => model.WithParts(model.Hidden, model.Id == id ? parts : [])));
        }
        else if (parts.Count > 0)
        {
            var selected = parts.All(target.Selected.Contains) ? target.Selected.Except(parts) : target.Selected.Union(parts);
            Update(id, model => model.WithParts(model.Hidden, selected));
        }
    }

    /// <summary>Clears the selected parts, and in Feature mode the selected features, which the viewer holds.</summary>
    public void ClearSelection()
    {
        if (Mode == SelectMode.Features && !Features.IsEmpty)
        {
            Features = FeatureSelection.Empty;
            ClearFeaturesRequested?.Invoke();
            Set(Models, always: true);
        }

        Set(Models.ConvertAll(model => model.WithParts(model.Hidden, [])));
    }

    /// <summary>A model selected whole (Model mode): every visible part of it.</summary>
    public static bool IsModelSelected(ModelEntry model) =>
        model.Tree is not null && !model.Selected.IsEmpty && VisibleParts(model).All(model.Selected.Contains);

    /// <summary>
    /// A right click in the viewport that didn't drag (D164): on a part, outside Feature mode, the part
    /// (or in Model mode its model) is selected unless it already is, and the menu offers its commands;
    /// elsewhere the scene's. The viewer has already selected a feature under it in Feature mode.
    /// </summary>
    public void OpenContextMenu(ModelId? id, int node, double x, double y, bool canMeasure)
    {
        var onTarget = false;
        if (Mode != SelectMode.Features && id is { } modelId && Find(modelId) is { Tree: { } tree } target && tree.IsPart(node) && !target.Hidden.Contains(node))
        {
            onTarget = true;
            var selected = Mode == SelectMode.Models ? IsModelSelected(target) : target.Selected.Contains(node);
            if (!selected)
            {
                Pick(modelId, node, additive: false);
            }
        }

        ContextMenuRequested?.Invoke(new ContextMenuTarget(x, y, onTarget, canMeasure));
    }

    /// <summary>A right click on a tree node (D164): the node is selected unless it already is, then the menu opens.</summary>
    public void OpenNodeContextMenu(ModelId id, int node, double x, double y)
    {
        if (Find(id) is not { Tree: { } tree } target || !tree.Contains(node))
        {
            return;
        }

        var selected = Mode switch
        {
            SelectMode.Models => IsModelSelected(target),
            SelectMode.Objects => target.IsSelected(node),
            _ => false,
        };
        if (!selected)
        {
            SelectNode(id, node, additive: false);
        }

        ContextMenuRequested?.Invoke(new ContextMenuTarget(x, y, OnTarget: HasSelection, CanMeasure: false));
    }

    /// <summary>The context menu's Export: GLB or STL of the selection, or of the visible scene.</summary>
    public void RequestExport(MeshExportFormat format, bool selection) => ExportRequested?.Invoke(format, selection);

    /// <summary>Hides the selected parts, which leaves the selection empty (D78, D98).</summary>
    public void HideSelection() => ChangeVisibility(model => model.Hidden.Union(model.Selected));

    /// <summary>
    /// Hides every part outside the selection, in every model (assumption 9), and fits the view to what's
    /// left, so the isolated parts aren't left off to one side.
    /// </summary>
    public void IsolateSelection()
    {
        if (CanIsolate)
        {
            FitRequested = true;
            ChangeVisibility(model => [.. model.Tree?.Parts.Where(part => !model.Selected.Contains(part)) ?? []]);
        }
    }

    /// <summary>Shows every part of every model.</summary>
    public void ShowAll() => ChangeVisibility(static _ => []);

    /// <summary>A tree node's eye: shows its parts when they're all hidden, otherwise hides them all.</summary>
    public void ToggleNodeVisibility(ModelId id, int node)
    {
        if (Find(id) is not { Tree: { } tree } target || !tree.Contains(node))
        {
            return;
        }

        var parts = tree.PartsUnder(node);
        var hidden = target.VisibilityOf(node) == PartVisibility.Hidden ? target.Hidden.Except(parts) : target.Hidden.Union(parts);
        ChangeVisibility(model => model.Id == id ? hidden : model.Hidden);
    }

    /// <summary>A list item's eye: the same for the whole model.</summary>
    public void ToggleModelVisibility(ModelId id)
    {
        if (Find(id) is not { Tree: { } tree } target)
        {
            return;
        }

        var hidden = target.Visibility() == PartVisibility.Hidden ? [] : PartSet.From(tree.Parts);
        ChangeVisibility(model => model.Id == id ? hidden : model.Hidden);
    }

    /// <summary>
    /// W or E, the toolbar's Move button or the context menu (D166): the Move tool on in that mode, or
    /// off when it's already in it. It and the Measure tool take turns.
    /// </summary>
    public void SetMoveMode(MoveMode mode)
    {
        Moving = Moving == mode ? null : mode;
        if (Moving is not null && MeasureMode)
        {
            MeasureMode = false;
            MeasureReference = null;
            MeasureResult = null;
            MeasureFromContextRequested = false;
        }

        Set(Models, always: true);
    }

    public void StopMoving()
    {
        if (Moving is not null)
        {
            Moving = null;
            Set(Models, always: true);
        }
    }

    public void SetMoveFrame(MoveFrame frame)
    {
        if (frame != Frame)
        {
            Frame = frame;
            Set(Models, always: true);
        }
    }

    /// <summary>The Origin frames button or O (D171).</summary>
    public void ToggleOriginFrames()
    {
        OriginFrames = !OriginFrames;
        Set(Models, always: true);
    }

    /// <summary>The viewer's report of the Move tool's target and where it is, or null.</summary>
    public void ReportMoveTarget(MoveTargetInfo? info)
    {
        if (info is null && TargetPlacement is null)
        {
            return; // the viewer says so after each edit (M14); redrawing the page for it cost a large tree 45 ms
        }

        TargetPlacement = info;
        Set(Models, always: true);
    }

    /// <summary>A drag of the triad ended (D149): the viewer has the target there already, so this records the step.</summary>
    public void RecordMove(ModelId id, int node, Matrix4d before, Matrix4d after) => Move(id, node, before, after);

    /// <summary>
    /// Values typed in the fields, applied on Enter (D148): in Parent and World they're the target's new
    /// pose in that frame; in Local, a move and turn by them about its own axes. False when there's no
    /// target to move.
    /// </summary>
    public bool MoveTo(Pose pose)
    {
        ArgumentNullException.ThrowIfNull(pose);
        if (TargetPose is null || TargetPlacement is not { } placement)
        {
            return false;
        }

        var local = CurrentLocal(placement);
        var parentWorld = placement.ParentWorldMatrix;
        var after = Frame switch
        {
            MoveFrame.Local => local * pose.ToMatrix(placement.UnitScale, (1, 1, 1)),
            MoveFrame.Parent => pose.ToMatrix(placement.UnitScale, local.Scale()),
            _ => parentWorld.Inverse() * pose.ToMatrix(placement.UnitScale, (parentWorld * local).Scale()),
        };
        return Move(placement.Id, placement.Node, local, after);
    }

    public void Undo()
    {
        if (_history.Undo() is { } step)
        {
            Apply(step.Undo(new SceneContent(Models)));
        }
    }

    public void Redo()
    {
        if (_history.Redo() is { } step)
        {
            Apply(step.Redo(new SceneContent(Models)));
        }
    }

    /// <summary>
    /// A target's placement in its parent's frame: the latest move recorded here, which the viewer may
    /// not have reported back yet (two quick Enters), else what the viewer reported.
    /// </summary>
    private Matrix4d CurrentLocal(MoveTargetInfo placement) =>
        Find(placement.Id) is { } model && model.Placements.TryGetValue(placement.Node, out var moved) ? moved : placement.LocalMatrix;

    /// <summary>Records and applies a move as one step, unless it moves nothing.</summary>
    private bool Move(ModelId id, int node, Matrix4d before, Matrix4d after)
    {
        if (before.Equals(after) || Find(id) is not { Tree: not null })
        {
            return false;
        }

        Record(new MoveStep(id, node, before, after));
        Update(id, model => model.WithPlacement(node, after));
        return true;
    }

    private static IEnumerable<int> VisibleParts(ModelEntry model) => model.Tree?.Parts.Where(part => !model.Hidden.Contains(part)) ?? [];

    /// <summary>Model mode: a model's visible parts become the selection, or with Ctrl it's added or removed whole.</summary>
    private void SelectModel(ModelEntry target, bool additive)
    {
        if (additive)
        {
            var selected = IsModelSelected(target) ? [] : VisibleParts(target);
            Update(target.Id, model => model.WithParts(model.Hidden, selected));
        }
        else
        {
            Set(Models.ConvertAll(model => model.WithParts(model.Hidden, model.Id == target.Id ? VisibleParts(model) : [])));
        }
    }

    /// <summary>Applies an undo, a redo or a delete, and has the viewer free models that left the list and import those that came back.</summary>
    private void Apply(SceneContent content)
    {
        var before = Models;
        Set(content.Models, always: true);

        foreach (var gone in before.Where(model => !content.Models.Exists(kept => kept.Id == model.Id)))
        {
            DeleteRequested?.Invoke(gone.Id);
        }

        List<ModelEntry> back = [.. content.Models.Where(model => !before.Exists(was => was.Id == model.Id))];
        if (back.Count > 0)
        {
            RestoreRequested?.Invoke(back);
        }
    }

    /// <summary>Adds a step; a deleted model that no step can bring back any more is forgotten.</summary>
    private void Record(ISceneStep step)
    {
        foreach (var dropped in _history.Push(step).OfType<DeleteStep>())
        {
            if (Find(dropped.Id) is null && !_history.CanRestore(dropped.Id))
            {
                _history.Forget(dropped.Id);
                ForgetRequested?.Invoke(dropped.Id);
            }
        }
    }

    /// <summary>Applies new hidden parts to loaded models and records the change as one undoable step, if anything changed.</summary>
    private void ChangeVisibility(Func<ModelEntry, PartSet> hidden)
    {
        var changes = ImmutableDictionary.CreateBuilder<ModelId, (PartSet Before, PartSet After)>();
        var models = Models.ConvertAll(model =>
        {
            if (model.Tree is null)
            {
                return model;
            }

            var next = model.WithParts(hidden(model), model.Selected);
            if (!next.Hidden.SetEquals(model.Hidden))
            {
                changes[model.Id] = (model.Hidden, next.Hidden);
            }

            return next;
        });

        if (changes.Count > 0)
        {
            Record(new VisibilityStep(changes.ToImmutable()));
        }

        Set(models);
    }

    /// <summary>Applies a transition to a known model; an id the list no longer has is ignored.</summary>
    private void Update(ModelId id, Func<ModelEntry, ModelEntry> transition)
    {
        var index = Models.FindIndex(model => model.Id == id);
        if (index < 0)
        {
            return;
        }

        var current = Models[index];
        var next = transition(current);
        if (!ReferenceEquals(next, current))
        {
            Set(Models.SetItem(index, next));
        }
    }

    /// <summary>Raises <see cref="Changed"/> only when an entry changed, unless something else did (<paramref name="always"/>).</summary>
    private void Set(ImmutableList<ModelEntry> models, bool always = false)
    {
        if (!always && (ReferenceEquals(models, Models) || models.SequenceEqual(Models, ReferenceEqualityComparer.Instance)))
        {
            return;
        }

        Models = models;
        Changed?.Invoke();
    }
}
