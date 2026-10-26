using J3D.Web.Client.Components;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using static J3D.Web.Client.Tests.TestModels;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// M16's tree (D198, D202): an ARIA tree with one tab stop and arrow keys, whose rows render again only
/// when their own state changes. The model is the bracket of <see cref="TestModels.Info"/>: Bracket (0) ›
/// Plate (bottom) (1) and Top (2) › Plate (top) (3) and an unnamed part (4).
/// </summary>
public sealed class ModelTreeViewTests : BunitTestBase
{
    private static readonly ModelId Id = new("m1");

    public ModelTreeViewTests()
    {
        var viewer = SetupViewerModule();
        viewer.SetupVoid("attachFileInput", static _ => true).SetVoidResult();
        viewer.SetupVoid("revealTreeRow", static _ => true).SetVoidResult();
        Scene.Add(Summary(Id.Value, "bracket.step"));
        Scene.MarkLoaded(Id, Info());
    }

    private SceneState Scene => Services.GetRequiredService<SceneState>();

    [Fact]
    public async Task Arrow_keys_move_the_tab_stop_open_and_close_rows_and_Enter_selects()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        cut.Find("[data-testid=model-tree-toggle]").Click();
        Assert.Equal("Bracket", TabStop(cut));

        Key(cut, "Bracket", "ArrowRight"); // opens it
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Top"], Names(cut)));
        Assert.Equal("Bracket", TabStop(cut));
        Key(cut, "Bracket", "ArrowRight"); // then goes to its first child
        cut.WaitForAssertion(() => Assert.Equal("Plate (bottom)", TabStop(cut)));
        var reveal = JSInterop.Invocations.Last(static i => i.Identifier == "revealTreeRow");
        Assert.Equal([1, 26, "[data-tree-node=\"m1:1\"]", true], reveal.Arguments.Skip(1)); // the row is scrolled to and focused

        Key(cut, "Plate (bottom)", "ArrowDown");
        cut.WaitForAssertion(() => Assert.Equal("Top", TabStop(cut)));
        Key(cut, "Top", "ArrowRight");
        Key(cut, "Top", "End");
        cut.WaitForAssertion(() => Assert.Equal("(unnamed)", TabStop(cut)));
        Key(cut, "(unnamed)", "ArrowLeft"); // to its parent
        cut.WaitForAssertion(() => Assert.Equal("Top", TabStop(cut)));
        Key(cut, "Top", "ArrowLeft"); // closes it
        cut.WaitForAssertion(() => Assert.Equal(["Bracket", "Plate (bottom)", "Top"], Names(cut)));
        Key(cut, "Top", "Home");
        cut.WaitForAssertion(() => Assert.Equal("Bracket", TabStop(cut)));
        Key(cut, "Bracket", "ArrowUp"); // stays at the top
        Assert.Equal("Bracket", TabStop(cut));

        Key(cut, "Plate (bottom)", "Enter");
        Assert.Equal([1], Scene.Find(Id)!.Selected);
        Key(cut, "Top", " ", ctrl: true); // Space selects too, and Ctrl adds
        Assert.Equal([1, 3, 4], Scene.Find(Id)!.Selected.Order());
        cut.WaitForAssertion(() => Assert.Equal("true", Row(cut, "Bracket").GetAttribute("aria-selected")));
    }

    [Fact]
    public async Task A_row_renders_again_only_when_its_own_state_changes()
    {
        await StartViewerAsync();
        var cut = Render<ModelList>();
        await Act(() => Scene.Pick(Id, 4, additive: false)); // opens the tree down to the unnamed part
        await Act(() => Scene.ClearSelection());
        cut.WaitForAssertion(() => Assert.Equal(5, cut.FindComponents<ModelTreeRow>().Count));
        var before = Counts(cut);

        // Nothing a row shows changes.
        await Act(() => Scene.ToggleOriginFrames());
        Assert.Equal(before, Counts(cut));

        // Selecting Plate (top) changes its row only: Top and Bracket aren't wholly selected.
        await Act(() => Scene.Pick(Id, 3, additive: false));
        var after = Counts(cut);
        Assert.Equal(["Plate (top)"], before.Keys.Where(name => after[name] != before[name]));
    }

    private Task Act(Action action) => Renderer.Dispatcher.InvokeAsync(action);

    private static Dictionary<string, int> Counts(IRenderedComponent<ModelList> cut) =>
        cut.FindComponents<ModelTreeRow>().ToDictionary(static row => row.Instance.State.Text, static row => row.RenderCount);

    private static List<string> Names(IRenderedComponent<ModelList> cut) =>
        [.. cut.FindAll("[data-testid=model-tree-node] .j3d-tree-node-name").Select(static node => node.TextContent.Trim())];

    private static AngleSharp.Dom.IElement Row(IRenderedComponent<ModelList> cut, string name) =>
        cut.FindAll("[data-testid=model-tree-node]").Single(row => row.QuerySelector(".j3d-tree-node-name")?.TextContent.Trim() == name);

    private static string TabStop(IRenderedComponent<ModelList> cut) =>
        cut.Find("[data-testid=model-tree-node][tabindex=\"0\"] .j3d-tree-node-name").TextContent.Trim();

    private static void Key(IRenderedComponent<ModelList> cut, string row, string key, bool ctrl = false) =>
        Row(cut, row).KeyDown(new KeyboardEventArgs { Key = key, CtrlKey = ctrl });
}
