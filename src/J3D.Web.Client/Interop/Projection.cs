using System.Text.Json.Serialization;

namespace J3D.Web.Client.Interop;

/// <summary>The viewer's camera projection. Orthographic is the default (decision D19).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<Projection>))]
public enum Projection
{
    [JsonStringEnumMemberName("orthographic")] Orthographic,
    [JsonStringEnumMemberName("perspective")] Perspective,
}
