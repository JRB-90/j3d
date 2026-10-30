using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>
/// File formats J3D can import. File-extension detection is owned by the TypeScript viewer
/// (src/J3D.Viewer/src/formats.ts), which reports the format to .NET using these lowercase names.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ModelFormat>))]
public enum ModelFormat
{
    [JsonStringEnumMemberName("step")] Step,
    [JsonStringEnumMemberName("iges")] Iges,
    [JsonStringEnumMemberName("brep")] Brep,
    [JsonStringEnumMemberName("stl")] Stl,
    [JsonStringEnumMemberName("obj")] Obj,
    [JsonStringEnumMemberName("gltf")] Gltf,
}

/// <summary>Whether a model carries exact BREP geometry (via OCCT) or only triangles.</summary>
public enum ModelKind
{
    Brep,
    Mesh,
}

public static class ModelFormatExtensions
{
    extension(ModelFormat format)
    {
        public ModelKind Kind => format switch
        {
            ModelFormat.Step or ModelFormat.Iges or ModelFormat.Brep => ModelKind.Brep,
            ModelFormat.Stl or ModelFormat.Obj or ModelFormat.Gltf => ModelKind.Mesh,
            _ => throw new ArgumentOutOfRangeException(nameof(format), format, null),
        };

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
