namespace J3D.Blazor;

/// <summary>A model as it's queued: what the list can show before anything has been read.</summary>
public sealed record ModelSummary(ModelId Id, string FileName, ModelFormat Format, long SizeBytes)
{
    public ModelKind Kind => Format.Kind;
}
