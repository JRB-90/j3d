using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>The viewer's camera projection. Orthographic is the default (decision D19).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<Projection>))]
public enum Projection
{
    /// <summary>No perspective: parallel edges stay parallel.</summary>
    [JsonStringEnumMemberName("orthographic")] Orthographic,
    /// <summary>Further things look smaller.</summary>
    [JsonStringEnumMemberName("perspective")] Perspective,
}
