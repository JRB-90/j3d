namespace J3D.Blazor;

/// <summary>Browser capabilities reported by the viewer module when it starts.</summary>
/// <param name="WebGl2">WebGL2 is available. Required for rendering.</param>
/// <param name="CrossOriginIsolated">
/// <c>SharedArrayBuffer</c> is available. Required for the multi-threaded OCCT build; without it the
/// viewer falls back to the single-threaded build.
/// </param>
public sealed record ViewerCapabilities(bool WebGl2, bool CrossOriginIsolated)
{
    public bool IsSupported => WebGl2;
}
