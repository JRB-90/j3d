using Microsoft.AspNetCore.Mvc.Testing;

namespace J3D.E2E.Tests;

/// <summary>Runs the real J3D host on Kestrel (a random loopback port) so a browser can reach it.</summary>
public sealed class J3DAppFixture : IAsyncLifetime
{
    private readonly WebApplicationFactory<Program> _factory = new();

    public Uri BaseAddress { get; private set; } = null!;

    public ValueTask InitializeAsync()
    {
        _factory.UseKestrel(port: 0);
        _factory.StartServer();
        BaseAddress = _factory.ClientOptions.BaseAddress;
        return ValueTask.CompletedTask;
    }

    public ValueTask DisposeAsync() => _factory.DisposeAsync();
}
