using J3D.Web.Client.Interop;
using J3D.Web.Client.State;
using MudBlazor;
using MudBlazor.Services;

namespace J3D.Web.Client;

public static class ClientServices
{
    extension(IServiceCollection services)
    {
        /// <summary>
        /// Services the client's components inject. The host registers them too, because it
        /// prerenders those components.
        /// </summary>
        public IServiceCollection AddJ3DClient() => services
            .AddMudServices(options =>
            {
                // Bottom right keeps snackbars clear of the view cube and the model list.
                options.SnackbarConfiguration.PositionClass = Defaults.Classes.Position.BottomRight;
                options.SnackbarConfiguration.VisibleStateDuration = 6000;
            })
            .AddScoped<ViewerSession>()
            .AddScoped<SceneState>();
    }
}
