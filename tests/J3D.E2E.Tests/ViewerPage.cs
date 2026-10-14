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
    protected static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

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

    /// <summary>The viewer's camera (src/J3D.Viewer/src/view/viewer.ts, CameraState).</summary>
    protected async Task<CameraState> CameraAsync() => await EvaluateAsync<CameraState>("() => window.__j3dTest.camera()");

    /// <summary>
    /// Waits until no transition or drag is moving the camera and the last requested frame is drawn.
    /// The timeout is generous because CI's Firefox renders in software, several pages at once.
    /// </summary>
    protected async Task WaitForCameraRestAsync()
    {
        try
        {
            await Page.WaitForFunctionAsync("() => !window.__j3dTest.camera().moving", null, new PageWaitForFunctionOptions { Timeout = 30_000 });
        }
        catch (TimeoutException)
        {
            // Say whether frames were still being drawn (slow) or not at all (a stalled loop).
            var state = await Page.EvaluateAsync<string>("() => JSON.stringify({ camera: window.__j3dTest.camera(), frames: window.__j3dTest.frames() })");
            throw new TimeoutException($"The camera didn't come to rest: {state}");
        }
    }

    protected Task<int> FramesAsync() => Page.EvaluateAsync<int>("() => window.__j3dTest.frames()");

    /// <summary>Where a world point is on screen, in CSS pixels.</summary>
    protected async Task<ScreenPoint> ProjectAsync(double x, double y, double z) =>
        await EvaluateAsync<ScreenPoint>($"() => window.__j3dTest.project([{x}, {y}, {z}])");

    /// <summary>Where a view cube region (e.g. <c>top-front-right</c>) is on screen; null when it faces away.</summary>
    protected async Task<ScreenPoint?> ViewCubePointAsync(string region) =>
        await EvaluateAsync<ScreenPoint?>($"() => window.__j3dTest.viewCubePoint('{region}')");

    /// <summary>
    /// The colours of the page at the given CSS pixels, as composited (canvas over the viewport's CSS
    /// gradient). Playwright for .NET has no visual comparison, so tests sample pixels (docs/plan.md §8).
    /// </summary>
    protected async Task<IReadOnlyList<Rgb>> SamplePixelsAsync(params ScreenPoint[] points)
    {
        var png = await Page.ScreenshotAsync(new PageScreenshotOptions { Scale = ScreenshotScale.Css, Type = ScreenshotType.Png });
        var samples = await Page.EvaluateAsync<int[][]>(
            """
            async ([png, points]) => {
              const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
              const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
              const canvas = document.createElement('canvas'); // no OffscreenCanvas in WebKit on Windows
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
              const context = canvas.getContext('2d');
              context.drawImage(bitmap, 0, 0);
              return points.map(([x, y]) => [...context.getImageData(Math.round(x), Math.round(y), 1, 1).data]);
            }
            """,
            new object[] { Convert.ToBase64String(png), points.Select(p => new[] { p.X, p.Y }).ToArray() });
        return [.. samples.Select(rgba => new Rgb(rgba[0], rgba[1], rgba[2]))];
    }

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

public sealed record CameraState(
    string Projection,
    double[] Position,
    double[] Target,
    double Azimuth,
    double Polar,
    double Distance,
    double Zoom,
    double VisibleHeight,
    double Near,
    double Far,
    bool Moving);

public sealed record ScreenPoint(double X, double Y);

public readonly record struct Rgb(int R, int G, int B)
{
    public int Brightness => (R + G + B) / 3;

    public override string ToString() => $"rgb({R}, {G}, {B})";
}
