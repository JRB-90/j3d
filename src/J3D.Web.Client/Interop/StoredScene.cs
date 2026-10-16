using System.Text.Json.Serialization;

namespace J3D.Web.Client.Interop;

/// <summary>
/// Whether this tab keeps its models between visits (decision D109): it holds the store, or another
/// J3D tab does, or the browser gives the page no private file system.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<StoreStatus>))]
public enum StoreStatus
{
    [JsonStringEnumMemberName("kept")] Kept,
    [JsonStringEnumMemberName("otherTab")] OtherTab,
    [JsonStringEnumMemberName("unavailable")] Unavailable,
}

/// <summary>
/// What the viewer's store held when the page opened (M8, D82; mirrors <c>StoredScene</c> in
/// src/J3D.Viewer/src/store/types.ts): the kept models in list order, with their hidden parts, and the
/// camera, which the viewer has already put back (D111). Only its projection matters here.
/// </summary>
public sealed record StoredScene(StoreStatus Status, IReadOnlyList<StoredModel> Models, StoredCamera? Camera)
{
    public static StoredScene Empty { get; } = new(StoreStatus.Kept, [], null);
}

/// <summary>A model to import again from its kept files, under its id (D117), with its hidden part nodes.</summary>
public sealed record StoredModel(ModelSummary Summary, IReadOnlyList<int> Hidden);

/// <summary>The stored camera's projection, for the toolbar's toggle.</summary>
public sealed record StoredCamera(Projection Projection);
