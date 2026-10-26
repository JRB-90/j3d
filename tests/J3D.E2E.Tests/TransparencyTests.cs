using System.Text.Json;

namespace J3D.E2E.Tests;

/// <summary>
/// M10: weighted blended order-independent transparency (D90, D129, D130), on intersecting.step's
/// three 50 % opaque bars crossing at one centre, where sorting whole parts can't tell which is in front.
/// </summary>
public sealed class TransparencyTests(J3DAppFixture app) : ViewerPageTest(app)
{
    /// <summary>
    /// A grid of pixels over the bars, read from the canvas in the frame they're drawn, each with the bar
    /// the pointer would pick there (the nearest), and how often the pixel's strongest colour is that bar's.
    /// Edge pixels (near black) and pixels on no bar are left out.
    /// </summary>
    private const string NearestBarScript = """
        () => {
          const hook = window.__j3dTest;
          const names = hook.models()[0].tree.map(n => n.name);
          const corners = [[0,0,0],[40,40,40],[0,40,0],[40,0,40],[0,0,40],[40,40,0],[40,0,0],[0,40,40]].map(p => hook.project(p));
          const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
          const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
          const points = [];
          for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) points.push([left + (right - left) * i / 30, top + (bottom - top) * j / 30]);
          const pixels = hook.canvasPixels(points);
          let sampled = 0, nearest = 0;
          points.forEach(([x, y], k) => {
            const part = hook.partAt(x, y), pixel = pixels[k];
            if (!part || !pixel) return;
            const channel = { 'Red bar': 0, 'Green bar': 1, 'Blue bar': 2 }[names[part.node]];
            const strongest = Math.max(pixel[0], pixel[1], pixel[2]);
            if (strongest < 40) return;
            sampled++;
            if (pixel[channel] === strongest) nearest++;
          });
          return { mode: hook.transparency(), sampled, fraction: nearest / sampled };
        }
        """;

    [Fact]
    public async Task The_nearest_of_intersecting_translucent_parts_shows_in_front()
    {
        await ImportAsync("intersecting.step");
        await WaitForImportsAsync(1);
        await WaitForCameraRestAsync();
        var oit = await ScoreAsync();
        Assert.SkipWhen(oit.Mode == "unsupported", "This browser's WebGL has no blendable float render targets, so translucency stays sorted (D130, R21).");

        Assert.Equal("oit", oit.Mode);
        Assert.True(oit.Sampled > 100, $"too few pixels on the bars: {oit.Sampled}");
        await AssertRenderedAsync(oit.Fraction >= 0.9, $"with OIT, the nearest bar's colour should lead in at least 90 % of pixels: {oit.Fraction:P0}");

        // Sorted blending, for comparison: the bars' centres coincide, so draw order decides.
        await Page.EvaluateAsync("() => window.__j3dTest.useOrderIndependentTransparency(false)");
        await WaitForCameraRestAsync();
        var sorted = await ScoreAsync();
        Assert.Equal("sorted", sorted.Mode);
        Assert.True(sorted.Fraction < oit.Fraction - 0.05, $"sorted blending ({sorted.Fraction:P0}) should do clearly worse than OIT ({oit.Fraction:P0})");
        AssertNoConsoleErrors();
    }

    /// <summary>
    /// M16: a pasted copy (an edit's instanced mesh) of <c>translucent.step</c>'s 30 mm translucent cover
    /// (node 2) is drawn. The viewer worked out the materials it sorts only when a model came or went, so
    /// the copy's faces failed in the OIT passes and only its edges showed.
    /// </summary>
    [Fact]
    public async Task A_pasted_copy_of_a_translucent_part_is_drawn()
    {
        await ImportAsync("translucent.step");
        var id = Assert.Single(await WaitForImportsAsync(1)).Id;
        await WaitForCameraRestAsync();
        var cover = (await PartPointAsync(id, 2))!;
        await Page.Mouse.ClickAsync((float)cover.X, (float)cover.Y);
        await WaitForPartStateAsync(id, [], [2]);
        await Page.Keyboard.PressAsync("Control+c");
        await Page.Keyboard.PressAsync("Control+v");
        await WaitForPartStateAsync(id, [], [3]);
        await Page.Keyboard.PressAsync("w");
        await Page.GetByTestId("move-x").FillAsync("50");
        await Page.GetByTestId("move-x").PressAsync("Enter");
        await Page.WaitForFunctionAsync("id => window.__j3dTest.placement(id, 3)?.local[12] === 50", id);

        // A click on empty space clears the selection, whose overlay would draw over the copy anyway.
        var viewport = (await Page.GetByTestId("viewport").BoundingBoxAsync())!;
        var empty = new ScreenPoint(viewport.X + 20, viewport.Y + 20); // the Move panel is at the bottom
        await Page.Mouse.ClickAsync((float)empty.X, (float)empty.Y);
        await WaitForPartStateAsync(id, [], []);
        await Page.Keyboard.PressAsync("f");
        await WaitForCameraRestAsync();

        // The middle of the copy's top face, away from its edges: grey like the cover's, not near black
        // (without the fix it read 0, 1, 4 while the cover's read 90, 96, 101).
        var top = await ProjectAsync(65, 15, 30);
        double[][] points = [[top.X, top.Y]];
        var pixels = await Page.EvaluateAsync<JsonElement>(
            "points => ({ mode: window.__j3dTest.transparency(), pixels: window.__j3dTest.canvasPixels(points) })",
            points);
        var mode = pixels.GetProperty("mode").GetString();
        Assert.SkipWhen(mode == "unsupported", "This browser's WebGL has no blendable float render targets, so translucency stays sorted (D130, R21).");
        Assert.Equal("oit", mode);
        var face = pixels.GetProperty("pixels")[0];
        var strongest = Enumerable.Range(0, 3).Max(i => face[i].GetInt32());
        await AssertRenderedAsync(strongest > 40, $"the copy's top face should be drawn: {face}");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task An_opaque_scene_draws_as_before()
    {
        await ImportAsync("coloured-part.step");
        await WaitForImportsAsync(1);
        await WaitForCameraRestAsync();

        var mode = await Page.EvaluateAsync<string>("() => window.__j3dTest.transparency()");
        Assert.True(mode is "sorted" or "unsupported", $"nothing is translucent, so no OIT passes: {mode}");
    }

    private async Task<Score> ScoreAsync()
    {
        var result = await Page.EvaluateAsync<JsonElement>(NearestBarScript);
        return result.Deserialize<Score>(Json)!;
    }

    private sealed record Score(string Mode, int Sampled, double Fraction);
}
