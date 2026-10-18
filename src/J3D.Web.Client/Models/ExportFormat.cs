using System.Text.Json.Serialization;

namespace J3D.Web.Client.Models;

/// <summary>
/// What the toolbar's Export menu saves the visible scene or the selection as (M9, D119, D127), named
/// as src/J3D.Viewer/src/view/mesh-export.ts names them.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<MeshExportFormat>))]
public enum MeshExportFormat
{
    [JsonStringEnumMemberName("glb")] Glb,
    [JsonStringEnumMemberName("stl")] StlBinary,
    [JsonStringEnumMemberName("stl-ascii")] StlAscii,
}

/// <summary>What a BREP model's item saves the whole model as (M9, D83, D119).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<BrepExportFormat>))]
public enum BrepExportFormat
{
    [JsonStringEnumMemberName("step")] Step,
    [JsonStringEnumMemberName("brep")] Brep,
}

public static class MeshExportFormatExtensions
{
    extension(MeshExportFormat format)
    {
        public string DisplayName => format switch
        {
            MeshExportFormat.Glb => "GLB",
            MeshExportFormat.StlBinary => "STL (binary)",
            MeshExportFormat.StlAscii => "STL (ASCII)",
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };
    }
}

public static class BrepExportFormatExtensions
{
    extension(BrepExportFormat format)
    {
        public string DisplayName => format switch
        {
            BrepExportFormat.Step => "STEP",
            BrepExportFormat.Brep => "BREP",
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };
    }
}
