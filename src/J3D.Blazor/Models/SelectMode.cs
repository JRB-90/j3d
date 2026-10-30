using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>
/// What a click selects (M12, D146): whole models, placed parts (objects, as in M6), or a BREP model's
/// faces, edges and vertices. Named as src/J3D.Viewer/src/view/viewer.ts names them.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<SelectMode>))]
public enum SelectMode
{
    /// <summary>A click selects a whole model.</summary>
    [JsonStringEnumMemberName("model")] Models,
    /// <summary>A click selects a placed part.</summary>
    [JsonStringEnumMemberName("object")] Objects,
    /// <summary>A click selects a BREP model's face, edge or vertex.</summary>
    [JsonStringEnumMemberName("feature")] Features,
}
