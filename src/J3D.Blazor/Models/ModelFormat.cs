using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>
/// File formats J3D can import. File-extension detection is owned by the TypeScript viewer
/// (src/J3D.Viewer/src/formats.ts), which reports the format to .NET using these lowercase names.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ModelFormat>))]
public enum ModelFormat
{
    /// <summary>STEP.</summary>
    [JsonStringEnumMemberName("step")] Step,
    /// <summary>IGES.</summary>
    [JsonStringEnumMemberName("iges")] Iges,
    /// <summary>OCCT's BREP.</summary>
    [JsonStringEnumMemberName("brep")] Brep,
    /// <summary>STL.</summary>
    [JsonStringEnumMemberName("stl")] Stl,
    /// <summary>Wavefront OBJ.</summary>
    [JsonStringEnumMemberName("obj")] Obj,
    /// <summary>glTF, as text or binary.</summary>
    [JsonStringEnumMemberName("gltf")] Gltf,
}

/// <summary>Whether a model carries exact BREP geometry (via OCCT) or only triangles.</summary>
public enum ModelKind
{
    /// <summary>Exact surfaces, read by the kernel: STEP, IGES and BREP.</summary>
    Brep,
    /// <summary>Triangles: STL, OBJ and glTF.</summary>
    Mesh,
}

/// <summary>Facts about a <see cref="ModelFormat"/>.</summary>
public static class ModelFormatExtensions
{
    extension(ModelFormat format)
    {
        /// <summary>Whether the format is BREP or mesh.</summary>
        public ModelKind Kind => format switch
        {
            ModelFormat.Step or ModelFormat.Iges or ModelFormat.Brep => ModelKind.Brep,
            ModelFormat.Stl or ModelFormat.Obj or ModelFormat.Gltf => ModelKind.Mesh,
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };

        /// <summary>The format's name as a page shows it.</summary>
        public string DisplayName => format switch
        {
            ModelFormat.Step => "STEP",
            ModelFormat.Iges => "IGES",
            ModelFormat.Brep => "BREP",
            ModelFormat.Stl => "STL",
            ModelFormat.Obj => "OBJ",
            ModelFormat.Gltf => "glTF",
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };
    }
}
