namespace J3D.E2E.Tests;

/// <summary>
/// What the M3 viewer draws, checked by sampling the page's pixels (decision D49): models in their
/// file colours, translucency, the view cube, and on-demand rendering.
/// </summary>
public sealed class RenderingTests(J3DAppFixture app) : ViewerPageTest(app)
{
    [Fact]
    public async Task Draws_a_step_part_in_its_file_colours_over_the_background()
    {
        // coloured-part.step: a 40 × 30 × 20 block, blue with a red top face.
        await ImportAsync("coloured-part.step");
        await WaitForImportsAsync(1);
        await WaitForCameraRestAsync();

        var top = await ProjectAsync(20, 15, 20);
        var front = await ProjectAsync(20, 0, 10);
        var corner = await ViewportCornerAsync();
        var pixels = await SamplePixelsAsync(top, front, corner);

        await AssertRenderedAsync(pixels[0].R > pixels[0].G + 80 && pixels[0].R > pixels[0].B + 80, $"top face should be red: {pixels[0]}");
        await AssertRenderedAsync(pixels[1].B > pixels[1].R + 80 && pixels[1].B > pixels[1].G + 40, $"front face should be blue: {pixels[1]}");
        await AssertRenderedAsync(pixels[2].Brightness < 70, $"the background should show at the corner: {pixels[2]}");
        AssertNoConsoleErrors();
    }

    [Fact]
    public async Task A_translucent_cover_shows_the_part_inside_it()
    {
        // translucent.step: a 10 mm green core in the middle of a 40 % opaque light grey-blue cover,
        // 30 mm across. The core's top face is seen through the cover's top.
        await ImportAsync("translucent.step");
        await WaitForImportsAsync(1);
        await WaitForCameraRestAsync();

        var throughCover = await ProjectAsync(15, 15, 20);
        var coverOnly = await ProjectAsync(3, 0, 3);
        var background = await ViewportCornerAsync();
        var pixels = await SamplePixelsAsync(throughCover, coverOnly, background);

        await AssertRenderedAsync(pixels[0].G > pixels[0].R + 25 && pixels[0].G > pixels[0].B + 15, $"the green core should show through: {pixels[0]}");
        await AssertRenderedAsync(pixels[1].Brightness > pixels[2].Brightness + 20, $"the cover should lighten the background: {pixels[1]} vs {pixels[2]}");
        await AssertRenderedAsync(pixels[1].Brightness < 200, $"the cover should not be opaque: {pixels[1]}");
    }

    [Fact]
    public async Task Deleting_a_model_clears_it_from_the_view_and_keeps_the_camera()
    {
        await ImportAsync("coloured-part.step");
        var model = Assert.Single(await WaitForImportsAsync(1));
        await WaitForCameraRestAsync();
        var camera = await CameraAsync();
        var top = await ProjectAsync(20, 15, 20);

        Assert.True(await RemoveAsync(model.Id));
        await WaitForCameraRestAsync();

        var pixel = Assert.Single(await SamplePixelsAsync(top));
        await AssertRenderedAsync(pixel.Brightness < 70, $"only the background should remain: {pixel}");
        var after = await CameraAsync();
        Assert.Equal(camera.Target, after.Target);
        Assert.Equal((camera.Azimuth, camera.Polar, camera.VisibleHeight), (after.Azimuth, after.Polar, after.VisibleHeight));
    }

    [Fact]
    public async Task The_view_cube_is_drawn_and_highlights_the_region_under_the_mouse()
    {
        await WaitForCameraRestAsync();
        var front = (await ViewCubePointAsync("front"))!;
        var before = Assert.Single(await SamplePixelsAsync(front));
        await AssertRenderedAsync(before.Brightness is >= 40 and <= 90, $"the cube's grey face should show over the dark background: {before}");

        await Page.Mouse.MoveAsync((float)front.X, (float)front.Y);
        await Page.WaitForFunctionAsync("() => window.__j3dTest.hoveredRegion() === 'front'");
        await WaitForCameraRestAsync();
        var after = Assert.Single(await SamplePixelsAsync(front));
        await AssertRenderedAsync(after.B > after.R + 80, $"the hovered face should turn blue: {after}");

        await Page.Mouse.MoveAsync(10, 10);
        await Page.WaitForFunctionAsync("() => window.__j3dTest.hoveredRegion() === null");
    }

    [Fact]
    public async Task Renders_only_when_something_changes()
    {
        await ImportAsync("box.brep");
        await WaitForImportsAsync(1);
        await WaitForCameraRestAsync();

        var frames = await FramesAsync();
        await Page.WaitForTimeoutAsync(500);
        Assert.Equal(frames, await FramesAsync());

        await Page.Keyboard.PressAsync("f");
        await WaitForCameraRestAsync();
        Assert.True(await FramesAsync() > frames, "a change draws a new frame");
    }

    private async Task<ScreenPoint> ViewportCornerAsync()
    {
        var box = (await Page.GetByTestId("viewport").BoundingBoxAsync())!;
        return new ScreenPoint(box.X + 20, box.Y + box.Height - 20);
    }
}
