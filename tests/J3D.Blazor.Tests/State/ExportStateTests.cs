using static J3D.Blazor.Tests.TestModels;

namespace J3D.Blazor.Tests;

/// <summary>Export state (M9): what the Export menu can save, and a model's STEP or BREP export in progress (D125).</summary>
public sealed class ExportStateTests
{
    private readonly SceneState _scene = new();
    private readonly ModelId _id = new("m1");

    [Fact]
    public void Export_needs_a_selection_or_a_visible_part()
    {
        Assert.False(_scene.CanExport);
        _scene.Add(Summary("m1"));
        Assert.False(_scene.CanExport); // nothing loaded yet

        _scene.MarkLoaded(_id, Info());
        Assert.True(_scene.CanExport);

        _scene.ToggleModelVisibility(_id);
        Assert.False(_scene.CanExport);
        _scene.ShowAll();
        _scene.SelectNode(_id, 1, additive: false);
        _scene.IsolateSelection();
        Assert.True(_scene.CanExport);
    }

    [Fact]
    public void A_loaded_model_shows_its_export_until_it_ends()
    {
        _scene.Add(Summary("m1"));
        _scene.SetExport(_id, BrepExportFormat.Step);
        Assert.Null(_scene.Models[0].Export); // only a loaded model exports

        _scene.MarkLoaded(_id, Info());
        _scene.SetExport(_id, BrepExportFormat.Step);
        Assert.Equal(new ModelExport(BrepExportFormat.Step, null), _scene.Models[0].Export);

        _scene.ReportExportProgress(_id, 0.25);
        Assert.Equal(new ModelExport(BrepExportFormat.Step, 0.25), _scene.Models[0].Export);
        _scene.ReportExportProgress(_id, null); // OCCT writing the file
        Assert.Equal(new ModelExport(BrepExportFormat.Step, null), _scene.Models[0].Export);

        _scene.SetExport(_id, null);
        Assert.Null(_scene.Models[0].Export);
        _scene.ReportExportProgress(_id, 0.5); // a late report
        Assert.Null(_scene.Models[0].Export);
    }

    [Fact]
    public void A_deleted_model_comes_back_without_its_export()
    {
        _scene.Add(Summary("m1"));
        _scene.MarkLoaded(_id, Info());
        _scene.SetExport(_id, BrepExportFormat.Brep);

        _scene.Delete(_id);
        _scene.Undo();

        var restored = Assert.Single(_scene.Models);
        Assert.Null(restored.Export);
        Assert.True(restored.IsRestored);
    }

    [Fact]
    public void Formats_have_display_names()
    {
        Assert.Equal(["GLB", "STL (binary)", "STL (ASCII)"], Enum.GetValues<MeshExportFormat>().Select(static format => format.DisplayName));
        Assert.Equal(["STEP", "BREP"], Enum.GetValues<BrepExportFormat>().Select(static format => format.DisplayName));
    }
}
