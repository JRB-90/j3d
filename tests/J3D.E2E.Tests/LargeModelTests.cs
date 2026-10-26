using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Playwright;

namespace J3D.E2E.Tests;

/// <summary>
/// Spike S2 and the M2 exit criterion: a large generated STEP either loads or fails cleanly with
/// OutOfMemory, in each browser. Since M5 a loaded model is also measured for the tuning decisions
/// (D63, D71): the longest main-thread task while it's added and fitted, its draw calls and buffer
/// bytes, what one frame costs, the frame rate while orbiting, and opening its tree's first level.
/// Since M6 (D89) also how long a pick takes, and selecting, hiding and showing every part. Since M11
/// (D141) a STEP export is cancelled part-way, then the model is exported as STEP and BREP through its
/// item's menu, each either downloaded or failed with out of memory. Long tasks are only reported by Chromium. On demand only:
/// <c>npm run fixtures:large -- 200 curved-100</c>, then run with
/// <c>J3D_LARGE_FIXTURES=200,curved-100</c>; add <c>HEADED=1</c> to measure on the real GPU. Since M12
/// also the generated plant (<c>plant-10000</c>, D161) and the real SO-101 arm (<c>so101</c>, D160).
/// Since M16 (D201) those two assemblies are edited as well: selecting in each mode, typed moves,
/// pasting, deleting and undoing, Expand all, the edited STEP and BREP, and a restore after a reload,
/// each timed but only its outcome asserted.
/// </summary>
public sealed class LargeModelTests(J3DAppFixture app) : ViewerPageTest(app)
{
    private static readonly string? Names = Environment.GetEnvironmentVariable("J3D_LARGE_FIXTURES");

    /// <summary>Records the main thread's tasks over 50 ms, where the browser reports them.</summary>
    private const string LongTaskLog =
        """
        () => {
            window.__longTasks = [];
            window.__longTaskObserver?.disconnect();
            if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
                window.__longTaskObserver = new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((e) => e.duration)));
                window.__longTaskObserver.observe({ type: 'longtask' });
            }
        }
        """;

    /// <summary>The first part in view, as its node and a client point where it can be clicked.</summary>
    private const string PartInView =
        """
        id => {
            for (const node of window.__j3dTest.partState(id).parts) {
                const point = window.__j3dTest.partPoint(id, node);
                if (point) return { node, x: point.x, y: point.y };
            }
            return null;
        }
        """;

    /// <summary>
    /// The tree's root, its first sub-assembly among the first 20 children (plant's Line 1, whose row
    /// is drawn once the root is open) or else the root itself, and how many parts that holds.
    /// </summary>
    private const string SubAssembly =
        """
        id => {
            const tree = window.__j3dTest.models().find(m => m.id === id).tree;
            const children = tree.map(() => []);
            tree.forEach((n, i) => { if (n.parent >= 0) children[n.parent].push(i); });
            const root = tree.findIndex(n => n.parent < 0);
            const node = children[root].slice(0, 20).find(i => tree[i].prototype < 0) ?? root;
            let parts = 0;
            for (const stack = [node]; stack.length > 0;) {
                const i = stack.pop();
                if (tree[i].prototype >= 0) parts++;
                stack.push(...children[i]);
            }
            return [root, node, parts];
        }
        """;

    /// <summary>How long one editing step may take: CI's software drawing is slow (D201).</summary>
    private const int Slow = 5 * 60_000;

    private const string PartsAre ="([id, parts]) => window.__j3dTest.partState(id).parts.length === parts";
    private const string AllSelected = "([id, parts]) => window.__j3dTest.partState(id).selected.length === parts";
    private const string PlacedAt = "([id, node, x]) => Math.abs(window.__j3dTest.placement(id, node).local[12] - x) < 1e-3";

