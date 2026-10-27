using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// The Move tool, its fields and the origin frames in <see cref="SceneState"/> (M13, decisions
/// D145–D150, D165–D171). Models "a" and "b" are the bracket of <see cref="TestModels.Info"/>: parts 1,
/// 3 and 4, with 3 and 4 under the "Top" sub-assembly (node 2).
/// </summary>
public sealed class MoveStateTests
{
    private static readonly ModelId A = new("a");
    private static readonly ModelId B = new("b");

    private readonly SceneState _scene = new();

    public MoveStateTests()
    {
        foreach (var id in new[] { A, B })
        {
            _scene.Add(Summary(id.Value, $"{id.Value}.step"));
            _scene.MarkLoaded(id, Info());
        }
    }

    [Fact]
    public void The_target_is_the_part_or_tree_node_picked_or_a_whole_model()
    {
        _scene.Pick(A, 3, additive: false);
        Assert.Equal((A, 3), _scene.MoveTarget);

        _scene.SelectNode(A, 2, additive: false); // the sub-assembly, not its two parts
        Assert.Equal((A, 2), _scene.MoveTarget);

        _scene.Pick(A, 1, additive: true); // no longer one object
        Assert.Null(_scene.MoveTarget);
        _scene.Pick(A, 1, additive: true);
        Assert.Equal((A, 2), _scene.MoveTarget); // the node's parts again

        _scene.Pick(B, 1, additive: true); // across models
        Assert.Null(_scene.MoveTarget);

        _scene.SetSelectionMode(SelectMode.Models);
        _scene.Pick(B, 3, additive: false);
        Assert.Equal((B, ModelEntry.ModelFrameNode), _scene.MoveTarget);

        _scene.SetSelectionMode(SelectMode.Features);
        Assert.Null(_scene.MoveTarget);
    }

    [Fact]
    public void The_tool_toggles_by_mode_takes_turns_with_measure_and_esc_stops_it_first()
    {
        _scene.Pick(A, 3, additive: false);
        _scene.SetMoveMode(MoveMode.Translate);
        Assert.Equal(MoveMode.Translate, _scene.Moving);
        _scene.SetMoveMode(MoveMode.Rotate); // E switches to the rings
        Assert.Equal(MoveMode.Rotate, _scene.Moving);
        _scene.SetMoveMode(MoveMode.Rotate); // and again turns it off (D166)
        Assert.Null(_scene.Moving);

        _scene.SetMoveMode(MoveMode.Translate);
        _scene.SetMeasureMode(true);
        Assert.Null(_scene.Moving);
        _scene.SetMoveMode(MoveMode.Translate);
        Assert.False(_scene.MeasureMode);

        _scene.Escape();
        Assert.Null(_scene.Moving);
        Assert.True(_scene.HasSelection); // Esc first ends the tool, then clears
        _scene.Escape();
        Assert.False(_scene.HasSelection);
    }

    [Fact]
    public void Without_one_object_the_tool_says_why()
    {
        _scene.SetMoveMode(MoveMode.Translate);
        Assert.Contains("Select a part", _scene.MoveHint, StringComparison.Ordinal);

        _scene.Pick(A, 1, additive: false);
        _scene.Pick(B, 1, additive: true);
        Assert.Contains("Select one part", _scene.MoveHint, StringComparison.Ordinal);

        _scene.SetSelectionMode(SelectMode.Features);
        Assert.Contains("Feature mode", _scene.MoveHint, StringComparison.Ordinal);
    }

    [Fact]
    public void The_fields_show_the_pose_in_each_frame()
    {
        _scene.SelectNode(A, 2, additive: false);
        _scene.SetMoveMode(MoveMode.Translate);
        Assert.Null(_scene.TargetPose); // until the viewer says where it is

        _scene.ReportMoveTarget(Placement(A, 2, Translation(5, 0, 0) * RotationZ(90), Translation(100, 0, 0)));
        Assert.Equal(Pose.Zero, _scene.TargetPose);

        _scene.SetMoveFrame(MoveFrame.Parent);
        AssertPose(new Pose(5, 0, 0, 0, 0, 90), _scene.TargetPose!);

        _scene.SetMoveFrame(MoveFrame.World);
        AssertPose(new Pose(105, 0, 0, 0, 0, 90), _scene.TargetPose!);

        _scene.ReportMoveTarget(Placement(A, 3, Matrix4d.Identity, Matrix4d.Identity)); // another node's report
        Assert.Null(_scene.TargetPose);
    }

