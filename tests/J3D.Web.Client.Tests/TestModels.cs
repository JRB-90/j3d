using J3D.Web.Client.Interop;
using J3D.Web.Client.Models;
using J3D.Web.Client.State;

namespace J3D.Web.Client.Tests;

/// <summary>Models and viewer reports for tests.</summary>
internal static class TestModels
{
    public static ModelSummary Summary(string id, string fileName = "part.step", ModelFormat format = ModelFormat.Step) =>
        new(new ModelId(id), fileName, format, SizeBytes: 2048);

    /// <summary>A bracket: an assembly of two plates and a pin, the second plate a sub-assembly.</summary>
    public static ModelLoadedInfo Info(params string[] warnings) => new(
        Tree:
        [
            new TreeNode("Bracket", Parent: -1, Prototype: -1),
            new TreeNode("Plate (bottom)", Parent: 0, Prototype: 0),
            new TreeNode("Top", Parent: 0, Prototype: -1),
            new TreeNode("Plate (top)", Parent: 2, Prototype: 0),
            new TreeNode("", Parent: 2, Prototype: 1),
        ],
        Stats: new ModelStats(Nodes: 5, Prototypes: 2, Instances: 3, Triangles: 1_234_567, Edges: 300, Textures: 0),
        Bounds: new Bounds([0, 0, 0], [40, 30, 20]),
        MemoryBytes: 64L * 1024 * 1024,
        Warnings: warnings);

    public static ImportError ParseFailed { get; } = new(ImportErrorCode.ParseFailed, "Not a readable STEP file.");

    public static ModelEntry Queued(string id = "m1", string fileName = "part.step", ModelFormat format = ModelFormat.Step) =>
        new(Summary(id, fileName, format));

    public static ModelEntry Importing(ImportPhase phase, double? fraction, string id = "m1") => Queued(id).WithProgress(phase, fraction);

    public static ModelEntry Loaded(string id = "m1", string fileName = "part.step", ModelFormat format = ModelFormat.Step, params string[] warnings) =>
        Queued(id, fileName, format).AsLoaded(Info(warnings));

    public static ModelEntry Failed(string id = "m1", string fileName = "part.step") => Queued(id, fileName).AsFailed(ParseFailed);
}
