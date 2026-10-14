using System.Diagnostics;
using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// Spike S2 and the M2 exit criterion: a large generated STEP either loads or fails cleanly with
/// OutOfMemory, in each browser. On demand only:
/// <c>npm run fixtures:large -- 200</c>, then run with <c>J3D_LARGE_FIXTURES=200</c>.
/// </summary>
public sealed class LargeModelTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private static readonly string? Sizes = Environment.GetEnvironmentVariable("J3D_LARGE_FIXTURES");

    [Fact]
    public async Task Large_step_loads_or_fails_with_OutOfMemory()
    {
        Assert.SkipWhen(string.IsNullOrWhiteSpace(Sizes), "Set J3D_LARGE_FIXTURES (e.g. 200) after running npm run fixtures:large.");

        foreach (var size in Sizes!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var fixture = $"large/large-{size}mb.step";
            Assert.True(File.Exists(Fixtures.PathOf(fixture)), $"Run npm run fixtures:large -- {size} first.");

            var stopwatch = Stopwatch.StartNew();
            await ImportAsync(fixture);
            await Page.WaitForFunctionAsync(
                "() => window.__j3dTest.models().every(m => m.status === 'loaded' || m.status === 'failed')",
                null,
                new PageWaitForFunctionOptions { Timeout = 20 * 60_000, PollingInterval = 1000 });

            // Without the tree, which has a node per part.
            var json = await Page.EvaluateAsync<JsonElement>("() => window.__j3dTest.models().map(({ tree, ...model }) => model)");
            var model = Assert.Single(json.Deserialize<TestModel[]>(Json)!);
            TestContext.Current.TestOutputHelper?.WriteLine(
                $"{BrowserName} {fixture}: {model.Status} in {stopwatch.Elapsed.TotalSeconds:F1} s, " +
                (model.Status == "loaded"
                    ? $"{model.Stats!.Prototypes} parts, {model.Stats.Triangles} triangles, WASM heap {model.MemoryBytes / (1 << 20)} MB"
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
}