    /// <summary>
    /// As scripts/generate-large-step.mjs names them: 200 is block copies, curved-100 curved parts,
    /// plant-10000 a hierarchical assembly and so101 the downloaded arm.
    /// </summary>
    private static string FixtureOf(string name) =>
        name.StartsWith("curved-", StringComparison.Ordinal) ? $"large/{name}mb.step"
        : name.StartsWith("plant-", StringComparison.Ordinal) || name == "so101" ? $"large/{name}.step"
        : $"large/large-{name}mb.step";

    [Fact]
    public async Task Large_step_loads_or_fails_with_OutOfMemory()
    {
        Assert.SkipWhen(string.IsNullOrWhiteSpace(Names), "Set J3D_LARGE_FIXTURES (e.g. 200) after running npm run fixtures:large.");

        foreach (var name in Names!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var fixture = FixtureOf(name);
            Assert.True(File.Exists(Fixtures.PathOf(fixture)), $"Run npm run fixtures:large -- {name} first.");

            await StartLongTaskLogAsync();
            var stopwatch = Stopwatch.StartNew();
            await ImportAsync(fixture);
            await Page.WaitForFunctionAsync(
                "() => window.__j3dTest.models().every(m => m.status === 'loaded' || m.status === 'failed')",
                null,
                new PageWaitForFunctionOptions { Timeout = 20 * 60_000, PollingInterval = 1000 });
            var elapsed = stopwatch.Elapsed;

            // Without the tree, which has a node per part.
            var json = await Page.EvaluateAsync<JsonElement>("() => window.__j3dTest.models().map(({ tree, ...model }) => model)");
            var model = Assert.Single(json.Deserialize<TestModel[]>(Json)!);
            TestContext.Current.TestOutputHelper?.WriteLine(
                $"{BrowserName} {fixture}: {model.Status} in {elapsed.TotalSeconds:F1} s, " +
                (model.Status == "loaded"
                    ? $"{model.Stats!.Prototypes} parts, {model.Stats.Triangles} triangles, WASM heap {model.MemoryBytes / (1 << 20)} MB; {await MeasureAsync(model.Id)}; {await ExportAsync()}"
                    : $"{model.Error}"));

            if (model.Status == "failed")
            {
                Assert.Equal("OutOfMemory", model.Error!.Code);
            }
            else if (name.StartsWith("plant-", StringComparison.Ordinal) || name == "so101")
            {
                TestContext.Current.TestOutputHelper?.WriteLine(
                    $"{BrowserName} {fixture}, editing: {await EditAsync(model.Id, Path.GetFileName(fixture))}");
            }

            await RemoveAsync(model.Id); // free the heap before the next size
            Assert.Equal(0, await LiveWorkersAsync());
        }

        AssertNoConsoleErrors();
    }

    /// <summary>Measures the loaded model in the scene, as a line for the test output.</summary>
    private async Task<string> MeasureAsync(string id)
    {
        await WaitForCameraRestAsync(); // the first model's fit (D30) draws it for the first time
        var adding = await TakeLongTasksAsync();

        var stats = await RenderStatsAsync();
        // The context the viewer already has (a second getContext of the same kind returns it).
        var gpu = await Page.EvaluateAsync<string>(
            """
            () => {
                const gl = document.querySelector('[data-testid=viewport] canvas').getContext('webgl2');
                const info = gl.getExtension('WEBGL_debug_renderer_info');
                return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            }
            """);
        var frame = await Page.EvaluateAsync<double>(
            """
            () => {
                const box = document.querySelector('[data-testid=viewport] canvas').getBoundingClientRect();
                const point = [[box.left + box.width / 2, box.top + box.height / 2]];
                const times = [];
                for (let i = 0; i < 9; i++) {
                    const start = performance.now();
                    window.__j3dTest.canvasPixels(point); // draws, then reads back, so the GPU has finished
                    times.push(performance.now() - start);
                }
                return times.sort((a, b) => a - b)[4];
            }
            """);

        var fps = await OrbitAsync();
        var orbiting = await TakeLongTasksAsync();

        var tree = Stopwatch.StartNew();
        await Page.GetByTestId("model-tree-toggle").ClickAsync();
        await Page.GetByTestId("model-tree-node").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
        var treeMs = tree.Elapsed.TotalMilliseconds;
        var opening = await TakeLongTasksAsync();
        var parts = await MeasurePartsAsync(id);

        return $"{parts}; adding: longest task {Longest(adding)}; {stats.DrawCalls} draw calls, {stats.Triangles} triangles, " +
            $"{stats.Lines} lines, {stats.Geometries} geometries, buffers {stats.BufferBytes / (1 << 20)} MB; " +
            $"a frame {frame:F1} ms; orbiting {fps:F0} fps (longest task {Longest(orbiting)}); " +
            $"tree's first level {treeMs:F0} ms (longest task {Longest(opening)}); GPU {gpu}";
    }

