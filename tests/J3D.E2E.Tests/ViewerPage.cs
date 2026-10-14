using System.Text.Json;
using Microsoft.Playwright;
using Microsoft.Playwright.Xunit.v3;

namespace J3D.E2E.Tests;

/// <summary>
/// A page of the running app, driven through the viewer's Development-only test hook
/// (<c>window.__j3dTest</c>, src/J3D.Viewer/src/test-hook.ts). Records console errors so every test
/// can assert there were none.
/// </summary>
public abstract class ViewerPageTest(J3DAppFixture app) : PageTest, IClassFixture<J3DAppFixture>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly List<string> _consoleErrors = [];

    public override async ValueTask InitializeAsync()
    {
        await base.InitializeAsync();
        Page.Console += (_, message) =>
        {
            if (message.Type == "error")
            {
                _consoleErrors.Add(message.Text);
            }
        };
        Page.PageError += (_, error) => _consoleErrors.Add(error);

        await Page.GotoAsync(app.BaseAddress.ToString());
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
    }

    protected Task ImportAsync(params string[] fixtures) =>
        Page.SetInputFilesAsync("[data-testid=j3d-test-input]", fixtures.Select(Fixtures.PathOf));

    protected Task ImportAsync(params FilePayload[] files) =>
        Page.SetInputFilesAsync("[data-testid=j3d-test-input]", files);

    /// <summary>Waits until <paramref name="count"/> models exist and none is queued or importing.</summary>
    protected async Task<IReadOnlyList<TestModel>> WaitForImportsAsync(int count)
    {
        await Page.WaitForFunctionAsync(
            "count => { const models = window.__j3dTest.models(); return models.length >= count && models.every(m => m.status === 'loaded' || m.status === 'failed'); }",
            count,
            new PageWaitForFunctionOptions { Timeout = 60_000 });
        return await ModelsAsync();
    }

    protected Task WaitForAsync(string predicate) => Page.WaitForFunctionAsync(predicate);

    protected async Task<IReadOnlyList<TestModel>> ModelsAsync() =>
        await EvaluateAsync<TestModel[]>("() => window.__j3dTest.models()");

    protected async Task<IReadOnlyList<TestEvent>> EventsAsync() =>
        await EvaluateAsync<TestEvent[]>("() => window.__j3dTest.events");

    protected Task<int> LiveWorkersAsync() => Page.EvaluateAsync<int>("() => window.__j3dTest.liveWorkers()");

    protected Task<bool> RemoveAsync(string id) => Page.EvaluateAsync<bool>("id => window.__j3dTest.remove(id)", id);

    protected Task HoldImportsAsync(bool hold) => Page.EvaluateAsync("hold => { window.__j3dTest.holdImports = hold; }", hold);

    protected void AssertNoConsoleErrors() => Assert.Empty(_consoleErrors);

    private async Task<T> EvaluateAsync<T>(string expression)
    {
        var json = await Page.EvaluateAsync<JsonElement>(expression);
        return json.Deserialize<T>(Json)!;
    }
}

internal static class Fixtures
{
    private static readonly string Root = FindRoot();

    /// <summary>A file in tests/fixtures, by its path relative to that folder.</summary>
    public static string PathOf(string fixture) => Path.Combine(Root, "tests", "fixtures", fixture);

    private static string FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "J3D.slnx")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Couldn't find the repository root (J3D.slnx) above the test output.");
    }
}

// Mirrors TestModel and TestEvent in src/J3D.Viewer/src/test-hook.ts.
public sealed record TestModel(
    string Id,
    string FileName,
    string Format,
    string Kind,
    string Status,
    string? Phase,
    ImportError? Error,
    ModelStats? Stats,
    Bounds? Bounds,
    TreeNode[]? Tree,
    string[]? Warnings,
    long? MemoryBytes,
    string[]? TextureMaps);

public sealed record ImportError(string Code, string Message);

public sealed record ModelStats(int Nodes, int Prototypes, int Instances, int Triangles, int Edges, int Textures);

public sealed record Bounds(double[] Min, double[] Max);

public sealed record TreeNode(string Name, int Parent, int Prototype);

public sealed record TestEvent(string Type, string? Id, string? FileName, string? Phase, double? Fraction, string? Reason, ImportError? Error);
