using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;

namespace J3D.Web.Client.State;

public enum ModelStatus
{
    Queued,
    Importing,
    Loaded,
    Failed,
}

/// <summary>
/// One model in the list. Transitions are pure: each returns the entry it leads to, or this entry
/// when it doesn't apply (docs/plan.md §6.4).
/// </summary>
public sealed record ModelEntry(ModelSummary Summary)
{
    public ModelStatus Status { get; private init; } = ModelStatus.Queued;

    /// <summary>The phase being imported; set only while <see cref="ModelStatus.Importing"/>.</summary>
    public ImportPhase? Phase { get; private init; }

    /// <summary>How far through <see cref="Phase"/> the import is (0–1), or null when the phase can't tell.</summary>
    public double? Fraction { get; private init; }

    public ModelLoadedInfo? Info { get; private init; }

    public ImportError? Error { get; private init; }

    public ModelId Id => Summary.Id;

    /// <summary>Queued or importing: removing it cancels the import.</summary>
    public bool IsPending => Status is ModelStatus.Queued or ModelStatus.Importing;

    /// <summary>Progress applies only while the import is pending, so a late report can't undo its outcome.</summary>
    public ModelEntry WithProgress(ImportPhase phase, double? fraction) =>
        IsPending ? this with { Status = ModelStatus.Importing, Phase = phase, Fraction = fraction } : this;

    public ModelEntry AsLoaded(ModelLoadedInfo info) =>
        this with { Status = ModelStatus.Loaded, Phase = null, Fraction = null, Info = info, Error = null };

    public ModelEntry AsFailed(ImportError error) =>
        this with { Status = ModelStatus.Failed, Phase = null, Fraction = null, Info = null, Error = error };
}
