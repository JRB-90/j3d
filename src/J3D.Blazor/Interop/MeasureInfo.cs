namespace J3D.Blazor;

/// <summary>
/// A measurement from the viewer's Measure tool (M7; mirrors <c>MeasureInfo</c> in
/// src/J3D.Viewer/src/view/measure-format.ts): its title, the label drawn in 3D, the rows the panel
/// lists, already formatted (millimetres to 3 decimals, degrees to 2, "≈" when approximate), and the
/// parts it measures, which it follows (D108). The pending first pick has an empty id.
/// </summary>
public sealed record MeasureInfo(
    string Id,
    string Title,
    string Label,
    IReadOnlyList<MeasureRow> Rows,
    IReadOnlyList<MeasurePart> Parts,
    bool Approximate)
{
    /// <summary>Whether it measures a part of this model.</summary>
    public bool Touches(ModelId id) => Parts.Any(part => part.ModelId == id);
}

/// <summary>One row: its name and formatted value, and the part it describes when it's one of a part's (D104).</summary>
public sealed record MeasureRow(string Name, string Value, string? Group = null);

/// <summary>A part a measurement touches: its model and tree node.</summary>
public sealed record MeasurePart(string Id, int Node)
{
    /// <summary>The model measured.</summary>
    public ModelId ModelId => new(Id);
}
