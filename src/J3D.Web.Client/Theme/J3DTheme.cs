using MudBlazor;

namespace J3D.Web.Client.Theme;

/// <summary>The application's dark theme. J3D is dark-only; there is no light palette.</summary>
public static class J3DTheme
{
    // System font stack: no web-font download, and nothing cross-origin (see CrossOriginIsolation).
    private static readonly string[] FontStack =
        ["Segoe UI Variable", "Segoe UI", "system-ui", "-apple-system", "Roboto", "Helvetica Neue", "Arial", "sans-serif"];

    public static MudTheme Instance { get; } = new()
    {
        PaletteDark = new PaletteDark
        {
            Primary = "#4F9DFF",
            Secondary = "#FFB547",
            Tertiary = "#5FD3BC",
            Error = "#FF6B6B",
            Warning = "#FFB547",
            Success = "#5FD38D",
            Info = "#4F9DFF",
            Black = "#0B0C0E",
            Background = "#121417",
            BackgroundGray = "#16191D",
            Surface = "#1B1E23",
            AppbarBackground = "#16191D",
            AppbarText = "#E6E8EB",
            DrawerBackground = "#16191D",
            DrawerText = "#C9CDD3",
            DrawerIcon = "#9AA1AB",
            TextPrimary = "#E6E8EB",
            TextSecondary = "#9AA1AB",
            TextDisabled = "#5C636E",
            ActionDefault = "#9AA1AB",
            ActionDisabled = "#4A5059",
            Divider = "#2A2F36",
            DividerLight = "#22262C",
            LinesDefault = "#2A2F36",
            TableLines = "#2A2F36",
        },
        Typography = new Typography
        {
            Default = new DefaultTypography { FontFamily = FontStack },
        },
        LayoutProperties = new LayoutProperties
        {
            DefaultBorderRadius = "6px",
            DrawerWidthLeft = "320px",
            AppbarHeight = "48px",
        },
    };
}