    /// <summary>
    /// Picks over a 5 × 5 grid of the viewport, then selecting every part from the tree's root, hiding
    /// them all (H) and showing them again (Shift+H), each timed until the viewer has applied it (D89).
    /// </summary>
    private async Task<string> MeasurePartsAsync(string id)
    {
        var picks = await Page.EvaluateAsync<double[]>(
            """
            () => {
                const box = document.querySelector('[data-testid=viewport] canvas').getBoundingClientRect();
                const times = [];
                for (let i = 1; i <= 5; i++) {
                    for (let j = 1; j <= 5; j++) {
                        const start = performance.now();
                        window.__j3dTest.partAt(box.left + box.width * i / 6, box.top + box.height * j / 6);
                        times.push(performance.now() - start);
                    }
                }
                return times.sort((a, b) => a - b);
            }
            """);

        async Task<double> TimeAsync(Func<Task> act, string done)
        {
            var stopwatch = Stopwatch.StartNew();
            await act();
            await Page.WaitForFunctionAsync(done, id, new PageWaitForFunctionOptions { Timeout = 120_000, PollingInterval = 20 });
            return stopwatch.Elapsed.TotalMilliseconds;
        }

        // The first tree node: the root assembly, or in a flat file one part.
        const string selected = "id => window.__j3dTest.partState(id).selected.length > 0";
        const string hidden = "id => { const s = window.__j3dTest.partState(id); return s.hidden.length === s.parts.length && s.selected.length === 0; }";
        const string shown = "id => window.__j3dTest.partState(id).hidden.length === 0";
        var select = await TimeAsync(() => Page.Locator("[data-testid=model-tree-node] .j3d-tree-node-name").First.ClickAsync(), selected);
        var count = await Page.EvaluateAsync<int>("id => window.__j3dTest.partState(id).selected.length", id);
        var selecting = await TakeLongTasksAsync();
        var hide = await TimeAsync(() => Page.GetByTestId("model-eye").ClickAsync(), hidden);
        var show = await TimeAsync(() => Page.GetByTestId("model-eye").ClickAsync(), shown);
        var hiding = await TakeLongTasksAsync();

        return $"a pick {picks[picks.Length / 2]:F1} ms (longest {picks[^1]:F1}); selecting the first tree node's {count} parts {select:F0} ms " +
            $"(longest task {Longest(selecting)}); hiding every part {hide:F0} ms, showing them {show:F0} ms (longest task {Longest(hiding)})";
    }

