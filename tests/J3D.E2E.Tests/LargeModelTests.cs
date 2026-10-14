using System.Diagnostics;
using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// Spike S2 and the M2 exit criterion: a large generated STEP either loads or fails cleanly with
/// OutOfMemory, in each browser. Since M5 a loaded model is also measured for the tuning decisions
/// (D63, D71): the longest main-thread task while it's added and fitted, its draw calls and buffer
/// bytes, what one frame costs, the frame rate while orbiting, and opening its tree's first level.
/// Long tasks are only reported by Chromium. On demand only:
/// <c>npm run fixtures:large -- 200 curved-100</c>, then run with
/// <c>J3D_LARGE_FIXTURES=200,curved-100</c>; add <c>HEADED=1</c> to measure on the real GPU.
/// </summary>
public sealed class LargeModelTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private static readonly string? Names = Environment.GetEnvironmentVariable("J3D_LARGE_FIXTURES");

    [Fact]
    public async Task Large_step_loads_or_fails_with_OutOfMemory()
    {
        Assert.SkipWhen(string.IsNullOrWhiteSpace(Names), "Set J3D_LARGE_FIXTURES (e.g. 200) after running npm run fixtures:large.");

        foreach (var name in Names!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            // As scripts/generate-large-step.mjs names them: 200 is block copies, curved-100 curved parts.
            var fixture = name.StartsWith("curved-", StringComparison.Ordinal) ? $"large/{name}mb.step" : $"large/large-{name}mb.step";
            Assert.True(File.Exists(Fixtures.PathOf(fixture)), $"Run npm run fixtures:large -- {name} first.");

            await StartLongTaskLogAsync();
            var stopwatch = Stopwatch.StartNew();
            await ImportAsync(fixture);
            await Page.WaitForFunctionAsync(
                "() => window.__j3dTest.models().every(m => m.status === 'loaded' || m.status === 'failed')",
                null,
                new PageWaitForFunctionOptions { Timeout = 20 * 60_000, PollingInterval = 1000 });
            var elapsed = stopwatch.Elapsed;

            // Without the tree, which has a node per part.
            var json = await Page.EvaluateAsync<JsonElement>("() => window.__j3dTest.models().map(({ tree, ...model }) => model)");
            var model = Assert.Single(json.Deserialize<TestModel[]>(Json)!);
            TestContext.Current.TestOutputHelper?.WriteLine(
                $"{BrowserName} {fixture}: {model.Status} in {elapsed.TotalSeconds:F1} s, " +
                (model.Status == "loaded"
                    ? $"{model.Stats!.Prototypes} parts, {model.Stats.Triangles} triangles, WASM heap {model.MemoryBytes / (1 << 20)} MB; {await MeasureAsync()}"
                    : $"{model.Error}"));

            if (model.Status == "failed")
            {
                Assert.Equal("OutOfMemory", model.Error!.Code);
            }

            await RemoveAsync(model.Id); // free the heap before the next size
            Assert.Equal(0, await LiveWorkersAsync());
        }

        AssertNoConsoleErrors();
    }

    /// <summary>Measures the loaded model in the scene, as a line for the test output.</summary>
    private async Task<string> MeasureAsync()
    {
        await WaitForCameraRestAsync(); // the first model's fit (D30) draws it for the first time
        var adding = await TakeLongTasksAsync();

        var stats = await RenderStatsAsync();
        // The context the viewer already has (a second getContext of the same kind returns it).
        var gpu = await Page.EvaluateAsync<string>(
            """
            () => {
                const gl = document.querySelector('[data-testid=viewport] canvas').getContext('webgl2');
                const info = gl.getExtension('WEBGL_debug_renderer_info');
                return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            }
            """);
        var frame = await Page.EvaluateAsync<double>(
            """
            () => {
                const box = document.querySelector('[data-testid=viewport] canvas').getBoundingClientRect();
                const point = [[box.left + box.width / 2, box.top + box.height / 2]];
                const times = [];
                for (let i = 0; i < 9; i++) {
                    const start = performance.now();
                    window.__j3dTest.canvasPixels(point); // draws, then reads back, so the GPU has finished
                    times.push(performance.now() - start);
                }
                return times.sort((a, b) => a - b)[4];
            }
            """);

        var fps = await OrbitAsync();
        var orbiting = await TakeLongTasksAsync();

        var tree = Stopwatch.StartNew();
        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        await Page.GetByTestId("model-tree-node").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
        var treeMs = tree.Elapsed.TotalMilliseconds;
        var opening = await TakeLongTasksAsync();

        return $"adding: longest task {Longest(adding)}; {stats.DrawCalls} draw calls, {stats.Triangles} triangles, " +
            $"{stats.Lines} lines, {stats.Geometries} geometries, buffers {stats.BufferBytes / (1 << 20)} MB; " +
            $"a frame {frame:F1} ms; orbiting {fps:F0} fps (longest task {Longest(orbiting)}); " +
            $"tree's first level {treeMs:F0} ms (longest task {Longest(opening)}); GPU {gpu}";
    }

    /// <summary>Right-drags the camera round, a move per frame, and returns the frames drawn per second.</summary>
    private async Task<double> OrbitAsync()
    {
        var box = await Page.GetByTestId("viewport").BoundingBoxAsync();
        var (x, y) = (box!.X + box.Width / 2, box.Y + box.Height / 2);
        await Page.Mouse.MoveAsync((float)x, (float)y);
        await Page.Mouse.DownAsync(new MouseDownOptions { Button = MouseButton.Right });
        var frames = await FramesAsync();
        var stopwatch = Stopwatch.StartNew();
        for (var step = 1; step <= 60; step++)
        {
            await Page.Mouse.MoveAsync((float)(x + step * 3), (float)y);
            await Page.EvaluateAsync("() => new Promise(requestAnimationFrame)");
        }

        var fps = (await FramesAsync() - frames) / stopwatch.Elapsed.TotalSeconds;
        await Page.Mouse.UpAsync(new MouseUpOptions { Button = MouseButton.Right });
        await WaitForCameraRestAsync();
        return fps;
    }

    /// <summary>Starts recording the main thread's tasks over 50 ms, where the browser reports them.</summary>
    private async Task StartLongTaskLogAsync() => await Page.EvaluateAsync(
        """
        () => {
            window.__longTasks = [];
            window.__longTaskObserver?.disconnect();
            if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
                window.__longTaskObserver = new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((e) => e.duration)));
                window.__longTaskObserver.observe({ type: 'longtask' });
            }
        }
        """);

    /// <summary>The long tasks since the last call. Waits a moment first: the observer reports them asynchronously.</summary>
    private async Task<double[]?> TakeLongTasksAsync()
    {
        await Page.WaitForTimeoutAsync(500);
        return await Page.EvaluateAsync<double[]?>(
            "() => PerformanceObserver.supportedEntryTypes.includes('longtask') ? window.__longTasks.splice(0) : null");
    }

    private static string Longest(double[]? tasks) =>
        tasks is null ? "not reported" : tasks.Length == 0 ? "none over 50 ms" : $"{tasks.Max():F0} ms of {tasks.Length}";
}
