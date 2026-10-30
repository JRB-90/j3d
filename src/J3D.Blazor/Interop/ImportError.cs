using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>Why an import failed (docs/plan.md §6.2).</summary>
public sealed record ImportError(ImportErrorCode Code, string Message);

[JsonConverter(typeof(JsonStringEnumConverter<ImportErrorCode>))]
public enum ImportErrorCode
{
    Unsupported,
    MissingFile,
    ParseFailed,
    Empty,
    OutOfMemory,
    Internal,
}

public static class ImportErrorCodeExtensions
{
    extension(ImportErrorCode code)
    {
        /// <summary>The code as the model list shows it, ahead of the error's message.</summary>
        public string DisplayName => code switch
        {
            ImportErrorCode.Unsupported => "Unsupported",
            ImportErrorCode.MissingFile => "Missing file",
            ImportErrorCode.ParseFailed => "Parse failed",
            ImportErrorCode.Empty => "Empty",
            ImportErrorCode.OutOfMemory => "Too large",
            ImportErrorCode.Internal => "Failed",
            _ => throw new ArgumentOutOfRangeException(nameof(code), code, null),
        };
    }
}
