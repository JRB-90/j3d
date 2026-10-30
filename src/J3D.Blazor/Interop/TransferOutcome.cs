namespace J3D.Blazor;

/// <summary>
/// Objects written by one model and read into another (M18, D225, D227), or why they couldn't be (mirrors
/// src/J3D.Viewer/src/index.ts's <c>TransferOutcome</c>): the arrival the target's edit takes in.
/// </summary>
/// <param name="File">The arrival's file, kept in the target's folder.</param>
/// <param name="Count">How many nodes the arrival has, its own assembly included.</param>
/// <param name="Nodes">Its nodes after its own assembly, in tree order.</param>
/// <param name="NotKept">"full" or "failed" when the target's storage couldn't keep the file: it has the objects this visit only.</param>
/// <param name="Error">Why the objects couldn't be moved, or null.</param>
internal sealed record TransferOutcome(
    string? File = null,
    int? Count = null,
    IReadOnlyList<TransferNode>? Nodes = null,
    string? NotKept = null,
    string? Error = null);

/// <summary>One node of an arrival (M18).</summary>
/// <param name="Parent">Its arrival parent: 0 for the objects themselves, else an earlier node of the arrival (1 being the first after its assembly).</param>
/// <param name="Name">Its name.</param>
/// <param name="Part">It draws something.</param>
/// <param name="Expandable">A compound part Expand would split (D190).</param>
/// <param name="Hidden">It was hidden in the model it came from, and stays hidden (D229).</param>
internal sealed record TransferNode(int Parent, string Name, bool Part, bool Expandable, bool Hidden);
