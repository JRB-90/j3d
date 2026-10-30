using J3D.Blazor;
using J3D.Web.Client.Components;
using J3D.Web.Client.Interop;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;

namespace J3D.Web.Client.Tests;

/// <summary>
/// bUnit context with the client's services registered (MudBlazor and the viewer session).
/// MudBlazor's own JS calls are answered loosely.
/// </summary>
public abstract class BunitTestBase : BunitContext
{
    protected BunitTestBase()
    {
        Services.AddJ3DClient();
        JSInterop.Mode = JSRuntimeMode.Loose;
    }

    protected ViewerSession Session => Services.GetRequiredService<ViewerSession>();

    /// <summary>What <c>installPage</c> returned.</summary>
    protected BunitJSModuleInterop? Page { get; private set; }

    /// <summary>What the viewer calls back, in the <see cref="J3DViewer"/> a <see cref="Viewport"/> holds.</summary>
    internal static ViewerCallbacks CallbacksOf(IRenderedComponent<Viewport> viewport) => viewport.FindComponent<J3DViewer>().Instance.Callbacks;

    /// <summary>
    /// Answers the viewer module's <c>createViewer</c>; calls on the returned viewer are recorded on it.
    /// Answers the app module's <c>installPage</c> too, which a <see cref="Viewport"/> calls.
    /// </summary>
    protected BunitJSModuleInterop SetupViewerModule()
    {
        Page = JSInterop.SetupModule(AppScripts.ModulePath).SetupModule(static invocation => invocation.Identifier == "installPage");
        Page.SetupVoid("dispose").SetVoidResult();
        var module = JSInterop.SetupModule(ViewerInterop.ModulePath);
        return module.SetupModule(static invocation => invocation.Identifier == "createViewer");
    }

    /// <summary>Starts a viewer through the interop wrapper and hands it to the session, as <see cref="J3DViewer"/> does.</summary>
    internal async Task<ViewerInterop> StartViewerAsync(bool webGl2 = true)
    {
        using var callbacks = DotNetObjectReference.Create(new object());
        var viewer = await ViewerInterop.CreateAsync(JSInterop.JSRuntime, default, callbacks, new ViewerOptions(ViewerKeys.Off, null, null, true, true, true, true));
        await Renderer.Dispatcher.InvokeAsync(() => Session.Attach(viewer, new ViewerCapabilities(webGl2, CrossOriginIsolated: true)));
        return viewer;
    }
}