    /// <summary>
    /// Cancels a STEP export two seconds in, then exports STEP and BREP, as a line for the test output.
    /// The model must still be loaded afterwards, whatever happened. A small file's export (M12's
    /// plant-10000) can end before the Cancel.
    /// </summary>
    private async Task<string> ExportAsync()
    {
        var item = Page.GetByTestId("model-item");
        var running = item.GetByTestId("model-export");
        await StartLongTaskLogAsync();
        await StartExportAsync("step");
        await WaitForExportToShowAsync(running);
        await Page.WaitForTimeoutAsync(2_000);
        var cancelling = Stopwatch.StartNew();
        var clicked = true;
        try
        {
            await item.GetByTestId("cancel-export").ClickAsync(new() { Timeout = 5_000 });
        }
        catch (TimeoutException)
        {
            // Only because the export has already ended.
            Assert.Equal(0, await running.CountAsync());
            clicked = false;
        }

        await Expect(running).ToHaveCountAsync(0, new() { Timeout = 10 * 60_000 });
        var cancelled = clicked
            ? $"STEP cancelled {cancelling.Elapsed.TotalSeconds:F1} s after asking (longest task {Longest(await TakeLongTasksAsync())})"
            : $"STEP ended within 2 s, before the Cancel (longest task {Longest(await TakeLongTasksAsync())})";

        var (step, _) = await DownloadAsync("step");
        var (brep, _) = await DownloadAsync("brep");
        await Expect(item).ToHaveAttributeAsync("data-status", "loaded");
        return $"{cancelled}; {step}; {brep}";
    }

    /// <summary>
    /// Iteration 3 on an assembly (D201), each step timed from its click or key until the viewer shows
    /// it, as a line for the test output. What each step does is asserted, not how long it takes: CI
    /// draws in software. The edits it leaves (a move and Expand all) must come back after a reload.
    /// </summary>
    private async Task<string> EditAsync(string id, string fileName)
    {
        // CI draws the plant in software, up to 26 s a frame while other tests run, and the page
        // answers nothing meanwhile; the camera stays where the orbit left it, the model in view.
        Page.SetDefaultTimeout(Slow);
        Assert.Equal("kept", await Page.EvaluateAsync<string>("async () => { await window.__j3dTest.storeIdle(); return window.__j3dTest.store().status; }"));
        var parts = await PartCountAsync(id);
        var selecting = await SelectInEachModeAsync(id, fileName, parts);

        var found = await Page.EvaluateAsync<int[]>(SubAssembly, id);
        var (root, node, count) = (found[0], found[1], found[2]);
        var (editing, moved) = await EditSubAssemblyAsync(id, root, node, count, parts);
        var (expanding, expanded) = await ExpandAllAsync(id, root, parts);
        var exporting = await ExportEditedAsync(expanded);
        var restoring = await RestoreAsync(id, node, moved, expanded);
        return string.Join("; ", selecting, editing, expanding, exporting, restoring);
    }

