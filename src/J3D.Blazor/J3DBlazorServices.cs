using Microsoft.Extensions.DependencyInjection;

namespace J3D.Blazor;

/// <summary>Registers what the library needs.</summary>
public static class J3DBlazorServices
{
    extension(IServiceCollection services)
    {
        /// <summary>
        /// The services <see cref="J3DViewer"/> and a page's own UI share, one set per scope (D272). A host
        /// that prerenders registers them too.
        /// </summary>
        public IServiceCollection AddJ3DBlazor() => services
            .AddScoped<ViewerSession>()
            .AddScoped<SceneState>();
    }
}
