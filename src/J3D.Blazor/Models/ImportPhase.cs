using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>
/// Import phases in the order they occur (src/J3D.Viewer/src/import/types.ts). OCCT imports go
/// through all of them; mesh imports use only <see cref="Reading"/> and <see cref="Parsing"/>. A
/// restored model with kept edits ends with <see cref="Applying"/> (M16, D203).
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ImportPhase>))]
public enum ImportPhase
{
    /// <summary>Reading the file's bytes.</summary>
    [JsonStringEnumMemberName("reading")] Reading,
    /// <summary>Parsing the file.</summary>
    [JsonStringEnumMemberName("parsing")] Parsing,
    /// <summary>Building the kernel's model from what was parsed.</summary>
    [JsonStringEnumMemberName("transferring")] Transferring,
    /// <summary>Turning surfaces into triangles.</summary>
    [JsonStringEnumMemberName("meshing")] Meshing,
    /// <summary>Copying the tree and the meshes out of the kernel.</summary>
    [JsonStringEnumMemberName("extracting")] Extracting,
    /// <summary>Applying a restored model's kept edits.</summary>
    [JsonStringEnumMemberName("applying")] Applying,
}