    /// <summary>
    /// A click on a part in Object mode, then <c>1</c>, a click in Model mode, a typed move of the whole
    /// model and its undo, <c>2</c>, <c>3</c> and a click in Feature mode, back in Object mode at the end.
    /// </summary>
    private async Task<string> SelectInEachModeAsync(string id, string fileName, int parts)
    {
        var part = (await Page.EvaluateAsync<JsonElement>(PartInView, id)).Deserialize<PartPoint>(Json);
        Assert.True(part is not null, "a part should be in view");
        Task Click() => Page.Mouse.ClickAsync((float)part.X, (float)part.Y);
        object[] all = [id, parts];

        var objectClick = await TimedAsync(
            Click, "([id, node]) => { const s = window.__j3dTest.partState(id).selected; return s.length === 1 && s[0] === node; }", new object[] { id, part.Node });
        var modelKey = await TimedAsync(() => Page.Keyboard.PressAsync("1"), AllSelected, all);
        await Page.Keyboard.PressAsync("Escape");
        await Page.WaitForFunctionAsync("id => window.__j3dTest.partState(id).selected.length === 0", id);
        var modelClick = await TimedAsync(Click, AllSelected, all);

        // The whole model, by its own frame (D169), and back.
        await Page.Keyboard.PressAsync("w");
        await Expect(Page.GetByTestId("move-title")).ToHaveTextAsync(fileName, new() { Timeout = Slow });
        await Page.GetByTestId("move-frame-world").ClickAsync();
        var x = await LocalXAsync(id, -1);
        var move = await TimedAsync(() => TypeAsync("move-x", x + 100), PlacedAt, new object[] { id, -1, x + 100 });
        await Page.GetByTestId("move-x").BlurAsync(); // so the keys are the page's, not the field's
        var undo = await TimedAsync(() => Page.Keyboard.PressAsync("Control+z"), PlacedAt, new object[] { id, -1, x });
        await Page.Keyboard.PressAsync("Escape"); // ends the tool, keeping the selection

        var objectKey = await TimedAsync(
            () => Page.Keyboard.PressAsync("2"),
            "([id, parts]) => document.querySelector('[data-testid=mode-object]').getAttribute('aria-pressed') === 'true' && window.__j3dTest.partState(id).selected.length === parts",
            all);
        var featureKey = await TimedAsync(
            () => Page.Keyboard.PressAsync("3"), "() => document.querySelector('[data-testid=mode-feature]').getAttribute('aria-pressed') === 'true'");
        var featureClick = await TimedAsync(Click, "() => window.__j3dTest.selectionState().features.length === 1");
        await Page.Keyboard.PressAsync("Escape");
        await Page.Keyboard.PressAsync("2");
        await Expect(Page.GetByTestId("mode-object")).ToHaveAttributeAsync("aria-pressed", "true", new() { Timeout = Slow });

        return $"a click on a part in Object mode {objectClick}; 1 (Model mode, all {parts} parts selected) {modelKey}; a click in Model mode {modelClick}; " +
            $"a typed move of the model {move}, its undo {undo}; 2 {objectKey}; 3 {featureKey}; a click in Feature mode {featureClick}";
    }

    /// <summary>
    /// Selects the sub-assembly from the tree, moves it by a typed value, undoes and redoes that (so it
    /// stays moved), then pastes a copy, deletes it and undoes each. Returns the line and where it's moved to.
    /// </summary>
    private async Task<(string Line, double Moved)> EditSubAssemblyAsync(string id, int root, int node, int count, int parts)
    {
        var row = await TreeRowAsync(id, root, node);
        var name = await row.InnerTextAsync();
        var select = await TimedAsync(() => row.ClickAsync(), AllSelected, new object[] { id, count });

        await Page.Keyboard.PressAsync("w");
        await Expect(Page.GetByTestId("move-title")).ToHaveTextAsync(name, new() { Timeout = Slow });
        await Page.GetByTestId("move-frame-parent").ClickAsync();
        var x = await LocalXAsync(id, node);
        var moved = Math.Round(x + 100, 3);
        var move = await TimedAsync(() => TypeAsync("move-x", moved), PlacedAt, new object[] { id, node, moved });
        await Page.GetByTestId("move-x").BlurAsync();
        var undo = await TimedAsync(() => Page.Keyboard.PressAsync("Control+z"), PlacedAt, new object[] { id, node, x });
        var redo = await TimedAsync(() => Page.Keyboard.PressAsync("Control+y"), PlacedAt, new object[] { id, node, moved });
        await Page.Keyboard.PressAsync("Escape");

        Task Press(string key) => Page.Keyboard.PressAsync(key);
        await Press("Control+c");
        var paste = await TimedAsync(() => Press("Control+v"), PartsAre, new object[] { id, parts + count });
        var delete = await TimedAsync(() => Press("Delete"), PartsAre, new object[] { id, parts });
        var undoDelete = await TimedAsync(() => Press("Control+z"), PartsAre, new object[] { id, parts + count });
        var undoPaste = await TimedAsync(() => Press("Control+z"), PartsAre, new object[] { id, parts });

        return ($"a click on {name} ({count} parts) in the tree {select}; a typed move of it {move}, its undo {undo} and redo {redo}; " +
            $"pasting a copy of it {paste}, deleting that {delete}, undoing each {undoDelete} and {undoPaste}", moved);
    }

