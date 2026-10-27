using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;
using Microsoft.JSInterop;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// Moving and copying objects between models (M18, D210, D225–D233): the target's item says "Bringing
/// <em>n</em> parts…" while the viewer writes the objects in the source's worker (or as a GLB) and reads
/// them into the target, keeping the file; then the scene makes the edit, one step across both models.
/// Between a CAD model and a mesh model it's refused, and a failure changes nothing; a snackbar says why.
/// </summary>
internal static class TransferCommand
{
    public static async Task RunAsync(SceneState scene, ViewerSession session, ISnackbar snackbar, TransferRequest request)
    {
        if (scene.Find(request.Source) is not { Tree: { } tree } source || scene.Find(request.Target) is not { Status: ModelStatus.Loaded } target ||
            target.Bringing is not null || target.Expanding is not null)
        {
            return;
        }

        if (source.Summary.Kind != target.Summary.Kind)
        {
            snackbar.Add(
                $"Can't put {(source.Summary.Kind == ModelKind.Brep ? "CAD" : "mesh")} objects in {target.Summary.FileName}: objects move only between CAD models, or between mesh models.",
                Severity.Warning);
            return;
        }

        var parts = request.Nodes.Where(tree.Contains).SelectMany(tree.PartsUnder).Distinct().Count();
        string? error;
        scene.SetBringing(target.Id, parts);
        try
        {
            // The viewer answers after a paint, so the item shows "Bringing" before the edit is made.
            var outcome = await session.TransferAsync(request.Source, request.Nodes, request.Target);
            if (outcome is { Error: null } && scene.CompleteTransfer(request, outcome))
            {
                if (outcome.NotKept is { } notKept)
                {
                    snackbar.Add(
                        notKept == "full"
                            ? $"Couldn't keep the objects brought into {target.Summary.FileName}: the browser's storage is full. They stay until the page is closed."
                            : $"Couldn't keep the objects brought into {target.Summary.FileName}. They stay until the page is closed.",
                        Severity.Warning,
                        static options => options.VisibleStateDuration = 10_000);
                }

                return;
            }

            error = outcome?.Error ?? (outcome is null ? null : "the model changed meanwhile.");
        }
        catch (JSException exception)
        {
            error = exception.Message;
        }
        finally
        {
            scene.SetBringing(target.Id, null);
        }

        if (error is not null)
        {
            snackbar.Add($"Couldn't {(request.Copy ? "copy" : "move")} the objects to {target.Summary.FileName}: {error}", Severity.Error, static options => options.VisibleStateDuration = 10_000);
        }
    }
}
