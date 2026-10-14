using J3D.Web.Client.Interop;
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
            .AddMudServices()
            .AddScoped<ViewerSession>();
    }
}
