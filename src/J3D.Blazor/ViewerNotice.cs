namespace J3D.Blazor;

/// <summary>What a <see cref="ViewerNotice"/> is about, for a project that wants its own text or treatment.</summary>
public enum NoticeKind
{
    /// <summary>A file couldn't be imported.</summary>
    ImportFailed,
    /// <summary>A file in an import was left out: an unsupported type, or a sidecar nothing used.</summary>
    FileSkipped,
    /// <summary>The Measure tool couldn't measure what was clicked.</summary>
    MeasureFailed,
    /// <summary>A loaded model couldn't be kept for the next visit.</summary>
    ModelNotKept,
    /// <summary>Another tab holds the store, so this one keeps nothing.</summary>
    OtherTab,
    /// <summary>This browser can't keep models.</summary>
    KeepingUnavailable,
    /// <summary>Models kept from an earlier visit couldn't be read.</summary>
    KeptModelsUnreadable,
    /// <summary>Parts couldn't be expanded.</summary>
    ExpandFailed,
    /// <summary>A move or copy between models can't be done.</summary>
    TransferRefused,
    /// <summary>A move or copy between models failed.</summary>
    TransferFailed,
    /// <summary>Objects that reached a model are there for this visit only.</summary>
    ArrivalNotKept,
}

/// <summary>How much a notice matters.</summary>
public enum NoticeSeverity
{
    /// <summary>Worth knowing.</summary>
    Info,
    /// <summary>Something was left out or didn't happen as asked.</summary>
    Warning,
    /// <summary>Something asked for failed.</summary>
    Error,
}

/// <summary>
/// Something the page should tell its user, with a message written in English (D271). <see cref="J3DViewer"/>
/// has no UI of its own for these: <see cref="J3DViewer.OnNotice"/> reports them, and the page shows them.
/// </summary>
public sealed record ViewerNotice(NoticeKind Kind, NoticeSeverity Severity, string Message);
