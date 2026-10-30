using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>What the Move tool's triad does (M13, D149): translate with W, rotate with E (D166).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<MoveMode>))]
public enum MoveMode
{
    /// <summary>Moves the target along an axis.</summary>
    [JsonStringEnumMemberName("translate")] Translate,
    /// <summary>Turns the target about an axis.</summary>
    [JsonStringEnumMemberName("rotate")] Rotate,
}

/// <summary>The frame the placement fields and the triad use (M13, D148). Named as src/J3D.Viewer/src/view/move.ts names them.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<MoveFrame>))]
public enum MoveFrame
{
    /// <summary>The target's own axes.</summary>
    [JsonStringEnumMemberName("local")] Local,
    /// <summary>Its parent's axes.</summary>
    [JsonStringEnumMemberName("parent")] Parent,
    /// <summary>The world's axes.</summary>
    [JsonStringEnumMemberName("world")] World,
}

/// <summary>
/// A 4 × 4 transform in doubles, column-major as Three.js keeps it (M13): a node's placement in its
/// parent's frame, or a frame's placement in the world. Immutable, and equal by value.
/// </summary>
public sealed class Matrix4d : IEquatable<Matrix4d>
{
    private readonly double[] _elements;

    /// <summary>A matrix from its 16 elements, column by column.</summary>
    public Matrix4d(IReadOnlyList<double> elements)
    {
        ArgumentNullException.ThrowIfNull(elements);
        if (elements.Count != 16)
        {
            throw new ArgumentException("A 4 × 4 matrix has 16 elements.", nameof(elements));
        }

        _elements = [.. elements];
    }

