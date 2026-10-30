using System.Text.Json.Serialization;

namespace J3D.Blazor;

/// <summary>Why an import failed (docs/plan.md §6.2).</summary>
public sealed record ImportError(ImportErrorCode Code, string Message);

/// <summary>What kind of failure an import met.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ImportErrorCode>))]
public enum ImportErrorCode
{
    /// <summary>The file's format can't be imported.</summary>
    Unsupported,
    /// <summary>A file the model needs, such as a glTF's <c>.bin</c>, wasn't among those imported.</summary>
    MissingFile,
    /// <summary>The file couldn't be read as its format.</summary>
    ParseFailed,
    /// <summary>The file holds nothing to draw.</summary>
    Empty,
    /// <summary>The import ran out of memory.</summary>
    OutOfMemory,
    /// <summary>Something went wrong inside the import.</summary>
    Internal,
}

/// <summary>Text for an <see cref="ImportErrorCode"/>.</summary>
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