    [Fact]
    public void Typed_values_move_by_frame_as_one_undoable_step_each()
    {
        _scene.SelectNode(A, 2, additive: false);
        _scene.SetMoveMode(MoveMode.Translate);
        var start = Translation(5, 0, 0) * RotationZ(90);
        _scene.ReportMoveTarget(Placement(A, 2, start, Translation(100, 0, 0)));

        // Local: along the node's own x, which its 90° turn points along the parent's y.
        Assert.True(_scene.MoveTo(new Pose(10, 0, 0, 0, 0, 0)));
        AssertTranslation((5, 10, 0), Placed(A, 2));

        _scene.SetMoveFrame(MoveFrame.Parent);
        Assert.True(_scene.MoveTo(new Pose(1, 2, 3, 0, 0, 0)));
        AssertTranslation((1, 2, 3), Placed(A, 2));

        _scene.SetMoveFrame(MoveFrame.World); // world 150 is 50 in the parent, 100 along
        Assert.True(_scene.MoveTo(new Pose(150, 0, 0, 0, 0, 45)));
        AssertTranslation((50, 0, 0), Placed(A, 2));
        AssertPose(new Pose(50, 0, 0, 0, 0, 45), Pose.Of(Placed(A, 2), 1));

        _scene.Undo();
        AssertTranslation((1, 2, 3), Placed(A, 2));
        _scene.Undo();
        _scene.Undo();
        Assert.Equal(start, Placed(A, 2)); // back where it was imported
        Assert.StartsWith("selecting", _scene.UndoLabel ?? "selecting"); // no move left, only selections (D219)
        _scene.Redo();
        AssertTranslation((5, 10, 0), Placed(A, 2));
    }

    [Fact]
    public void A_drag_records_one_step_and_moving_nowhere_records_none()
    {
        var before = Translation(1, 0, 0);
        _scene.RecordMove(A, ModelEntry.ModelFrameNode, before, before);
        Assert.False(_scene.CanUndo);

        _scene.RecordMove(A, ModelEntry.ModelFrameNode, Matrix4d.Identity, Translation(0, 0, 7));
        AssertTranslation((0, 0, 7), Placed(A, ModelEntry.ModelFrameNode));
        _scene.Undo();
        Assert.Equal(Matrix4d.Identity, Placed(A, ModelEntry.ModelFrameNode));

        _scene.Delete(A); // a deleted model's moves leave the history with it, but come back with an undo
        Assert.False(_scene.Find(B)!.Placements.ContainsKey(ModelEntry.ModelFrameNode));
    }

    [Fact]
    public void Origin_frames_go_at_the_target_or_each_selected_part_or_model()
    {
        _scene.Pick(A, 1, additive: false);
        Assert.Empty(_scene.OriginFrameTargets); // off by default (D150)

        _scene.ToggleOriginFrames();
        Assert.Equal([(A, 1)], _scene.OriginFrameTargets);
        _scene.SelectNode(A, 2, additive: false);
        Assert.Equal([(A, 2)], _scene.OriginFrameTargets);
        _scene.Pick(B, 1, additive: true);
        Assert.Equal([(A, 3), (A, 4), (B, 1)], _scene.OriginFrameTargets);

        _scene.SetSelectionMode(SelectMode.Models);
        Assert.Equal([(A, ModelEntry.ModelFrameNode), (B, ModelEntry.ModelFrameNode)], _scene.OriginFrameTargets);

        _scene.ToggleOriginFrames();
        Assert.Empty(_scene.OriginFrameTargets);
    }

    private Matrix4d Placed(ModelId id, int node) => _scene.Find(id)!.Placements[node];

    private static MoveTargetInfo Placement(ModelId id, int node, Matrix4d local, Matrix4d parentWorld) =>
        new(id, node, local.ToArray(), parentWorld.ToArray(), 1);

    private static Matrix4d Translation(double x, double y, double z) => new Pose(x, y, z, 0, 0, 0).ToMatrix(1, (1, 1, 1));

    private static Matrix4d RotationZ(double degrees) => new Pose(0, 0, 0, 0, 0, degrees).ToMatrix(1, (1, 1, 1));

    private static void AssertTranslation((double X, double Y, double Z) expected, Matrix4d actual)
    {
        Assert.Equal(expected.X, actual[0, 3], 9);
        Assert.Equal(expected.Y, actual[1, 3], 9);
        Assert.Equal(expected.Z, actual[2, 3], 9);
    }

    private static void AssertPose(Pose expected, Pose actual)
    {
        Assert.Equal(expected.X, actual.X, 9);
        Assert.Equal(expected.Y, actual.Y, 9);
        Assert.Equal(expected.Z, actual.Z, 9);
        Assert.Equal(expected.Rx, actual.Rx, 9);
        Assert.Equal(expected.Ry, actual.Ry, 9);
        Assert.Equal(expected.Rz, actual.Rz, 9);
    }
}
