using Microsoft.AspNetCore.Mvc.Testing;

namespace J3D.Web.Tests;

public sealed class CrossOriginIsolationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Theory]
    [InlineData("/")]
    [InlineData("/app.css")]
    [InlineData("/viewer/j3d-viewer.js")]
    [InlineData("/_framework/blazor.web.js")]
    public async Task Responses_are_cross_origin_isolated(string path)
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri(path, UriKind.Relative), TestContext.Current.CancellationToken);

        response.EnsureSuccessStatusCode();
        Assert.Equal(CrossOriginIsolation.OpenerPolicy, Assert.Single(response.Headers.GetValues(CrossOriginIsolation.OpenerPolicyHeader)));
        Assert.Equal(CrossOriginIsolation.EmbedderPolicy, Assert.Single(response.Headers.GetValues(CrossOriginIsolation.EmbedderPolicyHeader)));
    }
}
