using J3D.Web.Client.Models;

namespace J3D.Web.Client.Tests.Models;

/// <summary>The placement maths behind the Move tool's fields (M13, D148): fixed angles, R = Rz · Ry · Rx.</summary>
public sealed class PlacementTests
{
    [Theory]
    [InlineData(10, -20, 30, 15, 25, 35)]
    [InlineData(0, 0, 0, -170, 80, 120)]
    [InlineData(1.5, 2.5, -3.5, 0, 0, -90)]
    public void A_pose_survives_its_matrix(double x, double y, double z, double rx, double ry, double rz)
    {
        var pose = new Pose(x, y, z, rx, ry, rz);

        var back = Pose.Of(pose.ToMatrix(1, (1, 1, 1)), 1);

        Assert.Equal(pose.X, back.X, 9);
        Assert.Equal(pose.Y, back.Y, 9);
        Assert.Equal(pose.Z, back.Z, 9);
        Assert.Equal(pose.Rx, back.Rx, 9);
        Assert.Equal(pose.Ry, back.Ry, 9);
        Assert.Equal(pose.Rz, back.Rz, 9);
    }

    [Fact]
    public void Fixed_angles_turn_about_x_then_y_then_z()
    {
        // 90° about x takes y to z; then 90° about z takes x to y.
        var matrix = new Pose(0, 0, 0, 90, 0, 90).ToMatrix(1, (1, 1, 1));

        Assert.Equal(1, matrix[1, 0], 9); // the x axis now points along y
        Assert.Equal(1, matrix[2, 1], 9); // the y axis along z
    }

    [Fact]
    public void Straight_up_or_down_puts_the_turn_in_rz()
    {
        var pose = Pose.Of(new Pose(0, 0, 0, 30, 90, 10).ToMatrix(1, (1, 1, 1)), 1);

        Assert.Equal(90, pose.Ry, 6);
        Assert.Equal(0, pose.Rx);
        Assert.Equal(-20, pose.Rz, 6); // Rx and Rz turn about the same axis there
    }

    [Fact]
    public void Millimetres_convert_by_the_models_scale_and_scale_is_kept()
    {
        // glTF is in metres (D105): 5 mm is 0.005 of the model's units.
        var matrix = new Pose(5, 0, 0, 0, 0, 0).ToMatrix(1000, (2, 2, 2));

        Assert.Equal(0.005, matrix[0, 3], 12);
        Assert.Equal((2, 2, 2), matrix.Scale());
        Assert.Equal(5, Pose.Of(matrix, 1000).X, 9);
    }

    [Fact]
    public void The_inverse_undoes_a_placement()
    {
        var placement = new Pose(10, 20, 30, 15, 25, 35).ToMatrix(1, (1, 2, 3));

        var product = placement * placement.Inverse();

        for (var row = 0; row < 4; row++)
        {
            for (var column = 0; column < 4; column++)
            {
                Assert.Equal(row == column ? 1 : 0, product[row, column], 9);
            }
        }
    }

    [Fact]
    public void Matrices_are_equal_by_value()
    {
        Assert.Equal(Matrix4d.Identity, new Matrix4d([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
        Assert.NotEqual(Matrix4d.Identity, new Pose(0, 0, 1, 0, 0, 0).ToMatrix(1, (1, 1, 1)));
        Assert.Throws<ArgumentException>(() => new Matrix4d([1, 2, 3]));
    }
}
