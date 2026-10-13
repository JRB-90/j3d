using J3D.Web.Client.Layout;
using Microsoft.AspNetCore.Components;

namespace J3D.Web.Client.Tests.Layout;

public sealed class MainLayoutTests : BunitTestBase
{
    [Fact]
    public void Renders_app_bar_model_list_and_body()
    {
        var cut = Render<MainLayout>(parameters => parameters
            .Add(layout => layout.Body, (RenderFragment)(builder => builder.AddContent(0, "viewport-placeholder"))));

        Assert.Contains("J3D", cut.Find(".j3d-appbar").TextContent, StringComparison.Ordinal);
        Assert.Contains("No models imported.", cut.Find(".j3d-drawer").TextContent, StringComparison.Ordinal);
        Assert.Contains("viewport-placeholder", cut.Find(".j3d-main").TextContent, StringComparison.Ordinal);
    }
}
