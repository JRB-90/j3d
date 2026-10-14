namespace J3D.Web.Client.Components;

/// <summary>A third-party component that ships to the browser.</summary>
/// <param name="Name">What it is, as THIRD-PARTY-NOTICES.md names it.</param>
/// <param name="Version">The version that ships, or where it comes from when it's bundled in another.</param>
/// <param name="Licence">Its licence, in words.</param>
/// <param name="Url">Its project page.</param>
public sealed record ThirdPartyComponent(string Name, string Version, string Licence, string Url);

/// <summary>
/// Everything third-party the browser app ships, as listed by the About dialog and by
/// THIRD-PARTY-NOTICES.md (decision D66). A test keeps the two in step with each other and with the
/// project's dependencies.
/// </summary>
public static class ThirdParty
{
    public static IReadOnlyList<ThirdPartyComponent> Components { get; } =
    [
        new("Open CASCADE Technology (OCCT)", "8.0.1", "LGPL-2.1 with the Open CASCADE exception 1.0", "https://dev.opencascade.org/"),
        new("Emscripten runtime and JS glue", "6.0.5", "MIT or University of Illinois/NCSA", "https://emscripten.org/"),
        new("musl libc", "as in Emscripten 6.0.5", "MIT", "https://musl.libc.org/"),
        new("LLVM libc++, libc++abi, libunwind, compiler-rt", "as in Emscripten 6.0.5", "Apache-2.0 with LLVM exceptions", "https://llvm.org/"),
        new("mimalloc", "as in Emscripten 6.0.5", "MIT", "https://github.com/microsoft/mimalloc"),
        new("three.js", "0.186.1", "MIT", "https://threejs.org/"),
        new("camera-controls", "3.1.2", "MIT", "https://github.com/yomotsu/camera-controls"),
        new("Draco decoder", "as bundled with three.js 0.186.1", "Apache-2.0", "https://github.com/google/draco"),
        new("Basis Universal transcoder", "as bundled with three.js 0.186.1", "Apache-2.0", "https://github.com/BinomialLLC/basis_universal"),
        new("meshoptimizer decoder", "as bundled with three.js 0.186.1", "MIT", "https://github.com/zeux/meshoptimizer"),
        new("MudBlazor", "9.11.0", "MIT", "https://mudblazor.com/"),
        new("Material Design Icons (in MudBlazor)", "as in MudBlazor 9.11.0", "Apache-2.0", "https://github.com/google/material-design-icons"),
        new(".NET runtime for WebAssembly and ASP.NET Core Blazor", "10.0.13", "MIT", "https://github.com/dotnet/runtime"),
    ];
}
