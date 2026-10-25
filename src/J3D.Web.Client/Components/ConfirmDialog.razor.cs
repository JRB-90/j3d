using Microsoft.AspNetCore.Components;
using MudBlazor;

namespace J3D.Web.Client.Components;

/// <summary>
/// Asks before a destructive action. MudBlazor's message box focuses its confirming button, so Enter would
/// delete; this one focuses Cancel.
/// </summary>
public sealed partial class ConfirmDialog
{
    /// <summary>Opens with Cancel focused, as the first thing in the dialog; Escape cancels too.</summary>
    internal static readonly DialogOptions Options = new()
    {
        DefaultFocus = DefaultFocus.FirstChild,
        CloseOnEscapeKey = true,
        MaxWidth = MaxWidth.ExtraSmall,
        FullWidth = true,
    };

    [CascadingParameter]
    private IMudDialogInstance? Dialog { get; set; }

    [Parameter, EditorRequired]
    public string Title { get; set; } = "";

    [Parameter, EditorRequired]
    public RenderFragment? Message { get; set; }

    [Parameter, EditorRequired]
    public string ConfirmText { get; set; } = "";

    [Parameter]
    public string? ConfirmIcon { get; set; }

    [Parameter]
    public string? ConfirmTestId { get; set; }

    /// <summary>Asks, and answers whether the user confirmed.</summary>
    public static async Task<bool> AskAsync(IDialogService dialogs, string title, RenderFragment message, string confirmText, string confirmIcon, string confirmTestId)
    {
        var parameters = new DialogParameters<ConfirmDialog>
        {
            { static dialog => dialog.Title, title },
            { static dialog => dialog.Message, message },
            { static dialog => dialog.ConfirmText, confirmText },
            { static dialog => dialog.ConfirmIcon, confirmIcon },
            { static dialog => dialog.ConfirmTestId, confirmTestId },
        };
        var reference = await dialogs.ShowAsync<ConfirmDialog>(title, parameters, Options);
        var result = await reference.Result;
        return result is { Canceled: false };
    }

    private void Cancel() => Dialog?.Cancel();

    private void Confirm() => Dialog?.Close(DialogResult.Ok(true));
}
