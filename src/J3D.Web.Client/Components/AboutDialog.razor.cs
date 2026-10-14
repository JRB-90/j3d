using System.Reflection;
using Microsoft.AspNetCore.Components;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// About and licences (decision D66): what J3D is, its licence and build, and the third-party
/// software it ships, with links to the OCCT build recipe and the full notices.
/// </summary>
public sealed partial class AboutDialog
{
    internal const string RepositoryUrl = "https://github.com/JRB-90/j3d";
    internal const string OcctRecipeUrl = $"{RepositoryUrl}/tree/main/src/J3D.Occt";
    internal const string NoticesUrl = $"{RepositoryUrl}/blob/main/THIRD-PARTY-NOTICES.md";

    /// <summary>The commit this build came from (the SDK appends it to the informational version), or null.</summary>
    internal static string? Build { get; } = CommitOf(
        typeof(AboutDialog).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);

    [CascadingParameter]
    private IMudDialogInstance Dialog { get; set; } = null!;

    /// <summary>The short commit hash from a version such as <c>1.0.0+55092bb…</c>.</summary>
    internal static string? CommitOf(string? informationalVersion) =>
        informationalVersion?.IndexOf('+', StringComparison.Ordinal) is int plus and >= 0 && informationalVersion.Length > plus + 1
            ? informationalVersion[(plus + 1)..Math.Min(informationalVersion.Length, plus + 8)]
            : null;

    private void Close() => Dialog.Close();
}
