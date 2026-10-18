using System.Diagnostics;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// M11 (D140): twice in M8's manual checklist, a model's Delete opened no dialog right after a
/// measurement. On demand only: <c>J3D_STRESS=50</c> runs that many rounds of measuring across two
/// models, then clicking Delete on the measured one, alternately while the measurement is still being
/// worked out and once it's listed, and expects the dialog every time.
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
            await Expect(Page.GetByTestId("measure-pending")).ToHaveCountAsync(1);
            await Page.Mouse.ClickAsync((float)block.X, (float)block.Y);
            if (round % 2 == 0)
            {
                await Expect(Page.GetByTestId("measurement")).ToContainTextAsync("10.000 mm");
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

            await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(1);
            await Page.GetByTestId("measure-clear").ClickAsync();
            await Expect(Page.GetByTestId("measurement")).ToHaveCountAsync(0);
        }

        TestContext.Current.TestOutputHelper?.WriteLine(
            $"{BrowserName}: {rounds} rounds in {stopwatch.Elapsed.TotalSeconds:F0} s, Delete opened no dialog in {missed.Count}");
        Assert.True(missed.Count == 0, $"Delete opened no dialog in rounds {string.Join(", ", missed)} of {rounds}.");
        Assert.Equal(2, (await ModelsAsync()).Count);
        AssertNoConsoleErrors();
    }
}