    /// <summary>
    /// Expand all from the root's context menu (D197), its undo and its redo, so the model stays expanded.
    /// Returns the line and the parts it has then; a model with no compound parts isn't offered it.
    /// </summary>
    private async Task<(string Line, int Parts)> ExpandAllAsync(string id, int root, int parts)
    {
        await (await TreeRowAsync(id, root, root)).ClickAsync(new() { Button = MouseButton.Right });
        await Expect(Page.GetByTestId("context-isolate")).ToBeVisibleAsync(new() { Timeout = Slow });
        var expandAll = Page.GetByTestId("context-expand-all");
        if (await expandAll.CountAsync() == 0)
        {
            await Page.Keyboard.PressAsync("Escape");
            return ("no compound parts, so no Expand all", parts);
        }

        var expand = await TimedAsync(
            () => expandAll.ClickAsync(),
            "([id, parts]) => window.__j3dTest.partState(id).parts.length > parts && !document.querySelector('[data-testid=model-expanding]')",
            new object[] { id, parts },
            2 * Slow);
        var expanded = await PartCountAsync(id);
        var undo = await TimedAsync(() => Page.Keyboard.PressAsync("Control+z"), PartsAre, new object[] { id, parts });
        var redo = await TimedAsync(() => Page.Keyboard.PressAsync("Control+y"), PartsAre, new object[] { id, expanded });
        return ($"Expand all ({parts} parts into {expanded}) {expand}, its undo {undo} and redo {redo}", expanded);
    }

    /// <summary>The edited model as STEP, imported again with every part (R24), and as BREP.</summary>
    private async Task<string> ExportEditedAsync(int parts)
    {
        var (step, file) = await DownloadAsync("step");
        var (brep, _) = await DownloadAsync("brep");
        if (file is null)
        {
            return $"edited {step}; edited {brep}"; // out of memory, which DownloadAsync checked
        }

        // The download is saved without its name, which the import needs for the format.
        var folder = Directory.CreateTempSubdirectory("j3d-large-");
        try
        {
            var path = Path.Combine(folder.FullName, file.SuggestedFilename);
            await file.SaveAsAsync(path);
            await Page.SetInputFilesAsync("[data-testid=j3d-test-input]", path);
            await Page.WaitForFunctionAsync(
                "() => { const models = window.__j3dTest.models(); return models.length === 2 && models.every(m => m.status === 'loaded' || m.status === 'failed'); }",
                null,
                new PageWaitForFunctionOptions { Timeout = 20 * 60_000, PollingInterval = 1000 });
            var json = await Page.EvaluateAsync<JsonElement>("() => window.__j3dTest.models().map(({ tree, ...model }) => model)");
            var again = json.Deserialize<TestModel[]>(Json)![1];
            Assert.Equal("loaded", again.Status);
            Assert.Equal(parts, again.Stats!.Instances);
            await RemoveAsync(again.Id);
            return $"edited {step}, imported again with its {parts} parts; edited {brep}";
        }
        finally
        {
            folder.Delete(recursive: true);
        }
    }

    /// <summary>Reloads, timed until the model is back with its parts; the moved sub-assembly must be where it was left.</summary>
    private async Task<string> RestoreAsync(string id, int node, double moved, int parts)
    {
        await Page.EvaluateAsync("() => window.__j3dTest.storeIdle()");
        await Page.AddInitScriptAsync($"({LongTaskLog})()"); // the restore's tasks, from the page's start
        var stopwatch = Stopwatch.StartNew();
        await Page.ReloadAsync();
        await Page.WaitForFunctionAsync("() => window.__j3dTest !== undefined");
        await Page.WaitForFunctionAsync(
            "id => window.__j3dTest.models().some(m => m.id === id && (m.status === 'loaded' || m.status === 'failed')) && window.__j3dTest.partState(id)",
            id,
            new PageWaitForFunctionOptions { Timeout = 20 * 60_000, PollingInterval = 100 });
        await Page.WaitForFunctionAsync(PartsAre, new object[] { id, parts }, new PageWaitForFunctionOptions { Timeout = 30_000, PollingInterval = 100 });
        var elapsed = stopwatch.Elapsed;
        var tasks = Longest(await TakeLongTasksAsync());

        Assert.Equal(moved, await LocalXAsync(id, node), 3);
        await Expect(Page.GetByTestId("model-item").GetByTestId("model-warnings")).ToHaveCountAsync(0, new() { Timeout = Slow });
        return $"restored with its edits after a reload in {elapsed.TotalSeconds:F1} s (longest task {tasks})";
    }

