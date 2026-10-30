using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>Where the viewer takes its keyboard shortcuts (D256).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ViewerKeys>))]
public enum ViewerKeys
{
    /// <summary>Not at all.</summary>
    [JsonStringEnumMemberName("off")] Off,

    /// <summary>While the pointer or focus is in the viewer.</summary>
    [JsonStringEnumMemberName("viewer")] InViewer,

    /// <summary>Anywhere on the page, for a page that is the viewer.</summary>
    [JsonStringEnumMemberName("page")] Page,
}

/// <summary><see cref="J3DViewer"/>'s parameters, as src/J3D.Blazor/scripts/src/index.ts takes them.</summary>
internal sealed record ViewerOptions(ViewerKeys Keys, string? PauseKeysWhile, string? Keep, bool ViewCube, bool HomeButton, bool ViewButtons, bool DropFiles);
