using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;

namespace J3D.Blazor.Tests;

/// <summary>bUnit context with the library's services registered.</summary>
public abstract class BunitTestBase : BunitContext
{
    protected BunitTestBase()
    {
        Services.AddJ3DBlazor();
        JSInterop.Mode = JSRuntimeMode.Loose;
    }

    protected ViewerSession Session => Services.GetRequiredService<ViewerSession>();

    /// <summary>Answers the viewer module's <c>createViewer</c>; calls on the returned viewer are recorded on it.</summary>
    protected BunitJSModuleInterop SetupViewerModule()
    {
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
