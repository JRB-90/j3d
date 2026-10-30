namespace J3D.Blazor;

/// <summary>What a <see cref="ViewerNotice"/> is about, for a project that wants its own text or treatment.</summary>
public enum NoticeKind
{
    ImportFailed,
    FileSkipped,
    MeasureFailed,
    ModelNotKept,
    OtherTab,
    KeepingUnavailable,
    KeptModelsUnreadable,
    ExpandFailed,
    TransferRefused,
    TransferFailed,
    ArrivalNotKept,
}

public enum NoticeSeverity
{
    Info,
    Warning,
    Error,
}

/// <summary>
/// Something the page should tell its user, with a message written in English (D271). <see cref="J3DViewer"/>
/// has no UI of its own for these: <see cref="J3DViewer.OnNotice"/> reports them, and the page shows them.
/// </summary>
public sealed record ViewerNotice(NoticeKind Kind, NoticeSeverity Severity, string Message);
