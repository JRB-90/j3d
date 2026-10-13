using MudBlazor.Services;

namespace J3D.Web.Client.Tests;

/// <summary>bUnit context with MudBlazor registered. MudBlazor's own JS calls are answered loosely.</summary>
public abstract class BunitTestBase : BunitContext
{
    protected BunitTestBase()
    {
        Services.AddMudServices();
        JSInterop.Mode = JSRuntimeMode.Loose;
    }
}
