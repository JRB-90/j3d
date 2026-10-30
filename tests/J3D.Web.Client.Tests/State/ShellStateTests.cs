using J3D.Web.Client.Interop;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Tests.State;

/// <summary>
/// M19's layout state (D234, D238, D239): the drawer beside the view in the desktop layout, and over it in
/// the compact one, closed at start and after a tap on a tree row unless more are being added.
/// </summary>
public sealed class ShellStateTests : BunitTestBase
{
    private readonly ShellState _shell = new();

    [Fact]
    public void Starts_as_a_desktop_with_a_mouse_and_the_drawer_open()
    {
        Assert.False(_shell.IsCompact);
        Assert.False(_shell.IsTouch);
        Assert.True(_shell.DesktopDrawerOpen);
        Assert.False(_shell.CompactDrawerOpen);

        _shell.ToggleDrawer();

        Assert.False(_shell.DesktopDrawerOpen);
        Assert.False(_shell.CompactDrawerOpen);
    }

    [Fact]
    public void In_the_compact_layout_the_drawer_starts_closed_and_a_pick_closes_it()
    {
        var changes = 0;
        _shell.Changed += () => changes++;

        _shell.OnLayoutChanged(compact: true, touch: true);

        Assert.True(_shell.IsCompact);
        Assert.True(_shell.IsTouch);
        Assert.False(_shell.CompactDrawerOpen);
        Assert.Equal(1, changes);

        _shell.ToggleDrawer();
        Assert.True(_shell.CompactDrawerOpen);
        Assert.True(_shell.DesktopDrawerOpen); // the desktop's drawer is left as it was

        _shell.Picked(adding: true);
        Assert.True(_shell.CompactDrawerOpen); // more to add (D237)

        _shell.Picked(adding: false);
        Assert.False(_shell.CompactDrawerOpen);
    }

    [Fact]
    public void A_swipe_or_the_backdrop_closes_the_drawer_and_a_pick_on_a_desktop_leaves_it()
    {
        _shell.OnLayoutChanged(compact: true, touch: true);
        _shell.ToggleDrawer();
        _shell.OnDrawerSwiped();
        Assert.False(_shell.CompactDrawerOpen);

        _shell.ToggleDrawer();
        _shell.CloseDrawer();
        Assert.False(_shell.CompactDrawerOpen);

        _shell.OnLayoutChanged(compact: false, touch: true);
        _shell.Picked(adding: false);
        Assert.True(_shell.DesktopDrawerOpen);
    }

    [Fact]
    public void Leaving_the_compact_layout_and_coming_back_starts_its_drawer_closed()
    {
        _shell.OnLayoutChanged(compact: true, touch: false);
        _shell.ToggleDrawer();

        _shell.OnLayoutChanged(compact: false, touch: false);
        _shell.OnLayoutChanged(compact: true, touch: false);

        Assert.False(_shell.CompactDrawerOpen);
    }

    [Fact]
    public async Task Follows_the_page_through_the_viewer_module()
    {
        var module = JSInterop.SetupModule(AppScripts.ModulePath);
        module.SetupModule(static invocation => invocation.Identifier == "watchLayout");

        await _shell.StartAsync(JSInterop.JSRuntime);
        await _shell.StartAsync(JSInterop.JSRuntime); // once

        Assert.Single(module.Invocations, static i => i.Identifier == "watchLayout");
        await _shell.DisposeAsync();
    }
}
