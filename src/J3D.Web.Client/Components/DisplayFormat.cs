using System.Globalization;

namespace J3D.Web.Client.Components;

/// <summary>Short, invariant text for the sizes and counts in the model list.</summary>
internal static class DisplayFormat
{
    private static readonly string[] ByteUnits = ["KB", "MB", "GB", "TB"];
    private static readonly string[] CountUnits = ["k", "M", "B"];

    /// <summary>Binary units: 812 B, 4.2 KB, 412 MB.</summary>
    public static string Bytes(long bytes) => bytes < 1024 ? $"{bytes} B" : Scaled(bytes, 1024, ByteUnits, " ");

    /// <summary>Decimal units: 812, 1.2k, 45.3k, 1.2M.</summary>
    public static string Count(long count) => count < 1000 ? count.ToString(CultureInfo.InvariantCulture) : Scaled(count, 1000, CountUnits, "");

    /// <summary>A count and its noun: "1 part", "86 parts", "1.2M triangles".</summary>
    public static string Counted(long count, string noun) => $"{Count(count)} {(count == 1 ? noun : noun + "s")}";

    /// <summary>One decimal below 100 of a unit (dropping ".0"), whole numbers above.</summary>
    private static string Scaled(long value, double step, string[] units, string separator)
    {
        var scaled = value / step;
        var unit = 0;
        while (scaled >= step && unit < units.Length - 1)
        {
            scaled /= step;
            unit++;
        }

        // Rounding can carry into the next unit (999.96 k → "1000k"), so step up once more if it does.
        var rounded = Math.Round(scaled, scaled < 100 ? 1 : 0, MidpointRounding.AwayFromZero);
        if (rounded >= step && unit < units.Length - 1)
        {
            rounded = Math.Round(rounded / step, 1, MidpointRounding.AwayFromZero);
            unit++;
        }

        return $"{rounded.ToString("0.#", CultureInfo.InvariantCulture)}{separator}{units[unit]}";
    }
}
