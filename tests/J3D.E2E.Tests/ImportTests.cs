using System.Text;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>The M2 import pipeline in a real browser: every fixture, progress, cancel and errors (docs/plan.md §10).</summary>
public sealed class ImportTests(J3DAppFixture app) : ViewerPageTest(app)
{
    /// <summary>Every mesh fixture is the same base-and-post model, Z-up (generate-mesh-fixtures.mjs).</summary>
    private static readonly Bounds MeshFixtureBounds = new([-20, -15, 0], [20, 15, 60]);

    [Fact]
    public async Task Brep_fixtures_import_with_their_structure_and_geometry()
    {
        await ImportAsync("box.brep", "assembly.step", "coloured-part.step", "translucent.step", "surfaces.iges");

        var models = (await WaitForImportsAsync(5)).ToDictionary(m => m.FileName);
        Assert.All(models.Values, m => Assert.Equal("loaded", m.Status));
        Assert.All(models.Values, m => Assert.Equal("brep", m.Kind));

        var box = models["box.brep"];
        Assert.Equal(new ModelStats(Nodes: 1, Prototypes: 1, Instances: 1, Triangles: 12, Edges: 12, Textures: 0), box.Stats);
        AssertBounds(new Bounds([0, 0, 0], [10, 20, 30]), box.Bounds!);
        Assert.True(box.MemoryBytes >= 64L << 20, "A model worker's WASM heap starts at 64 MB.");

        var assembly = models["assembly.step"];
        Assert.Equal((2, 3), (assembly.Stats!.Prototypes, assembly.Stats.Instances)); // both plates share one mesh
        Assert.Contains(assembly.Tree!, n => n is { Name: "Bracket assembly", Parent: -1, Prototype: -1 });
        Assert.Contains(assembly.Tree!, n => n.Name == "Pin");

        Assert.All(models.Values, m => Assert.True(m.Stats!.Triangles > 0, m.FileName));
        Assert.Equal(5, await LiveWorkersAsync()); // each BREP model keeps its worker
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Invalid_step_fails_with_ParseFailed_through_a_cxx_exception()
    {
        // OCCT reports the syntax error by throwing a C++ exception, so this also checks the build's
        // WebAssembly exception handling (-fwasm-exceptions) in each browser.
        await ImportAsync("invalid.step");

        var model = Assert.Single(await WaitForImportsAsync(1));
        Assert.Equal("failed", model.Status);
        Assert.Equal("ParseFailed", model.Error!.Code);
        Assert.Equal(0, await LiveWorkersAsync()); // a failed import keeps nothing alive
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Brep_import_reports_every_phase_in_order()
    {
        await ImportAsync("assembly.step");
        var model = Assert.Single(await WaitForImportsAsync(1));

        var phases = (await EventsAsync())
            .Where(e => e.Type == "progress" && e.Id == model.Id)
            .Select(e => e.Phase!)
            .Aggregate(new List<string>(), (list, phase) =>
            {
                if (list.Count == 0 || list[^1] != phase)
                {
                    list.Add(phase);
                }

                return list;
            });
        Assert.Equal(["reading", "parsing", "transferring", "meshing", "extracting"], phases);
    }

    [Fact]
    public async Task Mesh_fixtures_import_z_up()
    {
        await ImportAsync("part.stl", "part.obj", "part.glb", "draco.glb", "meshopt.glb", "ktx2.glb");

        var models = (await WaitForImportsAsync(6)).ToDictionary(m => m.FileName);
        foreach (var model in models.Values)
        {
            Assert.True(model.Status == "loaded", $"{model.FileName}: {model.Error}");
            Assert.Equal("mesh", model.Kind);
            Assert.Equal(24, model.Stats!.Triangles);
            AssertBounds(MeshFixtureBounds, model.Bounds!); // glTF is stored Y-up
            Assert.Empty(model.Warnings!);
        }

        Assert.Equal(["Scene", "Assembly", "Base", "Post"], models["part.glb"].Tree!.Select(n => n.Name));
        Assert.Equal(["map"], models["ktx2.glb"].TextureMaps!);
        Assert.Equal(0, await LiveWorkersAsync()); // mesh workers are transient
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Multi_file_gltf_finds_its_buffer_and_texture_in_the_same_selection()
    {
        await ImportAsync("multi/scene.gltf", "multi/scene.bin", "multi/checker.png");

        var model = Assert.Single(await WaitForImportsAsync(1));
        Assert.Equal("loaded", model.Status);
        Assert.Equal(["map"], model.TextureMaps!);
        Assert.Empty(model.Warnings!);
        Assert.DoesNotContain(await EventsAsync(), e => e.Type == "rejected");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Multi_file_gltf_without_its_buffer_fails_with_MissingFile()
    {
        await ImportAsync("multi/scene.gltf", "multi/checker.png");

        var model = Assert.Single(await WaitForImportsAsync(1));
        Assert.Equal("MissingFile", model.Error!.Code);
        Assert.Contains("scene.bin", model.Error.Message, StringComparison.Ordinal);
        await WaitForAsync("() => window.__j3dTest.events.some(e => e.type === 'rejected' && e.fileName === 'checker.png')");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Missing_texture_loads_the_model_with_a_warning()
    {
        await ImportAsync("multi/scene.gltf", "multi/scene.bin");

        var model = Assert.Single(await WaitForImportsAsync(1));
        Assert.Equal("loaded", model.Status);
        Assert.Contains(model.Warnings!, w => w.Contains("checker.png", StringComparison.Ordinal));
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Obj_gets_its_mtl_materials_and_textures()
    {
        await ImportAsync("textured/part.obj", "textured/part.mtl", "textured/checker.png");

        var model = Assert.Single(await WaitForImportsAsync(1));
        Assert.Equal("loaded", model.Status);
        Assert.Equal(["map"], model.TextureMaps!);
        Assert.Empty(model.Warnings!);
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Unsupported_files_are_rejected()
    {
        await ImportAsync(new FilePayload { Name = "notes.txt", MimeType = "text/plain", Buffer = Encoding.UTF8.GetBytes("hello") });

        await WaitForAsync("() => window.__j3dTest.events.some(e => e.type === 'rejected')");
        var rejected = Assert.Single(await EventsAsync(), e => e.Type == "rejected");
        Assert.Equal("notes.txt", rejected.FileName);
        Assert.Empty(await ModelsAsync());
    }

    [Fact]
    public async Task Two_imports_run_at_once_and_cancelling_frees_their_workers()
    {
        // Held imports stop after instantiating OCCT, with their WASM heaps allocated, until cancelled.
        await HoldImportsAsync(true);
        var box = await File.ReadAllBytesAsync(Fixtures.PathOf("box.brep"), TestContext.Current.CancellationToken);
        await ImportAsync([.. Enumerable.Range(1, 3).Select(i => new FilePayload { Name = $"box{i}.brep", MimeType = "application/octet-stream", Buffer = box })]);

        await WaitForAsync("() => window.__j3dTest.events.filter(e => e.type === 'held').length === 2");
        Assert.Equal(["importing", "importing", "queued"], (await ModelsAsync()).Select(m => m.Status));
        Assert.Equal(2, await LiveWorkersAsync());

        // Cancelling a running import terminates its worker and starts the queued one.
        var models = await ModelsAsync();
        Assert.True(await RemoveAsync(models[0].Id));
        await WaitForAsync("() => window.__j3dTest.events.filter(e => e.type === 'held').length === 3");
        Assert.Equal(["importing", "importing"], (await ModelsAsync()).Select(m => m.Status));
        Assert.Equal(2, await LiveWorkersAsync());

        foreach (var model in await ModelsAsync())
        {
            await RemoveAsync(model.Id);
        }

        Assert.Empty(await ModelsAsync());
        Assert.Equal(0, await LiveWorkersAsync());
        Assert.Equal(3, (await EventsAsync()).Count(e => e.Type == "removed"));
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task Deleting_a_loaded_model_terminates_its_worker()
    {
        await ImportAsync("box.brep", "part.glb");
        var models = await WaitForImportsAsync(2);
        Assert.Equal(1, await LiveWorkersAsync());

        foreach (var model in models)
        {
            Assert.True(await RemoveAsync(model.Id));
        }

        Assert.Equal(0, await LiveWorkersAsync());
        Assert.Empty(await ModelsAsync());
        AssertNoConsoleErrors();
    }

    private static void AssertBounds(Bounds expected, Bounds actual)
    {
        for (var axis = 0; axis < 3; axis++)
        {
            // Within 0.005: meshopt quantises positions.
            Assert.Equal(expected.Min[axis], actual.Min[axis], 0.005);
            Assert.Equal(expected.Max[axis], actual.Max[axis], 0.005);
        }
    }
}
