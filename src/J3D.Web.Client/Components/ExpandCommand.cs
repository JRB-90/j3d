using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// Expand and Expand all (M15, D154, D197): the viewer expands the parts' file parts in the model's
/// worker, then the scene makes the edit from their pieces. A failure goes to a snackbar.
/// </summary>
internal static class ExpandCommand
{
    public static async Task RunAsync(SceneState scene, ViewerSession session, ISnackbar snackbar, ModelId id, IReadOnlyList<int> parts)
    {
        if (scene.Find(id) is not { Tree: { } tree } model || parts.Count == 0)
        {
            return;
        }

        List<int> fileNodes = [.. parts.Select(tree.FileNodeOf).Where(static node => node >= 0).Distinct()];
        string? error;
        try
        {
            var outcome = await session.ExpandPartsAsync(id, fileNodes);
            if (outcome?.Expansions is { } expansions)
            {
                scene.Expand(id, parts, expansions);
                return;
            }

            error = outcome?.Error;
        }
        catch (JSException exception)
        {
            error = exception.Message;
        }

        if (error is not null)
        {
            snackbar.Add($"Couldn't expand parts of {model.Summary.FileName}: {error}", Severity.Error, static options => options.VisibleStateDuration = 10_000);
        }
    }
}
