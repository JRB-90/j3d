using System.Diagnostics;
using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M11 (D140): twice in M8's manual checklist, a model's Delete opened no dialog right after a
/// measurement. On demand only: <c>J3D_STRESS=50</c> runs that many rounds of measuring across two
/// models, then clicking Delete on the measured one, alternately while the measurement is still being
/// worked out and once it's shown, and expects the dialog every time. Since M16 (D200) as many rounds
/// of editing a kept model and reloading, half of them at once.
/// </summary>
public sealed class StressTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private static readonly string? Rounds = Environment.GetEnvironmentVariable("J3D_STRESS");

    [Fact]
    public async Task Delete_opens_its_dialog_right_after_every_measurement()
    {
        Assert.SkipUnless(int.TryParse(Rounds, out var rounds) && rounds > 0, "Set J3D_STRESS to a number of rounds (e.g. 50).");

        // The box (top at z = 30) stands inside coloured-part.step's 40 × 30 × 20 block (top at z = 20).
        await ImportWithToolbarAsync("box.brep", "coloured-part.step");
        await WaitForImportsAsync(2);
        await Expect(Page.Locator("[data-testid=model-item][data-status=loaded]")).ToHaveCountAsync(2);
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
        await Page.Keyboard.PressAsync("m");
        var top = await ProjectAsync(5, 10, 30);
        var block = await ProjectAsync(35, 25, 20);
        var delete = Page.GetByTestId("model-item").Nth(0).GetByTestId("delete-model");
        var dialog = Page.Locator(".mud-dialog");
        var missed = new List<int>();
        var stopwatch = Stopwatch.StartNew();

        for (var round = 1; round <= rounds; round++)
        {
            await Page.Mouse.ClickAsync((float)top.X, (float)top.Y);
            await Expect(Page.GetByTestId("measure-reference")).ToHaveCountAsync(1);
            await Page.Mouse.ClickAsync((float)block.X, (float)block.Y);
            if (round % 2 == 0)
            {
                await Expect(Page.GetByTestId("measure-result")).ToContainTextAsync("10.000 mm");
            }

            await delete.ClickAsync();
            try
            {
                await Expect(dialog).ToBeVisibleAsync(new() { Timeout = 5_000 });
                await Expect(dialog).ToContainTextAsync("Delete box.brep?");
                await dialog.GetByRole(AriaRole.Button, new() { Name = "Cancel" }).ClickAsync();
                await Expect(dialog).ToBeHiddenAsync();
            }
            catch (PlaywrightException)
            {
                missed.Add(round);
            }

            // Since M12 (D147) Esc clears the measurement and ends the tool; M starts it again.
            await Expect(Page.GetByTestId("measure-result")).ToHaveCountAsync(1);
            await Page.Keyboard.PressAsync("Escape");
            await Expect(Page.GetByTestId("measure-label")).ToHaveCountAsync(0);
            await Page.Keyboard.PressAsync("m");
        }

        TestContext.Current.TestOutputHelper?.WriteLine(
            $"{BrowserName}: {rounds} rounds in {stopwatch.Elapsed.TotalSeconds:F0} s, Delete opened no dialog in {missed.Count}");
        Assert.True(missed.Count == 0, $"Delete opened no dialog in rounds {string.Join(", ", missed)} of {rounds}.");
        Assert.Equal(2, (await ModelsAsync()).Count);
        AssertNoConsoleErrors();
    }

    /// <summary>
    /// M16 (D200): once in M16's timings a kept model was gone after a reload, its copy deleted. The
    /// plant is expanded (large edits, kept in the model's own files since D205), then each round pastes
    /// a copy of a part and reloads, every other round at once, perhaps while the store is writing. The
    /// model must come back every time, with at least the parts it had before the last paste.
    /// </summary>
    [Fact]
    public async Task A_kept_model_comes_back_after_every_reload_whatever_was_being_written()
    {
        Assert.SkipUnless(int.TryParse(Rounds, out var rounds) && rounds > 0, "Set J3D_STRESS to a number of rounds (e.g. 50).");

        await ImportWithToolbarAsync("plant.step");
        var id = Assert.Single(await WaitForImportsAsync(1)).Id;
        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        await Page.GetByTestId("model-tree-node").First.Locator(".j3d-tree-node-name").ClickAsync(new() { Button = MouseButton.Right });
        await Page.GetByTestId("context-expand-all").ClickAsync();
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).parts.length > 146", id, new() { Timeout = 30_000 });
        var parts = await PartCountAsync(id);
        var stopwatch = Stopwatch.StartNew();

        for (var round = 1; round <= rounds; round++)
        {
            await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
            var found = await Page.EvaluateAsync<JsonElement>(
                "id => { const s = window.__j3dTest.partState(id); for (const node of s.parts) { const p = window.__j3dTest.partPoint(id, node); if (p) return p; } return null; }",
                id);
            var point = found.ValueKind == JsonValueKind.Object ? found.Deserialize<ScreenPoint>(Json) : null;
            Assert.True(point is not null, $"round {round}: no part in view");
            await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
            await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).selected.length === 1", id);
            await Page.Keyboard.PressAsync("Control+c");
            await Page.Keyboard.PressAsync("Control+v");
            await Page.WaitForFunctionAsync("([id, parts]) => window.__j3dTest.partState(id).parts.length === parts + 1", new object[] { id, parts });
            if (round % 2 == 0)
            {
                await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
            }

            await Page.ReloadAsync();
            await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
            try
            {
                await Page.WaitForFunctionAsync(
                    "id => window.__j3dTest.models().some(m => m.id === id && m.status === 'loaded') && window.__j3dTest.partState(id)",
                    id,
                    new() { Timeout = 30_000 });
            }
            catch (TimeoutException)
            {
                var state = await Page.EvaluateAsync<string>("() => JSON.stringify({ models: window.__j3dTest.models().map(m => [m.id, m.status]), store: window.__j3dTest.store() })");
                Assert.Fail($"round {round}: the model didn't come back after the reload: {state}");
            }

            var now = await PartCountAsync(id);
            Assert.True(round % 2 == 0 ? now == parts + 1 : now >= parts, $"round {round}: {now} parts after the reload, {parts} before the paste");
            parts = now;
        }

        TestContext.Current.TestOutputHelper?.WriteLine($"{BrowserName}: {rounds} reloads in {stopwatch.Elapsed.TotalSeconds:F0} s, ending with {parts} parts");
        AssertNoConsoleErrors();
    }

    private Task<int> PartCountAsync(string id) => Page.EvaluateAsync<int>("id => window.__j3dTest.partState(id).parts.length", id);
}