    /// <summary>The transform that changes nothing.</summary>
    public static Matrix4d Identity { get; } = new([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    /// <summary>The element in a row and a column, both from 0.</summary>
    public double this[int row, int column] => _elements[column * 4 + row];

    /// <summary>The elements, column by column, for the viewer.</summary>
    public double[] ToArray() => [.. _elements];

    /// <summary>The transform that does <paramref name="b"/> and then <paramref name="a"/>.</summary>
    public static Matrix4d operator *(Matrix4d a, Matrix4d b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        var product = new double[16];
        for (var column = 0; column < 4; column++)
        {
            for (var row = 0; row < 4; row++)
            {
                double sum = 0;
                for (var k = 0; k < 4; k++)
                {
                    sum += a[row, k] * b[k, column];
                }

                product[column * 4 + row] = sum;
            }
        }

        return new(product);
    }

    /// <summary>The transform that does <paramref name="b"/> and then <paramref name="a"/>.</summary>
    public static Matrix4d Multiply(Matrix4d a, Matrix4d b) => a * b;

    /// <summary>The inverse of an affine transform (a placement, perhaps scaled): the 3 × 3 part inverted, then the translation.</summary>
    public Matrix4d Inverse()
    {
        double a = this[0, 0], b = this[0, 1], c = this[0, 2];
        double d = this[1, 0], e = this[1, 1], f = this[1, 2];
        double g = this[2, 0], h = this[2, 1], i = this[2, 2];
        var determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (Math.Abs(determinant) < 1e-300)
        {
            throw new InvalidOperationException("The transform can't be inverted.");
        }

        var r = new double[3, 3]
        {
            { (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant },
            { (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant },
            { (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant },
        };
        double tx = this[0, 3], ty = this[1, 3], tz = this[2, 3];
        var inverse = new double[16];
        for (var row = 0; row < 3; row++)
        {
            for (var column = 0; column < 3; column++)
            {
                inverse[column * 4 + row] = r[row, column];
            }

            inverse[12 + row] = -(r[row, 0] * tx + r[row, 1] * ty + r[row, 2] * tz);
        }

        inverse[15] = 1;
        return new(inverse);
    }

    /// <summary>The length of each of the first three columns: the transform's scale along its axes.</summary>
    public (double X, double Y, double Z) Scale() =>
        (Math.Sqrt(this[0, 0] * this[0, 0] + this[1, 0] * this[1, 0] + this[2, 0] * this[2, 0]),
         Math.Sqrt(this[0, 1] * this[0, 1] + this[1, 1] * this[1, 1] + this[2, 1] * this[2, 1]),
         Math.Sqrt(this[0, 2] * this[0, 2] + this[1, 2] * this[1, 2] + this[2, 2] * this[2, 2]));

    /// <inheritdoc />
    public bool Equals(Matrix4d? other) => other is not null && _elements.AsSpan().SequenceEqual(other._elements);

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as Matrix4d);

    /// <inheritdoc />
    public override int GetHashCode()
    {
        var hash = new HashCode();
        foreach (var element in _elements)
        {
            hash.Add(element);
        }

        return hash.ToHashCode();
    }
}

/// <summary>
/// A placement as the fields show it (M13, D148): X, Y and Z in millimetres, and Rx, Ry and Rz in
/// degrees as fixed angles, about the frame's X, then Y, then Z (R = Rz · Ry · Rx).
/// </summary>
public sealed record Pose(double X, double Y, double Z, double Rx, double Ry, double Rz)
{
    /// <summary>Nowhere moved and nothing turned.</summary>
    public static Pose Zero { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>
    /// The pose of a transform's origin and axes: its translation in millimetres (<paramref name="unitScale"/>
    /// per model unit, D105) and its rotation, with any scale taken out. Near Ry = ±90° the rotation is
    /// put in Rz, with Rx zero.
    /// </summary>
    public static Pose Of(Matrix4d transform, double unitScale)
    {
        ArgumentNullException.ThrowIfNull(transform);
        var (sx, sy, sz) = transform.Scale();
        double r00 = transform[0, 0] / sx, r10 = transform[1, 0] / sx, r20 = transform[2, 0] / sx;
        double r01 = transform[0, 1] / sy, r11 = transform[1, 1] / sy, r21 = transform[2, 1] / sy;
        double r22 = transform[2, 2] / sz;
        var ry = Math.Asin(Math.Clamp(-r20, -1, 1));
        double rx, rz;
        if (Math.Abs(r20) < 1 - 1e-9)
        {
            rx = Math.Atan2(r21, r22);
            rz = Math.Atan2(r10, r00);
        }
        else
        {
            rx = 0;
            rz = Math.Atan2(-r01, r11);
        }

        return new(
            transform[0, 3] * unitScale,
            transform[1, 3] * unitScale,
            transform[2, 3] * unitScale,
            Clean(Degrees(rx)),
            Clean(Degrees(ry)),
            Clean(Degrees(rz)));
    }

    /// <summary>The transform of this pose in model units, keeping a scale (CAD placements have none, but a mesh node might).</summary>
    public Matrix4d ToMatrix(double unitScale, (double X, double Y, double Z) scale)
    {
        double cx = Math.Cos(Radians(Rx)), sx = Math.Sin(Radians(Rx));
        double cy = Math.Cos(Radians(Ry)), sy = Math.Sin(Radians(Ry));
        double cz = Math.Cos(Radians(Rz)), sz = Math.Sin(Radians(Rz));
        // R = Rz · Ry · Rx, by columns.
        double[] rotation =
        [
            cz * cy, sz * cy, -sy,
            cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx,
            cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx,
        ];
        double[] scales = [scale.X, scale.Y, scale.Z];
        var elements = new double[16];
        for (var column = 0; column < 3; column++)
        {
            for (var row = 0; row < 3; row++)
            {
                elements[column * 4 + row] = rotation[column * 3 + row] * scales[column];
            }
        }

        elements[12] = X / unitScale;
        elements[13] = Y / unitScale;
        elements[14] = Z / unitScale;
        elements[15] = 1;
        return new(elements);
    }

    private static double Degrees(double radians) => radians * 180 / Math.PI;

    private static double Radians(double degrees) => degrees * Math.PI / 180;

    /// <summary>−0 and tiny rounding errors read as 0, so a field doesn't show −0.000.</summary>
    private static double Clean(double degrees) => Math.Abs(degrees) < 1e-9 ? 0 : degrees;
}
