using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// Camera behaviour in the M3 viewer, asserted through the camera state the test hook reports
/// (decision D49): fit, mouse and touch mapping (D16, D17), the view cube (D31) and the projection
/// toggle.
/// </summary>
public sealed class NavigationTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private static readonly double IsometricPolar = Math.Acos(1 / Math.Sqrt(3));

    [Fact]
    public async Task Only_the_first_model_in_an_empty_scene_fits_the_view()
    {
        await ImportAsync("coloured-part.step");
        var first = Assert.Single(await WaitForImportsAsync(1));
        await WaitForCameraRestAsync();
        var fitted = await CameraAsync();

        // The isometric view centres the 40 × 30 × 20 block.
        AssertVector([20, 15, 10], fitted.Target);
        AssertAngle(Math.PI / 4, fitted.Azimuth);
        Assert.Equal(IsometricPolar, fitted.Polar, 6);

        await ImportAsync("box.brep");
        await WaitForImportsAsync(2);
        await WaitForCameraRestAsync();
        AssertSameView(fitted, await CameraAsync());

        // Once every model has gone, the next one fits again (D30).
        foreach (var model in await ModelsAsync())
        {
            await RemoveAsync(model.Id);
        }

        await ImportAsync("box.brep");
        await WaitForImportsAsync(1);
        await WaitForCameraRestAsync();
        AssertVector([5, 10, 15], (await CameraAsync()).Target);
        Assert.NotEqual(first.Id, (await ModelsAsync())[0].Id);
    }

    [Fact]
    public async Task Right_drag_rotates_turntable_about_the_target()
    {
        var before = await ImportAndRestAsync();

        await DragAsync(MouseButton.Right, dx: 150, dy: 0);
        var turned = await CameraAsync();
        Assert.True(Math.Abs(AngleBetween(turned.Azimuth, before.Azimuth)) > 0.3, "a horizontal drag turns about Z");
        Assert.Equal(before.Polar, turned.Polar, 3);
        await AssertAtCentreAsync(turned.Target); // the pivot, now on the part (D248), stays in the middle

        await DragAsync(MouseButton.Right, dx: 0, dy: 80);
        var tilted = await CameraAsync();
        Assert.True(Math.Abs(tilted.Polar - turned.Polar) > 0.2, "a vertical drag tilts");
        AssertAngle(turned.Azimuth, tilted.Azimuth);
        Assert.Equal(before.VisibleHeight, tilted.VisibleHeight, 6);
    }

    /// <summary>
    /// D248 (M20): a turn turns about the model under the screen centre. From Home on the bracket, the
    /// centre's ray first meets the top plate (z 35 to 40), not the box's centre (z = 20) where the fit put
    /// the target; so a right-drag moves the pivot there without moving the view, and that point
    /// stays in the middle as it turns.
    /// </summary>
    [Fact]
    public async Task A_turn_turns_about_the_model_under_the_centre()
    {
        await ImportAsync("assembly.step");
        await WaitForImportsAsync(1);
        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();
        Assert.Equal(20, (await CameraAsync()).Target[2], 3);

        await DragAsync(MouseButton.Left, dx: 30, dy: 0); // a pan leaves the target where it was in depth
        Assert.Equal(20, (await CameraAsync()).Target[2], 3);
        await DragAsync(MouseButton.Right, dx: 120, dy: 0);

        var turned = await CameraAsync();
        Assert.InRange(turned.Target[2], 35, 40.001); // on the top plate (its pin's hole is near the centre)
        await AssertAtCentreAsync(turned.Target);
        AssertNoConsoleErrors();
    }

    [Theory]
    [InlineData("left")]
    [InlineData("middle")]
    public async Task Left_and_middle_drag_pan(string button)
    {
        var before = await ImportAndRestAsync();

        await DragAsync(button == "left" ? MouseButton.Left : MouseButton.Middle, dx: 120, dy: 60);
        var after = await CameraAsync();

        Assert.True(Distance(before.Target, after.Target) > 1, "the target moves with the drag");
        AssertAngle(before.Azimuth, after.Azimuth);
        Assert.Equal(before.Polar, after.Polar, 6);
        Assert.Equal(before.VisibleHeight, after.VisibleHeight, 6);
    }

    [Fact]
    public async Task The_wheel_zooms_towards_the_view_centre_in_both_projections()
    {
        var before = await ImportAndRestAsync();

        await WheelAsync(-300);
        var zoomed = await CameraAsync();
        Assert.True(zoomed.VisibleHeight < before.VisibleHeight * 0.9, "the wheel zooms in");
        AssertVector(before.Target, zoomed.Target);

        await SetProjectionAsync("perspective");
        var perspective = await CameraAsync();
        await WheelAsync(-300);
        var dollied = await CameraAsync();
        Assert.True(dollied.Distance < perspective.Distance * 0.9, "the wheel dollies in");
        Assert.Equal(1, dollied.Zoom);
        AssertVector(perspective.Target, dollied.Target);
    }

    [Fact]
    public async Task The_wheel_zooms_toward_the_pointer()
    {
        var before = await ImportAndRestAsync();
        var h = before.VisibleHeight;
        double[] world = [before.Target[0] + h * 0.25, before.Target[1], before.Target[2] - h * 0.15];
        var under = await ProjectAsync(world[0], world[1], world[2]);

        await Page.Mouse.MoveAsync((float)under.X, (float)under.Y);
        await Page.Mouse.WheelAsync(0, -300);
        await WaitForWheelAsync(h);

        // Orthographic zoom to the cursor keeps what's under the pointer where it was (D74).
        var zoomed = await CameraAsync();
        Assert.True(zoomed.VisibleHeight < h * 0.9, "the wheel zooms in");
        var after = await ProjectAsync(world[0], world[1], world[2]);
        Assert.InRange(after.X - under.X, -2, 2);
        Assert.InRange(after.Y - under.Y, -2, 2);
    }

    [Fact]
    public async Task The_browser_context_menu_is_suppressed_over_the_canvas()
    {
        await ImportAndRestAsync();
        await Page.EvaluateAsync("() => document.addEventListener('contextmenu', e => window.__contextMenuPrevented = e.defaultPrevented)");

        var centre = await ViewportCentreAsync();
        await Page.Mouse.ClickAsync((float)centre.X, (float)centre.Y, new MouseClickOptions { Button = MouseButton.Right });

        Assert.True(await Page.EvaluateAsync<bool>("() => window.__contextMenuPrevented === true"));
    }

    [Fact]
    public async Task One_finger_rotates_and_two_fingers_pinch_to_zoom()
    {
        var before = await ImportAndRestAsync();
        var centre = await ViewportCentreAsync();

        await TouchAsync(centre, [[0, 0, 120, 0]]);
        var rotated = await CameraAsync();
        Assert.True(Math.Abs(AngleBetween(rotated.Azimuth, before.Azimuth)) > 0.3, "one finger rotates");

        await TouchAsync(centre, [[-40, 0, -40, 0], [40, 0, 280, 0]]);
        var pinched = await CameraAsync();
        Assert.True(pinched.VisibleHeight < rotated.VisibleHeight * 0.95, "spreading two fingers zooms in");
    }

    [Theory]
    [InlineData("top", 0, 1e-4)]
    [InlineData("front", 0, Math.PI / 2)]
    [InlineData("right", Math.PI / 2, Math.PI / 2)]
    [InlineData("front-right", Math.PI / 4, Math.PI / 2)]
    [InlineData("top-right", Math.PI / 2, Math.PI / 4)]
    [InlineData("top-front-right", Math.PI / 4, 0.9553166181245093)]
    public async Task Clicking_a_view_cube_region_turns_to_its_view_and_keeps_the_zoom(string region, double azimuth, double polar)
    {
        var before = await ImportAndRestAsync();
        if (region == "top-front-right")
        {
            // Start from the front so the click is a real turn.
            await ClickViewCubeAsync("front");
        }

        await ClickViewCubeAsync(region);

        var after = await CameraAsync();
        AssertAngle(azimuth, after.Azimuth);
        Assert.Equal(polar, after.Polar, 6);
        Assert.Equal(before.VisibleHeight, after.VisibleHeight, 6);
        AssertVector(before.Target, after.Target);
    }

    [Fact]
    public async Task Home_returns_to_the_isometric_view_and_fits_everything()
    {
        var fitted = await ImportAndRestAsync();
        await ClickViewCubeAsync("front");
        await DragAsync(MouseButton.Left, dx: 100, dy: 50);
        await WheelAsync(-300);

        await Page.GetByTestId("home-button").ClickAsync();
        await WaitForCameraRestAsync();

        AssertSameView(fitted, await CameraAsync());
    }

    [Fact]
    public async Task F_and_the_fit_all_button_frame_every_model_from_the_current_direction()
    {
        var fitted = await ImportAndRestAsync();

        await DragAsync(MouseButton.Left, dx: 100, dy: 50);
        await WheelAsync(-300);
        await Page.Keyboard.PressAsync("f");
        await WaitForCameraRestAsync();
        AssertSameView(fitted, await CameraAsync());

        await DragAsync(MouseButton.Left, dx: -80, dy: 40);
        await Page.GetByTestId("fit-all-button").ClickAsync();
        await WaitForCameraRestAsync();
        AssertSameView(fitted, await CameraAsync());

        // F is ignored while typing in an input.
        await DragAsync(MouseButton.Left, dx: 60, dy: 0);
        var panned = await CameraAsync();
        await Page.GetByTestId("import-input").FocusAsync();
        await Page.Keyboard.PressAsync("f");
        await Page.WaitForTimeoutAsync(300);
        AssertSameView(panned, await CameraAsync());
    }

    [Fact]
    public async Task The_projection_toggle_keeps_the_framing()
    {
        var orthographic = await ImportAndRestAsync();
        Assert.Equal("orthographic", orthographic.Projection);

        await SetProjectionAsync("perspective");
        var perspective = await CameraAsync();
        Assert.Equal("perspective", perspective.Projection);
        Assert.Equal(orthographic.VisibleHeight, perspective.VisibleHeight, 6);
        AssertVector(orthographic.Target, perspective.Target);
        AssertAngle(orthographic.Azimuth, perspective.Azimuth);

        await SetProjectionAsync("orthographic");
        var back = await CameraAsync();
        Assert.Equal("orthographic", back.Projection);
        Assert.Equal(orthographic.VisibleHeight, back.VisibleHeight, 6);
        AssertNoConsoleErrors();
    }

    private async Task<CameraState> ImportAndRestAsync()
    {
        await ImportAsync("coloured-part.step");
        await WaitForImportsAsync(1);
        await Page.WaitForSelectorAsync("[data-testid=fit-all-button]:not([disabled])");
        await WaitForCameraRestAsync();
        return await CameraAsync();
    }

    /// <summary>A world point is drawn in the middle of the view.</summary>
    private async Task AssertAtCentreAsync(double[] point)
    {
        var centre = await ViewportCentreAsync();
        var drawn = await ProjectAsync(point[0], point[1], point[2]);
        Assert.True(Math.Abs(drawn.X - centre.X) < 1 && Math.Abs(drawn.Y - centre.Y) < 1, $"({drawn.X}, {drawn.Y}) should be the view's centre ({centre.X}, {centre.Y})");
    }

    private async Task<ScreenPoint> ViewportCentreAsync()
    {
        var box = (await Page.GetByTestId("viewport").BoundingBoxAsync())!;
        return new ScreenPoint(box.X + box.Width / 2, box.Y + box.Height / 2);
    }

    /// <summary>
    /// camera-controls applies at most one drag step per frame and drops what is left at pointer up,
    /// so the moves are a frame apart, as a real mouse's are (WebKit delivers Playwright's moves
    /// without frames in between).
    /// </summary>
    private async Task DragAsync(MouseButton button, double dx, double dy)
    {
        var start = await ViewportCentreAsync();
        await Page.Mouse.MoveAsync((float)start.X, (float)start.Y);
        await Page.Mouse.DownAsync(new MouseDownOptions { Button = button });
        for (var step = 1; step <= 10; step++)
        {
            await Page.Mouse.MoveAsync((float)(start.X + dx * step / 10), (float)(start.Y + dy * step / 10));
            await Page.EvaluateAsync("() => new Promise(requestAnimationFrame)");
        }

        await Page.Mouse.UpAsync(new MouseUpOptions { Button = button });
        await WaitForCameraRestAsync();
    }

    private async Task WheelAsync(float deltaY)
    {
        var before = (await CameraAsync()).VisibleHeight;
        var centre = await ViewportCentreAsync();
        await Page.Mouse.MoveAsync((float)centre.X, (float)centre.Y);
        await Page.Mouse.WheelAsync(0, deltaY);
        await WaitForWheelAsync(before);
    }

    /// <summary>
    /// Waits until the wheel has changed the view, then until the camera rests. The camera is at rest
    /// before the wheel, so waiting for rest alone could return before the browser handled it: CI's
    /// Firefox lost that race (M13), as it did with the projection toggle (M11).
    /// </summary>
    private async Task WaitForWheelAsync(double visibleHeightBefore)
    {
        await Page.WaitForFunctionAsync(
            "before => Math.abs(window.__j3dTest.camera().visibleHeight - before) > before * 1e-6",
            visibleHeightBefore);
        await WaitForCameraRestAsync();
    }

    private async Task ClickViewCubeAsync(string region)
    {
        await WaitForCameraRestAsync();
        var point = await ViewCubePointAsync(region);
        Assert.True(point is not null, $"the {region} region should face the viewer");
        await Page.Mouse.ClickAsync((float)point.X, (float)point.Y);
        await WaitForCameraRestAsync();
    }

    /// <summary>
    /// Synthetic touch: each finger is [startDx, startDy, endDx, endDy] from <paramref name="centre"/>.
    /// Playwright has no multi-touch, so pointer events with pointerType "touch" stand in for fingers.
    /// camera-controls applies one drag step per frame, so the moves are spread over frames, and
    /// only fingers that move send events.
    /// </summary>
    private async Task TouchAsync(ScreenPoint centre, double[][] fingers)
    {
        await Page.EvaluateAsync(
            """
            async ([cx, cy, fingers]) => {
              const canvas = document.querySelector('[data-testid=viewer-canvas]');
              const fire = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
                pointerId: 10 + id, pointerType: 'touch', isPrimary: id === 0, clientX: cx + x, clientY: cy + y,
                button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }));
              fingers.forEach(([x, y], id) => fire('pointerdown', id, x, y));
              for (let step = 1; step <= 10; step++) {
                await new Promise(requestAnimationFrame);
                fingers.forEach(([x0, y0, x1, y1], id) => {
                  if (x0 !== x1 || y0 !== y1) fire('pointermove', id, x0 + (x1 - x0) * step / 10, y0 + (y1 - y0) * step / 10);
                });
              }
              fingers.forEach(([, , x, y], id) => fire('pointerup', id, x, y));
            }
            """,
            new object[] { centre.X, centre.Y, fingers });
        await WaitForCameraRestAsync();
    }

    private static void AssertSameView(CameraState expected, CameraState actual)
    {
        AssertVector(expected.Target, actual.Target);
        AssertAngle(expected.Azimuth, actual.Azimuth);
        Assert.Equal(expected.Polar, actual.Polar, 6);
        Assert.Equal(expected.VisibleHeight, actual.VisibleHeight, 4);
        Assert.Equal(expected.Projection, actual.Projection);
    }

    private static void AssertVector(double[] expected, double[] actual)
    {
        Assert.True(Distance(expected, actual) < 1e-4, $"expected [{string.Join(", ", expected)}], got [{string.Join(", ", actual)}]");
    }

    private static void AssertAngle(double expected, double actual) =>
        Assert.True(Math.Abs(AngleBetween(expected, actual)) < 1e-6, $"expected an angle of {expected} (mod 2π), got {actual}");

    /// <summary>The difference between two angles, in [−π, π].</summary>
    private static double AngleBetween(double a, double b) => Math.IEEERemainder(a - b, 2 * Math.PI);

    private static double Distance(double[] a, double[] b) =>
        Math.Sqrt(a.Zip(b, static (x, y) => (x - y) * (x - y)).Sum());
}
