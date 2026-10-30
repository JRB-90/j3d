using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using J3D.Web.Client.Components;

namespace J3D.Web.Client.Tests.Components;

/// <summary>
/// Keeps the About dialog's list, THIRD-PARTY-NOTICES.md and the dependencies in step (decision D66):
/// a new or upgraded runtime dependency fails here until both lists say so.
/// </summary>
public sealed partial class ThirdPartyNoticesTests
{
    private static readonly string Repo = FindRepo();

    /// <summary>Runtime dependencies that ship to the browser, by package, and the component each one is.</summary>
    private static readonly Dictionary<string, string> NpmComponents = new()
    {
        ["three"] = "three.js",
        ["camera-controls"] = "camera-controls",
        ["@j3d/occt"] = "Open CASCADE Technology (OCCT)",
    };

    private static readonly Dictionary<string, string> NuGetComponents = new()
    {
        ["MudBlazor"] = "MudBlazor",
        ["Microsoft.AspNetCore.Components.WebAssembly"] = ".NET runtime for WebAssembly and ASP.NET Core Blazor",
    };

    [Fact]
    public void The_notices_table_lists_exactly_what_the_About_dialog_does()
    {
        var notices = File.ReadAllText(Path.Combine(Repo, "THIRD-PARTY-NOTICES.md"));
        var section = notices[notices.IndexOf("## Components", StringComparison.Ordinal)..];
        var rows = section.Split('\n')
            .Select(static line => line.Trim())
            .Where(static line => line.StartsWith("| [", StringComparison.Ordinal))
            .Select(static line => line.Trim('|').Split(" | "))
            .Select(static cells => new ThirdPartyComponent(
                MarkdownLink().Replace(cells[0], "$1").Trim(),
                cells[1].Trim(),
                cells[2].Trim(),
                MarkdownLink().Match(cells[0]).Groups[2].Value));

        Assert.Equal(ThirdParty.Components, rows);
    }

    [Fact]
    public void Every_runtime_dependency_is_listed_with_the_version_that_ships()
    {
        // The viewer's own dependencies, and the app's for the three.js the viewer leaves to it (D255).
        var viewer = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "src", "J3D.Viewer", "package.json")));
        var scripts = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "src", "J3D.Web.Client", "scripts", "package.json")));
        var npm = viewer.RootElement.GetProperty("dependencies").EnumerateObject()
            .Concat(scripts.RootElement.GetProperty("dependencies").EnumerateObject())
            .Where(static dependency => dependency.Name != "@j3d/viewer");
        foreach (var dependency in npm)
        {
            Assert.True(NpmComponents.TryGetValue(dependency.Name, out var name), $"npm dependency {dependency.Name} isn't in ThirdParty or THIRD-PARTY-NOTICES.md");
            if (dependency.Name != "@j3d/occt")
            {
                Assert.Equal(dependency.Value.GetString(), Component(name).Version);
            }
        }

        var versions = XDocument.Load(Path.Combine(Repo, "Directory.Packages.props")).Descendants("PackageVersion")
            .ToDictionary(static p => (string)p.Attribute("Include")!, static p => (string)p.Attribute("Version")!);
        var client = XDocument.Load(Path.Combine(Repo, "src", "J3D.Web.Client", "J3D.Web.Client.csproj"));
        foreach (var package in client.Descendants("PackageReference").Select(static p => (string)p.Attribute("Include")!))
        {
            Assert.True(NuGetComponents.TryGetValue(package, out var name), $"NuGet package {package} isn't in ThirdParty or THIRD-PARTY-NOTICES.md");
            Assert.Equal(versions[package], Component(name).Version);
        }

        // OCCT and Emscripten versions come from the committed build's provenance.
        var provenance = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "src", "J3D.Occt", "dist", "j3d_occt_single.provenance.json"))).RootElement;
        var occt = provenance.GetProperty("source").GetProperty("pinnedDeps").GetProperty("occt").GetProperty("version").GetString();
        Assert.Equal(occt, $"V{Component("Open CASCADE Technology (OCCT)").Version.Replace('.', '_')}");
        Assert.Equal(provenance.GetProperty("toolchain").GetProperty("emscripten").GetString(), Component("Emscripten runtime and JS glue").Version);
    }

    private static ThirdPartyComponent Component(string name) => ThirdParty.Components.Single(c => c.Name == name);

    private static string FindRepo()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "J3D.slnx")))
            {
                return dir.FullName;
            }
        }
        throw new InvalidOperationException("Can't find the repository root (J3D.slnx) above the test's output folder.");
    }

    [GeneratedRegex(@"\[([^\]]+)\]\(([^)]+)\)")]
    private static partial Regex MarkdownLink();
}