    /// <summary>
    /// A row's name in the model's tree, with the tree open, scrolled to its top (rows off screen aren't
    /// drawn, D198) and the root opened if the row is under it.
    /// </summary>
    private async Task<ILocator> TreeRowAsync(string id, int root, int node)
    {
        if (await Page.GetByTestId("model-tree").CountAsync() == 0)
        {
            await Page.GetByTestId("model-tree-toggle").ClickAsync();
        }

        await Page.GetByTestId("model-tree").EvaluateAsync("tree => tree.scrollIntoView({ block: 'start' })");
        var rootRow = Page.Locator($"[data-tree-node=\"{id}:{root}\"]");
        if (node != root && await rootRow.GetAttributeAsync("aria-expanded") == "false")
        {
            await rootRow.GetByTestId("tree-node-toggle").ClickAsync();
        }

        return Page.Locator($"[data-tree-node=\"{id}:{node}\"] .j3d-tree-node-name");
    }

    /// <summary>
    /// Does something, then waits until the page shows it's done (D63's method), as its time and the
    /// longest task meanwhile.
    /// </summary>
    private async Task<string> TimedAsync(Func<Task> act, string done, object? arg = null, int timeout = Slow)
    {
        await StartLongTaskLogAsync();
        var stopwatch = Stopwatch.StartNew();
        await act();
        await Page.WaitForFunctionAsync(done, arg, new PageWaitForFunctionOptions { Timeout = timeout, PollingInterval = 20 });
        var elapsed = stopwatch.Elapsed.TotalMilliseconds;
        return $"{elapsed:F0} ms (longest task {Longest(await TakeLongTasksAsync())})";
    }

    /// <summary>Types a value in one of the Move fields and presses Enter.</summary>
    private async Task TypeAsync(string field, double value)
    {
        await Page.GetByTestId(field).FillAsync(value.ToString("0.###", CultureInfo.InvariantCulture));
        await Page.GetByTestId(field).PressAsync("Enter");
    }

    private Task<double> LocalXAsync(string id, int node) =>
        Page.EvaluateAsync<double>("([id, node]) => window.__j3dTest.placement(id, node).local[12]", new object[] { id, node });

    private Task<int> PartCountAsync(string id) => Page.EvaluateAsync<int>("id => window.__j3dTest.partState(id).parts.length", id);

