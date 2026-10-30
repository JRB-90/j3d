using J3D.Web.Client.Components;
using J3D.Blazor;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor;
using static J3D.Blazor.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// The Measure tool's UI and selection modes (M12, D146, D147, D162–D164): the toolbar's toggles, the
/// panel, the context menu and the Viewport's relays.
/// </summary>
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
    public async Task The_toolbar_switches_the_selection_mode()
    {
        await StartViewerAsync();
        var cut = Render<Toolbar>();
        cut.WaitForAssertion(() => Assert.Empty(cut.FindAll("[data-testid=selection-mode] [disabled]")));

        cut.Find("[data-testid=mode-model]").Click();
        Assert.Equal(SelectMode.Models, Scene.Mode);
        cut.Find("[data-testid=mode-feature]").Click();
        Assert.Equal(SelectMode.Features, Scene.Mode);
    }

    [Fact]
    public async Task The_panel_shows_the_reference_then_the_result_with_a_hint()
    {
        var cut = Render<SelectionPanel>();
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]"));

        await Act(() => Scene.ToggleMeasureMode());
        Assert.StartsWith("Pick a face, edge or vertex", cut.Find("[data-testid=measure-hint]").TextContent, StringComparison.Ordinal);

        await Act(() => Scene.SetMeasureReference(Measure("reference", "Edge (circle) of Pin", ("Diameter", "8.000 mm"))));
        Assert.Contains("Edge (circle) of Pin", cut.Find("[data-testid=measure-reference]").TextContent, StringComparison.Ordinal);
        Assert.Equal("8.000 mm", cut.Find("[data-testid=measure-reference] [data-testid=measure-value]").TextContent);
        Assert.StartsWith("Pick another", cut.Find("[data-testid=measure-hint]").TextContent, StringComparison.Ordinal);

        await Act(() => Scene.SetMeasureResult(Measure("result", "Distance 30.000 mm", ("Distance", "30.000 mm"))));
        await Act(() => Scene.SetMeasureResult(Measure("result", "Distance 35.000 mm", ("Distance", "35.000 mm"))));
        Assert.Equal("35.000 mm", cut.Find("[data-testid=measure-result] [data-testid=measure-value]").TextContent);
        Assert.Single(cut.FindAll("[data-testid=measure-result]"));

        await Act(() => Scene.Escape());
        Assert.Empty(cut.FindAll("[data-testid=selection-panel]"));
    }

    [Fact]
    public async Task The_panel_lists_features_newest_first_with_their_totals()
    {
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.SetSelectionMode(SelectMode.Features);
            Scene.SetFeatures(new FeatureSelection(
                [Measure("f1", "Edge (line) of Plate (top)", ("Length", "50.000 mm")), Measure("f2", "Edge (line) of Pin", ("Length", "40.000 mm"))],
                [new MeasureRow("Total length (2 edges)", "90.000 mm")]));
        });

        Assert.Equal(["Edge (line) of Pin", "Edge (line) of Plate (top)"], cut.FindAll("[data-testid=feature-title]").Select(static t => t.TextContent));
        // Only the newest is open, so the panel stays small.
        Assert.Equal(["40.000 mm"], cut.FindAll("[data-testid=feature] [data-testid=measure-value]").Select(static v => v.TextContent));
        cut.FindAll("[data-testid=feature-toggle]")[1].Click();
        Assert.Equal(["40.000 mm", "50.000 mm"], cut.FindAll("[data-testid=feature] [data-testid=measure-value]").Select(static v => v.TextContent));
        Assert.Equal("90.000 mm", cut.Find("[data-testid=feature-totals] [data-testid=measure-value]").TextContent);
    }

    [Fact]
    public async Task Feature_cards_are_numbered_in_the_order_they_were_picked()
    {
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.SetSelectionMode(SelectMode.Features);
            Scene.SetFeatures(new FeatureSelection(
                [Measure("f1", "Face (plane) of Plate (top)", ("Area", "2500.000 mm²")), Measure("f2", "Face (plane) of Plate (top)", ("Area", "250.000 mm²"))],
                []));
        });

        Assert.Equal(["2", "1"], cut.FindAll("[data-testid=feature] .j3d-card-number").Select(static n => n.TextContent));
    }

    [Fact]
    public async Task A_parts_rows_sit_under_its_name_and_long_numbers_are_grouped_for_reading()
    {
        await StartViewerAsync();
        JSInterop.SetupModule(ViewerInterop.ModulePath).SetupVoid("copyText", static _ => true).SetVoidResult();
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.ToggleMeasureMode();
            Scene.SetMeasureReference(new MeasureInfo(
                "",
                "Face (plane) of Plate (top)",
                "2500.000 mm²",
                [new MeasureRow("Area", "2500.000 mm²"), new MeasureRow("Volume", "12500.000 mm³", "Plate (top)"), new MeasureRow("Area", "6000.000 mm²", "Plate (top)")],
                [new MeasurePart(Id.Value, 1)],
                Approximate: false));
        });

        Assert.Equal(["Plate (top)"], cut.FindAll("[data-testid=measure-group]").Select(static g => g.TextContent));
        Assert.Equal(2, cut.FindAll(".j3d-measure-row--grouped").Count);
        Assert.Equal("12 500.000 mm³", cut.FindAll("[data-testid=measure-value]")[1].TextContent);

        cut.FindAll("[data-testid=measure-copy]")[1].Click();

        var copy = JSInterop.Invocations.Single(static i => i.Identifier == "copyText");
        Assert.Equal("12500.000 mm³", Assert.Single(copy.Arguments)); // copied as formatted, without the grouping
    }

    [Fact]
    public async Task Names_have_no_copy_button()
    {
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.ToggleMeasureMode();
            Scene.SetMeasureReference(Measure("reference", "Distance", ("Distance", "35.000 mm"), ("A", "Face of Plate (top)")));
        });

        Assert.Single(cut.FindAll("[data-testid=measure-copy]"));
    }

    [Fact]
    public async Task The_panel_names_a_selected_model_in_model_mode()
    {
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.SetSelectionMode(SelectMode.Models);
            Scene.Pick(Id, 1, additive: false);
        });

        Assert.Equal("bracket.step", cut.Find("[data-testid=selection-title]").TextContent);
        Assert.Equal("Whole model · 3 parts", cut.Find("[data-testid=selection-detail]").TextContent);
    }

    [Fact]
    public async Task A_copy_button_copies_its_value()
    {
        await StartViewerAsync();
        JSInterop.SetupModule(ViewerInterop.ModulePath).SetupVoid("copyText", static _ => true).SetVoidResult();
        var cut = Render<SelectionPanel>();
        await Act(() =>
        {
            Scene.ToggleMeasureMode();
            Scene.SetMeasureReference(Measure("reference", "Face (plane) of Plate (top)", ("Area", "2500.000 mm²")));
        });

        cut.Find("[data-testid=measure-copy]").Click();

        var copy = JSInterop.Invocations.Single(static i => i.Identifier == "copyText");
        Assert.Equal("2500.000 mm²", Assert.Single(copy.Arguments));
    }

    [Fact]
    public async Task The_context_menu_offers_the_selections_or_the_scenes_commands()
    {
        await StartViewerAsync();
        var popovers = Render<MudPopoverProvider>();
        Render<ContextMenu>();

        await Act(() => Scene.OpenContextMenu(Id, 3, 100, 100, canMeasure: true));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-hide]")));
        Assert.NotEmpty(popovers.FindAll("[data-testid=context-measure]"));
        Assert.Empty(popovers.FindAll("[data-testid=context-show-all]"));
        popovers.Find("[data-testid=context-hide]").Click();
        // A menu item's handler runs as the menu closes, so its effect is waited for.
        popovers.WaitForAssertion(() => Assert.Equal([3], Scene.Find(Id)!.Hidden.Order()));

        await Act(() => Scene.OpenContextMenu(null, -1, 100, 100, canMeasure: false));
        popovers.WaitForAssertion(() => Assert.NotEmpty(popovers.FindAll("[data-testid=context-show-all]")));
        Assert.Empty(popovers.FindAll("[data-testid=context-measure]"));
        popovers.Find("[data-testid=context-show-all]").Click();
        popovers.WaitForAssertion(() => Assert.True(Scene.Find(Id)!.Hidden.IsEmpty));
    }

    [Fact]
    public async Task The_viewport_relays_the_tool_the_mode_features_and_right_clicks()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer.SetupVoid("setPartState", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setMeasureMode", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setSelectionMode", static _ => true).SetVoidResult();
        _viewer.SetupVoid("clearFeatures").SetVoidResult();
        _viewer.SetupVoid("setModelOrder", static _ => true).SetVoidResult();
        _viewer.SetupVoid("dispose").SetVoidResult();
        var menus = new List<ContextMenuTarget>();
        Scene.ContextMenuRequested += menus.Add;
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("measure"));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnMeasureReference(Measure("reference", "Vertex of Pin", ("Point", "(0.000, 0.000, 0.000)"))));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnMeasureResult(Measure("result", "Distance 30.000 mm", ("Distance", "30.000 mm"))));
        Assert.Equal(["Vertex of Pin", "Distance 30.000 mm"], [Scene.MeasureReference?.Title, Scene.MeasureResult?.Title]);
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("clearSelection")); // Esc ends the measurement
        await cut.InvokeAsync(() => Scene.MeasureFromHere());

        var measureModes = _viewer.Invocations.Where(static i => i.Identifier == "setMeasureMode").Select(static i => ((bool)i.Arguments[0]!, (bool)i.Arguments[1]!));
        Assert.Equal([(true, false), (false, false), (true, true)], measureModes);

        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("selectFeatures"));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnFeaturesSelected(new FeatureSelection([Measure("f1", "Face of Pin", ("Area", "1.000 mm²"))], [])));
        Assert.Single(Scene.Features.Features);
        await cut.InvokeAsync(() => Scene.SetMeasureMode(false));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("clearSelection"));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("selectModels"));
        Assert.Equal([SelectMode.Features, SelectMode.Models], _viewer.Invocations.Where(static i => i.Identifier == "setSelectionMode").Select(static i => (SelectMode)i.Arguments[0]!));
        Assert.Single(_viewer.Invocations, static i => i.Identifier == "clearFeatures");

        await cut.InvokeAsync(() => CallbacksOf(cut).OnContextMenu(Id.Value, 4, 12, 34, canMeasure: true));
        Assert.Equal([new ContextMenuTarget(12, 34, true, true)], menus);
        Assert.Equal([1, 3, 4], Scene.Find(Id)!.Selected.Order()); // Model mode: the whole bracket
    }

    [Fact]
    public async Task An_undone_feature_selection_goes_back_to_the_viewer_after_its_mode()
    {
        JSInterop.Mode = JSRuntimeMode.Strict;
        _viewer.SetupVoid("setPartState", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setSelectionMode", static _ => true).SetVoidResult();
        _viewer.SetupVoid("restoreFeatures", static _ => true).SetVoidResult();
        _viewer.SetupVoid("setModelOrder", static _ => true).SetVoidResult();
        _viewer.SetupVoid("dispose").SetVoidResult();
        var cut = Render<Viewport>();

        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("selectFeatures"));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnFeaturesSelected(new FeatureSelection([Measure("f1", "Face of Pin", ("Area", "1.000 mm²"))], [], "[1]", ByUser: true)));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("selectObjects"));
        await cut.InvokeAsync(() => CallbacksOf(cut).OnViewerCommand("undo"));

        cut.WaitForAssertion(() => Assert.Single(_viewer.Invocations, static i => i.Identifier == "restoreFeatures"));
        Assert.Equal("[1]", _viewer.Invocations.Single(static i => i.Identifier == "restoreFeatures").Arguments[0]);
        var calls = _viewer.Invocations.Select(static i => i.Identifier).ToList();
        Assert.True(calls.LastIndexOf("setSelectionMode") < calls.IndexOf("restoreFeatures")); // Feature mode first, which clears them
        Assert.Equal(SelectMode.Features, Scene.Mode);
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
