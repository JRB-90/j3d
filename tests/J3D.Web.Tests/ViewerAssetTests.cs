using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace J3D.Web.Tests;

public sealed class ViewerAssetTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string TestHookMeta = "<meta name=\"j3d-test-hook\"";

    [Fact]
    public async Task Development_pages_enable_the_viewer_test_hook()
    {
        using var client = factory.CreateClient();

        var html = await client.GetStringAsync(new Uri("/", UriKind.Relative), TestContext.Current.CancellationToken);

        Assert.Contains(TestHookMeta, html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Production_pages_do_not_enable_the_viewer_test_hook()
    {
        using var client = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Production")).CreateClient();

        var html = await client.GetStringAsync(new Uri("/", UriKind.Relative), TestContext.Current.CancellationToken);

        Assert.DoesNotContain(TestHookMeta, html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Occt_webassembly_is_served_as_application_wasm()
    {
        // The Vite build fingerprints the file name, so find it in the library's build output.
        var assets = Path.Combine(RepoRoot(), "src", "J3D.Blazor", "wwwroot", "viewer", "assets");
        var wasm = Path.GetFileName(Assert.Single(Directory.GetFiles(assets, "j3d_occt_single-*.wasm")));
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri($"/_content/J3D.Blazor/viewer/assets/{wasm}", UriKind.Relative), TestContext.Current.CancellationToken);

        response.EnsureSuccessStatusCode();
        // WebAssembly.compileStreaming rejects any other MIME type.
        Assert.Equal("application/wasm", response.Content.Headers.ContentType?.MediaType);
    }

    private static string RepoRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "J3D.slnx")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Couldn't find the repository root (J3D.slnx) above the test output.");
    }
}
