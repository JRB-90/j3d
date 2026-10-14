using System.Text.Json.Serialization;

namespace J3D.Web.Client.Models;

/// <summary>
/// Import phases in the order they occur (src/J3D.Viewer/src/import/types.ts). OCCT imports go
/// through all of them; mesh imports use only <see cref="Reading"/> and <see cref="Parsing"/>.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ImportPhase>))]
public enum ImportPhase
{
    [JsonStringEnumMemberName("reading")] Reading,
    [JsonStringEnumMemberName("parsing")] Parsing,
    [JsonStringEnumMemberName("transferring")] Transferring,
    [JsonStringEnumMemberName("meshing")] Meshing,
    [JsonStringEnumMemberName("extracting")] Extracting,
}
