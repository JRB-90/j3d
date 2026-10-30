using System.Text.Json;
using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>A model's id, assigned by the viewer when its file is queued. Crosses interop as a string.</summary>
[JsonConverter(typeof(ModelIdJsonConverter))]
public readonly record struct ModelId(string Value)
{
    public override string ToString() => Value;
}

internal sealed class ModelIdJsonConverter : JsonConverter<ModelId>
{
    public override ModelId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        new(reader.GetString() ?? throw new JsonException("A model id must be a string."));

    public override void Write(Utf8JsonWriter writer, ModelId value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.Value);
}
