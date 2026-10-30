using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>
/// What the toolbar's Export menu saves the visible scene or the selection as (M9, D119, D127), named
/// as src/J3D.Viewer/src/view/mesh-export.ts names them.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<MeshExportFormat>))]
public enum MeshExportFormat
{
    /// <summary>Binary glTF.</summary>
    [JsonStringEnumMemberName("glb")] Glb,
    /// <summary>Binary STL.</summary>
    [JsonStringEnumMemberName("stl")] StlBinary,
    /// <summary>ASCII STL.</summary>
    [JsonStringEnumMemberName("stl-ascii")] StlAscii,
}

/// <summary>What a BREP model's item saves the whole model as (M9, D83, D119).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<BrepExportFormat>))]
public enum BrepExportFormat
{
    /// <summary>A STEP file.</summary>
    [JsonStringEnumMemberName("step")] Step,
    /// <summary>An OCCT BREP file.</summary>
    [JsonStringEnumMemberName("brep")] Brep,
}

/// <summary>Text for a <see cref="MeshExportFormat"/>.</summary>
public static class MeshExportFormatExtensions
{
    extension(MeshExportFormat format)
    {
        /// <summary>The format as a menu shows it.</summary>
        public string DisplayName => format switch
        {
            MeshExportFormat.Glb => "GLB",
            MeshExportFormat.StlBinary => "STL (binary)",
            MeshExportFormat.StlAscii => "STL (ASCII)",
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };
    }
}

/// <summary>Text for a <see cref="BrepExportFormat"/>.</summary>
public static class BrepExportFormatExtensions
{
    extension(BrepExportFormat format)
    {
        /// <summary>The format as a menu shows it.</summary>
        public string DisplayName => format switch
        {
            BrepExportFormat.Step => "STEP",
            BrepExportFormat.Brep => "BREP",
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };
    }
}
