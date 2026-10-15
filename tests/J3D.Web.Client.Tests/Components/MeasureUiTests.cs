using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.Extensions.DependencyInjection;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>The Measure tool's UI (M7, D79, D87, D101): the toolbar toggle, the panel and the Viewport's relays.</summary>
public sealed class MeasureUiTests : BunitTestBase
{
    private static readonly ModelId Id = new("m1");
    private readonly BunitJSModuleInterop _viewer;

    public MeasureUiTests()
    {
        _viewer = SetupViewerModule();
        _viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        Scene.Add(Summary(Id.Value, "bracket.step"));
        Scene.MarkLoaded(Id, Info());
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    [Fact]
    public async Task The_toolbar_button_toggles_the_tool_and_shows_it_is_on()
    {
        await StartViewerAsync();
        var cut = Render<Toolbar>();
        var button = () => cut.Find("[data-testid=measure-button]");
        cut.WaitForAssertion(() => Assert.False(button().HasAttribute("disabled")));
        Assert.Equal("false", button().GetAttribute("aria-pressed"));

        button().Click();

        Assert.True(Scene.MeasureMode);
        Assert.Equal("true", button().GetAttribute("aria-pressed"));
    }

    [Fact]
    public async Task The_panel_hints_shows_the_pending_pick_and_lists_kept_measurements()
    {
        var cut = Render<SelectionPanel>();
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]"));

        await Act(() => Scene.ToggleMeasureMode());
        Assert.Equal("Pick a face, edge or vertex.", cut.Find("[data-testid=measure-hint]").TextContent);

        await Act(() => Scene.SetPendingMeasure(Measure("", "Face (plane) of Plate (top)", ("Area", "2500.000 mm²"))));
        Assert.Contains("Face (plane) of Plate (top)", cut.Find("[data-testid=measure-pending]").TextContent, StringComparison.Ordinal);
        Assert.Equal("2500.000 mm²", cut.Find("[data-testid=measure-pending] [data-testid=measure-value]").TextContent);
        Assert.StartsWith("Pick a second", cut.Find("[data-testid=measure-hint]").TextContent, StringComparison.Ordinal);

        await Act(() =>
        {
            Scene.SetPendingMeasure(null);
            Scene.AddMeasurement(Measure("m1", "Distance 30.000 mm", ("Distance", "30.000 mm")));
            Scene.AddMeasurement(Measure("m2", "Angle 90.00°", ("Angle (planes)", "90.00°")));
        });
        var titles = cut.FindAll("[data-testid=measurement-title]").Select(static t => t.TextContent.Trim()).ToList();
        Assert.Equal(["Angle 90.00°", "Distance 30.000 mm"], titles); // newest first
        Assert.Equal(["90.00°", "30.000 mm"], cut.FindAll("[data-testid=measurement] [data-testid=measure-value]").Select(static v => v.TextContent));
    }

    [Fact]
    public async Task Hidden_parts_grey_their_measurements_and_the_buttons_remove_and_clear()
    {
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.AddMeasurement(Measure("m1", "Distance 30.000 mm", ("Distance", "30.000 mm")));
            Scene.AddMeasurement(Measure("m2", "Distance 5.000 mm", ("Distance", "5.000 mm")));
        });

        await Act(() => Scene.ToggleNodeVisibility(Id, 1));
        Assert.All(cut.FindAll("[data-testid=measurement]"), card => Assert.Equal("false", card.GetAttribute("data-shown")));
        Assert.Contains("(hidden)", cut.Find("[data-testid=measurement-title]").TextContent, StringComparison.Ordinal);

        cut.Find("[data-testid=measurement-remove]").Click(); // the newest
        Assert.Equal(["m1"], Scene.Measurements.Select(static m => m.Id));

        cut.Find("[data-testid=measure-clear]").Click();
        Assert.Empty(Scene.Measurements);
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]"));
    }

    [Fact]
    public async Task A_copy_button_copies_its_value()
    {
        await StartViewerAsync();
        JSInterop.SetupModule(ViewerInterop.ModulePath).SetupVoid("copyText", static _ => true).SetVoidResult();
        var cut = Render<SelectionPanel>();
        await Act(() => Scene.AddMeasurement(Measure("m1", "Distance 30.000 mm", ("Distance", "30.000 mm"))));

        cut.Find("[data-testid=measure-copy]").Click();

        var copy = JSInterop.Invocations.Single(static i => i.Identifier == "copyText");
        Assert.Equal("30.000 mm", Assert.Single(copy.Arguments));
    }

    [Fact]
    public async Task The_viewport_relays_measurements_and_applies_the_mode_and_what_is_shown()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer.SetupVoid("setPartState", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setMeasureMode", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setMeasurements", static _ => true).SetVoidResult();
        _viewer.SetupVoid("dispose").SetVoidResult();
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("measure"));
        await cut.InvokeAsync(() => cut.Instance.OnMeasurePending(Measure("", "Vertex of Pin", ("Point", "(0.000, 0.000, 0.000)"))));
        Assert.Equal("Vertex of Pin", Scene.PendingMeasure?.Title);
        await cut.InvokeAsync(() => cut.Instance.OnMeasured(Measure("m1", "Distance 30.000 mm", ("Distance", "30.000 mm"))));
        await cut.InvokeAsync(() => cut.Instance.OnViewerCommand("measure"));

        Assert.Equal([true, false], _viewer.Invocations.Where(static i => i.Identifier == "setMeasureMode").Select(static i => (bool)i.Arguments[0]!));
        var shown = _viewer.Invocations.Where(static i => i.Identifier == "setMeasurements").Select(static i => string.Join(',', (string[])i.Arguments[0]!));
        Assert.Equal(["m1"], shown);
    }

    private Task Act(Action action) => Renderer.Dispatcher.InvokeAsync(action);

    private static MeasureInfo Measure(string id, string title, params (string Name, string Value)[] rows) => new(
        id,
        title,
        rows[0].Value,
        [.. rows.Select(static row => new MeasureRow(row.Name, row.Value))],
        [new MeasurePart(Id.Value, 1)],
        Approximate: false);
}
