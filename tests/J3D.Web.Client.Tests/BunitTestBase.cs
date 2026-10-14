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

    /// <summary>Answers the viewer module's <c>createViewer</c>; calls on the returned viewer are recorded on it.</summary>
    protected BunitJSModuleInterop SetupViewerModule()
    {
        var module = JSInterop.SetupModule(ViewerInterop.ModulePath);
        return module.SetupModule(static invocation => invocation.Identifier == "createViewer");
    }

    /// <summary>Starts a viewer through the interop wrapper and hands it to the session, as the Viewport does.</summary>
    protected async Task<ViewerInterop> StartViewerAsync(bool webGl2 = true)
    {
        using var callbacks = DotNetObjectReference.Create(new object());
        var viewer = await ViewerInterop.CreateAsync(JSInterop.JSRuntime, default, callbacks);
        await Renderer.Dispatcher.InvokeAsync(() => Session.Attach(viewer, new ViewerCapabilities(webGl2, CrossOriginIsolated: true)));
        return viewer;
    }
}
