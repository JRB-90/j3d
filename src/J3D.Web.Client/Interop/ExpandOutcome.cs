namespace J3D.Web.Client.Interop;

/// <summary>
/// File parts expanded in a BREP model's worker (M15, D154), or why they couldn't be (mirrors
/// src/J3D.Viewer/src/index.ts's <c>ExpandOutcome</c>).
/// </summary>
public sealed record ExpandOutcome(IReadOnlyList<PartExpansion>? Expansions = null, string? Error = null);

/// <summary>One file part's pieces, in tree order.</summary>
public sealed record PartExpansion(int Node, IReadOnlyList<ExpansionPiece> Pieces);

/// <summary>
/// A piece of an expanded part: its name in the file, or empty; its piece parent, an earlier piece or
/// -1 for the part's new assembly; and whether it draws something (else it's a sub-assembly).
/// </summary>
public sealed record ExpansionPiece(string Name, int Parent, bool Part);
