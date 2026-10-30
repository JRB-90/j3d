namespace J3D.Blazor;

/// <summary>
/// How an export ended (M9; mirrors <c>ExportOutcome</c> in src/J3D.Viewer/src/index.ts): the name of
/// the file the browser saved, or cancelled, or why it failed.
/// </summary>
public sealed record ExportOutcome(string? FileName, bool Cancelled, string? Error);
