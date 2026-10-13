using System.Text.Json;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.Tests.Models;

public sealed class ModelFormatTests
{
    [Theory]
    [InlineData(ModelFormat.Step, ModelKind.Brep)]
    [InlineData(ModelFormat.Iges, ModelKind.Brep)]
    [InlineData(ModelFormat.Brep, ModelKind.Brep)]
    [InlineData(ModelFormat.Stl, ModelKind.Mesh)]
    [InlineData(ModelFormat.Obj, ModelKind.Mesh)]
    [InlineData(ModelFormat.Gltf, ModelKind.Mesh)]
    public void Kind_separates_occt_formats_from_mesh_formats(ModelFormat format, ModelKind expected) =>
        Assert.Equal(expected, format.Kind);

    [Fact]
    public void Every_format_has_a_display_name() =>
        Assert.All(Enum.GetValues<ModelFormat>(), static format => Assert.False(string.IsNullOrWhiteSpace(format.DisplayName)));

    [Theory]
    [InlineData("\"step\"", ModelFormat.Step)]
    [InlineData("\"iges\"", ModelFormat.Iges)]
    [InlineData("\"brep\"", ModelFormat.Brep)]
    [InlineData("\"stl\"", ModelFormat.Stl)]
    [InlineData("\"obj\"", ModelFormat.Obj)]
    [InlineData("\"gltf\"", ModelFormat.Gltf)]
    public void Json_names_match_the_typescript_viewer(string json, ModelFormat expected)
    {
        Assert.Equal(expected, JsonSerializer.Deserialize<ModelFormat>(json));
        Assert.Equal(json, JsonSerializer.Serialize(expected));
    }
}