    /// <summary>
    /// Exports the model and waits until the export ends, with its file's size or its failure as a line,
    /// and the file when there is one.
    /// </summary>
    private async Task<(string Line, IDownload? File)> DownloadAsync(string format)
    {
        var downloaded = new TaskCompletionSource<IDownload>();
        void OnDownload(object? sender, IDownload download) => downloaded.TrySetResult(download);
        Page.Download += OnDownload;
        try
        {
            await StartLongTaskLogAsync();
            var stopwatch = Stopwatch.StartNew();
            await StartExportAsync(format);
            var export = Page.GetByTestId("model-item").GetByTestId("model-export");
            var shown = await WaitForExportToShowAsync(export);

            // The file, or a failure's snackbar, ends it. The row can't say so: a small export can end
            // before it shows, and CI's slow frames can hold it back past the wait for it (D201).
            var error = Page.Locator(".mud-snackbar").Filter(new() { HasText = "Couldn't export" });
            while (!downloaded.Task.IsCompleted && await error.CountAsync() == 0 && stopwatch.Elapsed < TimeSpan.FromMinutes(30))
            {
                await Task.WhenAny(downloaded.Task, Task.Delay(250));
            }

            var elapsed = $"in {stopwatch.Elapsed.TotalSeconds:F1} s{(shown ? "" : ", before its progress showed")}";
            await Expect(export).ToHaveCountAsync(0, new() { Timeout = Slow });
            var tasks = Longest(await TakeLongTasksAsync());
            if (downloaded.Task.IsCompleted)
            {
                var download = downloaded.Task.Result;
                var file = new FileInfo(await download.PathAsync());
                return ($"{format.ToUpperInvariant()} of {file.Length / (1 << 20)} MB {elapsed} (longest task {tasks})", download);
            }

            await Expect(error).ToContainTextAsync("Out of memory");
            return ($"{format.ToUpperInvariant()} failed {elapsed} (longest task {tasks}): {await error.First.InnerTextAsync()}", null);
        }
        finally
        {
            Page.Download -= OnDownload;
        }
    }

    private async Task StartExportAsync(string format)
    {
        await Page.GetByTestId("model-item").GetByTestId("export-model").Locator("button").ClickAsync();
        await Page.GetByTestId($"export-{format}").ClickAsync();
    }

    /// <summary>
    /// Waits for an export's progress to show in the item. A small model's export (M12's plant-10000)
    /// can end before it does, so a row that never shows isn't a failure: the file, or the failure's
    /// snackbar, is still expected.
    /// </summary>
    private async Task<bool> WaitForExportToShowAsync(ILocator export)
    {
        try
        {
            await Expect(export).ToHaveCountAsync(1, new() { Timeout = 5_000 });
            return true;
        }
        catch (PlaywrightException)
        {
            return false;
        }
    }

    /// <summary>Right-drags the camera round, a move per frame, and returns the frames drawn per second.</summary>
    private async Task<double> OrbitAsync()
    {
        var box = await Page.GetByTestId("viewport").BoundingBoxAsync();
        var (x, y) = (box!.X + box.Width / 2, box.Y + box.Height / 2);
        await Page.Mouse.MoveAsync((float)x, (float)y);
        await Page.Mouse.DownAsync(new MouseDownOptions { Button = MouseButton.Right });
        var frames = await FramesAsync();
        var stopwatch = Stopwatch.StartNew();
        for (var step = 1; step <= 60; step++)
        {
            await Page.Mouse.MoveAsync((float)(x + step * 3), (float)y);
            await Page.EvaluateAsync("() => new Promise(requestAnimationFrame)");
        }

        var fps = (await FramesAsync() - frames) / stopwatch.Elapsed.TotalSeconds;
        await Page.Mouse.UpAsync(new MouseUpOptions { Button = MouseButton.Right });
        await WaitForCameraRestAsync();
        return fps;
    }

    /// <summary>Starts recording the main thread's tasks over 50 ms, where the browser reports them.</summary>
    private async Task StartLongTaskLogAsync() => await Page.EvaluateAsync(LongTaskLog);

    /// <summary>The long tasks since the last call. Waits a moment first: the observer reports them asynchronously.</summary>
    private async Task<double[]?> TakeLongTasksAsync()
    {
        await Page.WaitForTimeoutAsync(500);
        return await Page.EvaluateAsync<double[]?>(
            "() => PerformanceObserver.supportedEntryTypes.includes('longtask') ? window.__longTasks.splice(0) : null");
    }

    private static string Longest(double[]? tasks) =>
        tasks is null ? "not reported" : tasks.Length == 0 ? "none over 50 ms" : $"{tasks.Max():F0} ms of {tasks.Length}";

    private sealed record PartPoint(int Node, double X, double Y);
}
