using System.Runtime.CompilerServices;
using Microsoft.Playwright.TestAdapter;

namespace J3D.E2E.Tests;

internal static class BrowserSettings
{
    /// <summary>
    /// Headless Firefox on a CI runner has no GPU, and its blocklist then turns WebGL off (risk R13).
    /// Forcing WebGL on lets it draw with Mesa's software renderer (decision D47). Runs before any
    /// test launches a browser.
    /// </summary>
    [ModuleInitializer]
    internal static void EnableWebGlInFirefox()
    {
        if (PlaywrightSettingsProvider.BrowserName == "firefox")
        {
            PlaywrightSettingsProvider.LaunchOptions.FirefoxUserPrefs = new Dictionary<string, object>
            {
                ["webgl.force-enabled"] = true,
                ["webgl.disabled"] = false,
            };
        }
    }
}
