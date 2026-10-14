using System.Text.Json;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.Tests.Interop;

/// <summary>
/// The viewer's model events, as src/J3D.Viewer/src/model-events.ts sends them, deserialised with
/// the web defaults Blazor's JS interop uses.
/// </summary>
public sealed class ModelEventJsonTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Reads_a_queued_model_summary()
    {
        // The viewer also sends the kind, which .NET works out from the format.
        const string json = """{ "id": "4f0c", "fileName": "gearbox.step", "format": "step", "kind": "brep", "sizeBytes": 38000000 }""";

        var summary = JsonSerializer.Deserialize<ModelSummary>(json, Web);

        Assert.Equal(new ModelSummary(new ModelId("4f0c"), "gearbox.step", ModelFormat.Step, 38_000_000), summary);
        Assert.Equal(ModelKind.Brep, summary!.Kind);
    }

    [Fact]
    public void Reads_a_loaded_model()
    {
        const string json = """
            {
              "tree": [ { "name": "Bracket", "parent": -1, "prototype": -1 }, { "name": "Pin", "parent": 0, "prototype": 0 } ],
              "stats": { "nodes": 2, "prototypes": 1, "instances": 1, "triangles": 3000000000, "edges": 12, "textures": 0 },
              "bounds": { "min": [0, -1.5, 0], "max": [40, 30, 20] },
              "memoryBytes": 5000000000,
              "warnings": [ "Texture \"checker.png\" wasn't supplied." ]
            }
            """;

        var info = JsonSerializer.Deserialize<ModelLoadedInfo>(json, Web)!;

        Assert.Equal([new TreeNode("Bracket", -1, -1), new TreeNode("Pin", 0, 0)], info.Tree);
        Assert.Equal(new ModelStats(2, 1, 1, 3_000_000_000, 12, 0), info.Stats);
        Assert.Equal([0, -1.5, 0], info.Bounds.Min);
        Assert.Equal([40, 30, 20], info.Bounds.Max);
        Assert.Equal(5_000_000_000, info.MemoryBytes);
        Assert.Equal(["Texture \"checker.png\" wasn't supplied."], info.Warnings);
        Assert.True(info.Tree[1].IsPart);
    }

    [Theory]
    [InlineData("Unsupported", ImportErrorCode.Unsupported)]
    [InlineData("MissingFile", ImportErrorCode.MissingFile)]
    [InlineData("ParseFailed", ImportErrorCode.ParseFailed)]
    [InlineData("Empty", ImportErrorCode.Empty)]
    [InlineData("OutOfMemory", ImportErrorCode.OutOfMemory)]
    [InlineData("Internal", ImportErrorCode.Internal)]
    public void Reads_every_error_code(string code, ImportErrorCode expected)
    {
        var error = JsonSerializer.Deserialize<ImportError>($$"""{ "code": "{{code}}", "message": "Why." }""", Web);

        Assert.Equal(new ImportError(expected, "Why."), error);
        Assert.False(string.IsNullOrWhiteSpace(expected.DisplayName));
    }

    [Theory]
    [InlineData("reading", ImportPhase.Reading)]
    [InlineData("parsing", ImportPhase.Parsing)]
    [InlineData("transferring", ImportPhase.Transferring)]
    [InlineData("meshing", ImportPhase.Meshing)]
    [InlineData("extracting", ImportPhase.Extracting)]
    public void Reads_every_phase(string phase, ImportPhase expected) =>
        Assert.Equal(expected, JsonSerializer.Deserialize<ImportPhase>($"\"{phase}\"", Web));

    [Fact]
    public void A_model_id_crosses_as_a_plain_string()
    {
        Assert.Equal("\"4f0c\"", JsonSerializer.Serialize(new ModelId("4f0c"), Web));
        Assert.Equal(new ModelId("4f0c"), JsonSerializer.Deserialize<ModelId>("\"4f0c\"", Web));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ModelId>("null", Web));
    }
}
