using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>
/// File parts expanded in a BREP model's worker (M15, D154), or why they couldn't be (mirrors
/// src/J3D.Viewer/src/index.ts's <c>ExpandOutcome</c>). Since M16 (D199) each part asked for comes with
/// the index of its pieces among <paramref name="PieceSets"/>: the parts placing one definition share
/// them, and as one list of pieces per part the large plant's 840 took 145 ms to read here.
/// </summary>
/// <param name="Nodes">The file parts asked for.</param>
/// <param name="Sets">Each one's pieces, as an index into <paramref name="PieceSets"/>.</param>
/// <param name="PieceSets">The distinct lists of pieces.</param>
/// <param name="Error">Why the parts couldn't be expanded, or null.</param>
internal sealed record ExpandOutcome(
    IReadOnlyList<int>? Nodes = null,
    IReadOnlyList<int>? Sets = null,
    IReadOnlyList<IReadOnlyList<ExpansionPiece>>? PieceSets = null,
    string? Error = null)
{
    /// <summary>Each file part's pieces, or null when the expansion failed.</summary>
    [JsonIgnore]
    public IReadOnlyList<PartExpansion>? Expansions =>
        Nodes is null || Sets is null || PieceSets is null ? null : [.. Nodes.Select((node, index) => new PartExpansion(node, PieceSets[Sets[index]]))];

    /// <summary>An outcome of these expansions, each list of pieces sent once.</summary>
    public static ExpandOutcome Of(IReadOnlyList<PartExpansion> expansions) =>
        new([.. expansions.Select(static expansion => expansion.Node)], [.. Enumerable.Range(0, expansions.Count)], [.. expansions.Select(static expansion => expansion.Pieces)]);
}

/// <summary>One file part's pieces, in tree order.</summary>
internal sealed record PartExpansion(int Node, IReadOnlyList<ExpansionPiece> Pieces);

/// <summary>
/// A piece of an expanded part: its name in the file, or empty; its piece parent, an earlier piece or
/// -1 for the part's new assembly; and whether it draws something (else it's a sub-assembly).
/// </summary>
internal sealed record ExpansionPiece(string Name, int Parent, bool Part);
