using System.Diagnostics;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace J3D.E2E.Tests;

/// <summary>
/// Runs the real J3D host on a random loopback port so a browser can reach it. By default it runs in
/// process on Kestrel. When <c>J3D_E2E_APP</c> names a published app's folder, that app runs as its
/// own process instead, so the tests exercise the trimmed code that ships (decision D65); CI does
/// this. Either way the app runs in Development, which renders the test hook.
/// </summary>
public sealed partial class J3DAppFixture : IAsyncLifetime
{
    private WebApplicationFactory<Program>? _factory;
    private Process? _published;

    public Uri BaseAddress { get; private set; } = null!;

    public async ValueTask InitializeAsync()
    {
        var publishedApp = Environment.GetEnvironmentVariable("J3D_E2E_APP");
        if (string.IsNullOrEmpty(publishedApp))
        {
            _factory = new();
            _factory.UseKestrel(port: 0);
            _factory.StartServer();
            BaseAddress = _factory.ClientOptions.BaseAddress;
        }
        else
        {
            (_published, BaseAddress) = await StartPublishedAsync(Path.GetFullPath(publishedApp));
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_factory is not null)
        {
            await _factory.DisposeAsync();
        }
        if (_published is not null)
        {
            _published.Kill(entireProcessTree: true);
            await _published.WaitForExitAsync();
            _published.Dispose();
        }
    }

    private static async Task<(Process Process, Uri BaseAddress)> StartPublishedAsync(string folder)
    {
        var app = Path.Combine(folder, "J3D.Web.dll");
        if (!File.Exists(app))
        {
            throw new InvalidOperationException($"J3D_E2E_APP is set, but {folder} has no published J3D.Web.dll.");
        }
        var start = new ProcessStartInfo("dotnet")
        {
            WorkingDirectory = folder,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(app);
        start.ArgumentList.Add("--urls");
        start.ArgumentList.Add("http://127.0.0.1:0");
        start.Environment["ASPNETCORE_ENVIRONMENT"] = "Development";

        var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        var listening = new TaskCompletionSource<Uri>(TaskCreationOptions.RunContinuationsAsynchronously);
        var output = new List<string>();
        void Collect(string? line)
        {
            if (line is null)
            {
                return;
            }
            lock (output)
            {
                output.Add(line);
            }
            if (ListeningOn().Match(line) is { Success: true } match)
            {
                listening.TrySetResult(new Uri($"{match.Groups[1].Value}/"));
            }
        }
        process.OutputDataReceived += (_, e) => Collect(e.Data);
        process.ErrorDataReceived += (_, e) => Collect(e.Data);
        process.Exited += (_, _) => listening.TrySetException(
            new InvalidOperationException($"The published app exited with {process.ExitCode}:\n{string.Join('\n', output)}"));

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        try
        {
            return (process, await listening.Task.WaitAsync(TimeSpan.FromSeconds(60)));
        }
        catch
        {
            process.Kill(entireProcessTree: true);
            process.Dispose();
            throw;
        }
    }

    [GeneratedRegex(@"Now listening on: (http://\S+)")]
    private static partial Regex ListeningOn();
}
