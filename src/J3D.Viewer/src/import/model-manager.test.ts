import { describe, expect, it, vi } from 'vitest';
import { ModelImportError } from '@j3d/occt/core';
import { EditsDroppedWarning, ModelManager, type ModelManagerListener } from './model-manager.js';
import type { ImportRequest, ImportRunner, ImportTask } from './runner.js';
import { UnusedSidecarReason, type BatchFile } from './sidecars.js';
import type { ImportResult } from './types.js';

interface FakeTask extends ImportTask {
  request: ImportRequest;
  resolve(result?: ImportResult): void;
  reject(error: unknown): void;
  disposals: number;
}

function setup(concurrency = 2) {
  const tasks: FakeTask[] = [];
  const runner: ImportRunner = (request) => {
    let resolve!: (result: ImportResult) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<ImportResult>((res, rej) => ((resolve = res), (reject = rej)));
    const task: FakeTask = {
      request,
      result,
      resolve: (value = loadedResult()) => resolve(value),
      reject,
      disposals: 0,
      dispose() {
        this.disposals++;
      },
    };
    tasks.push(task);
    return task;
  };

  let nextId = 0;
  const manager = new ModelManager(() => runner, concurrency, () => `m${++nextId}`);
  const events: string[] = [];
  const listener: ModelManagerListener = {
    queued: (summary) => events.push(`queued ${summary.id} ${summary.fileName} ${summary.format} ${summary.kind}`),
    progress: (id, phase, fraction) => events.push(`progress ${id} ${phase} ${fraction}`),
    loaded: (model) => events.push(`loaded ${model.summary.id}`),
    failed: (id, error) => events.push(`failed ${id} ${error.code}: ${error.message}`),
    removed: (id) => events.push(`removed ${id}`),
    rejected: (fileName, reason) => events.push(`rejected ${fileName}: ${reason}`),
  };
  manager.subscribe(listener);
  const statuses = () => manager.models.map((m) => `${m.summary.id}:${m.status}`);
  return { manager, tasks, events, statuses };
}

function loadedResult(): ImportResult {
  return {
    content: { kind: 'brep', scene: { nodes: [], instances: [], prototypes: [] } },
    tree: [],
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    stats: { nodes: 0, prototypes: 0, instances: 0, triangles: 0, edges: 0, textures: 0 },
    memoryBytes: 64,
    warnings: [],
  };
}

const files = (...names: string[]): BatchFile[] => names.map((name) => ({ file: new File(['data'], name), path: name }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ModelManager', () => {
  it('queues every model and imports at most two at a time', async () => {
    const { manager, tasks, events, statuses } = setup();
    const summaries = manager.importFiles(files('a.step', 'b.stl', 'c.glb'));

    expect(summaries.map((s) => [s.id, s.format, s.kind, s.sizeBytes])).toEqual([
      ['m1', 'step', 'brep', 4],
      ['m2', 'stl', 'mesh', 4],
      ['m3', 'gltf', 'mesh', 4],
    ]);
    expect(events).toEqual(['queued m1 a.step step brep', 'queued m2 b.stl stl mesh', 'queued m3 c.glb gltf mesh']);
    expect(statuses()).toEqual(['m1:importing', 'm2:importing', 'm3:queued']);

    tasks[0]!.resolve();
    await flush();
    expect(statuses()).toEqual(['m1:loaded', 'm2:importing', 'm3:importing']);
    expect(manager.models[0]!.model?.summary.fileName).toBe('a.step');
    expect(events.at(-1)).toBe('loaded m1');
  });

  it('passes progress on and records the current phase', () => {
    const { manager, tasks, events } = setup();
    manager.importFiles(files('a.step'));
    tasks[0]!.request.onProgress('reading', 0.5);
    tasks[0]!.request.onProgress('parsing', null);

    expect(events.slice(1)).toEqual(['progress m1 reading 0.5', 'progress m1 parsing null']);
    expect(manager.models[0]).toMatchObject({ status: 'importing', phase: 'parsing', fraction: null });
  });

  it('marks a failed import, releases it and starts the next', async () => {
    const { manager, tasks, events, statuses } = setup(1);
    manager.importFiles(files('a.step', 'b.step'));
    tasks[0]!.reject(new ModelImportError('ParseFailed', 'Not a readable STEP file.'));
    await flush();

    expect(events).toContain('failed m1 ParseFailed: Not a readable STEP file.');
    expect(tasks[0]!.disposals).toBe(1);
    expect(statuses()).toEqual(['m1:failed', 'm2:importing']);
  });

  it('reports a runner that throws as an Internal failure', async () => {
    const manager = new ModelManager(() => () => {
      throw new Error('boom');
    });
    const failures: string[] = [];
    manager.subscribe({ failed: (_, error) => failures.push(`${error.code}: ${error.message}`) });
    manager.importFiles(files('a.step'));
    await flush();

    expect(failures).toEqual(['Internal: boom']);
    expect(manager.models.map((m) => m.status)).toEqual(['failed']);
  });

  it('cancels a queued import without starting it', () => {
    const { manager, tasks, events, statuses } = setup(1);
    manager.importFiles(files('a.step', 'b.step'));

    expect(manager.remove('m2')).toBe(true);
    expect(tasks).toHaveLength(1);
    expect(statuses()).toEqual(['m1:importing']);
    expect(events.at(-1)).toBe('removed m2');
  });

  it('cancels a running import, frees its slot and ignores a late result', async () => {
    const { manager, tasks, events, statuses } = setup(1);
    manager.importFiles(files('a.step', 'b.step'));

    manager.remove('m1');
    expect(tasks[0]!.disposals).toBe(1);
    expect(statuses()).toEqual(['m2:importing']);

    tasks[0]!.resolve();
    await flush();
    expect(events).not.toContain('loaded m1');
  });

  it('frees a loaded model when it is removed, and rejects unknown ids', async () => {
    const { manager, tasks, events } = setup();
    manager.importFiles(files('a.step'));
    tasks[0]!.resolve();
    await flush();

    expect(manager.remove('m1')).toBe(true);
    expect(tasks[0]!.disposals).toBe(1);
    expect(events.at(-1)).toBe('removed m1');
    expect(manager.remove('m1')).toBe(false);
    expect(manager.models).toEqual([]);
  });

  it('rejects unsupported files and, once the batch is done, sidecars no model used', async () => {
    const { manager, tasks, events } = setup();
    manager.importFiles(files('scene.gltf', 'scene.bin', 'spare.png', 'notes.txt'));
    expect(events).toEqual(["rejected notes.txt: .txt files aren't supported.", 'queued m1 scene.gltf gltf mesh']);

    expect(tasks[0]!.request.sidecars.find('scene.bin', tasks[0]!.request.path)?.path).toBe('scene.bin');
    tasks[0]!.resolve();
    await flush();
    expect(events.slice(-2)).toEqual(['loaded m1', `rejected spare.png: ${UnusedSidecarReason}`]);
  });

  it('rejects sidecars straight away when the batch has no models', () => {
    const { manager, events } = setup();
    manager.importFiles(files('texture.png'));
    expect(events).toEqual([`rejected texture.png: ${UnusedSidecarReason}`]);
  });

  it("keeps a model's file and the sidecars its import used, not the rest of its batch (D113)", async () => {
    const { manager, tasks } = setup();
    manager.importFiles(files('a.gltf', 'b.gltf', 'a.bin', 'b.bin', 'shared.png'));
    tasks[0]!.request.sidecars.find('a.bin', 'a.gltf');
    tasks[0]!.request.sidecars.find('shared.png', 'a.gltf');
    tasks[1]!.request.sidecars.find('b.bin', 'b.gltf');
    tasks[1]!.request.sidecars.find('missing.png', 'b.gltf');

    expect(manager.sourcesOf('m1')?.map((source) => source.path)).toEqual(['a.gltf', 'a.bin', 'shared.png']);
    expect(manager.sourcesOf('m2')?.map((source) => source.path)).toEqual(['b.gltf', 'b.bin']);
    expect(manager.sourcesOf('unknown')).toBeUndefined();
  });

  it('imports a kept model again under its own id once its files are read (D117)', async () => {
    const { manager, tasks, events, statuses } = setup();
    let read!: (files: BatchFile[]) => void;
    const summary = { id: 'kept', fileName: 'scene.gltf', format: 'gltf', kind: 'mesh', sizeBytes: 4 } as const;

    manager.importStored(summary, new Promise((resolve) => (read = resolve)), [2, 5]);
    manager.importStored(summary, Promise.resolve([]), []); // already listed: ignored
    expect(events).toEqual(['queued kept scene.gltf gltf mesh']);
    expect(statuses()).toEqual(['kept:queued']);
    expect(tasks).toHaveLength(0);

    read([...files('scene.gltf'), { ...files('scene.bin')[0]!, fromFolder: true }]);
    await flush();
    expect(tasks[0]!.request.sidecars.find('scene.bin', 'scene.gltf')?.path).toBe('scene.bin');
    const loaded: string[] = [];
    manager.subscribe({ loaded: (model) => loaded.push(JSON.stringify(model.restored)) });
    tasks[0]!.resolve();
    await flush();

    expect(loaded).toEqual([JSON.stringify({ hidden: [2, 5] })]);
    expect(manager.sourcesOf('kept')?.map((source) => source.path)).toEqual(['scene.gltf', 'scene.bin']);
    expect(events.filter((event) => event.startsWith('rejected'))).toEqual([]);
  });

  it("fails a kept model whose files can't be read, and imports nothing for one removed while they're read", async () => {
    const { manager, tasks, events } = setup();
    const summary = (id: string) => ({ id, fileName: `${id}.step`, format: 'step', kind: 'brep', sizeBytes: 4 }) as const;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manager.importStored(summary('gone'), Promise.reject(new Error('NotFoundError')), []);
    let read!: (files: BatchFile[]) => void;
    manager.importStored(summary('cancelled'), new Promise((resolve) => (read = resolve)), []);
    expect(manager.remove('cancelled')).toBe(true);
    read(files('cancelled.step'));
    await flush();

    expect(events).toContain("failed gone MissingFile: Its kept copy couldn't be read.");
    expect(events).toContain('removed cancelled');
    expect(tasks).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("restores a kept model's edits that fit its tree, with the edited model's counts, and drops those that don't (M14, R25)", async () => {
    const { manager, tasks } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = (): ImportResult => ({
      ...loadedResult(),
      content: {
        kind: 'brep',
        scene: {
          nodes: [
            { name: 'assembly', parent: -1, prototype: -1 },
            { name: 'bolt', parent: 0, prototype: 0 },
          ],
          instances: [{ node: 1, prototype: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
          prototypes: [{ indices: new Uint32Array(6), edges: new Float32Array(12) } as never],
        },
      },
      tree: [
        { name: 'assembly', parent: -1, prototype: -1 },
        { name: 'bolt', parent: 0, prototype: 0 },
      ],
      stats: { nodes: 2, prototypes: 1, instances: 1, triangles: 2, edges: 2, textures: 0 },
    });
    const summary = (id: string) => ({ id, fileName: `${id}.step`, format: 'step', kind: 'brep', sizeBytes: 4 }) as const;
    const copied = { added: [1, 1], children: [{ parent: 0, nodes: [1, 2, 3] }], names: [] };
    const loaded: { id: string; restored: unknown; stats: unknown; warnings: string[] }[] = [];
    manager.subscribe({ loaded: (model) => loaded.push({ id: model.summary.id, restored: model.restored, stats: model.stats, warnings: model.warnings }) });

    manager.importStored(summary('fits'), Promise.resolve(files('fits.step')), [3], [{ node: 2, matrix: [] }], copied);
    manager.importStored(summary('changed'), Promise.resolve(files('changed.step')), [1, 3], [{ node: 2, matrix: [] }], { ...copied, added: [5] });
    await flush();
    tasks.forEach((task) => task.resolve(result()));
    await flush();

    expect(loaded).toEqual([
      {
        id: 'fits',
        restored: { hidden: [3], placements: [{ node: 2, matrix: [] }], edits: copied },
        stats: { nodes: 4, prototypes: 1, instances: 3, triangles: 6, edges: 6, textures: 0 },
        warnings: [],
      },
      {
        id: 'changed',
        restored: { hidden: [1] },
        stats: { nodes: 2, prototypes: 1, instances: 1, triangles: 2, edges: 2, textures: 0 },
        warnings: [EditsDroppedWarning],
      },
    ]);
    warn.mockRestore();
  });

  it("expands a kept model's expanded parts again before checking its edits, and drops them when it can't (M15, R25)", async () => {
    const { manager, tasks, events } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mesh = { indices: new Uint32Array(3), edges: new Float32Array(6) } as never;
    const result = (expand: (node: number) => Promise<never>): ImportResult => ({
      ...loadedResult(),
      content: {
        kind: 'brep',
        scene: {
          nodes: [{ name: 'set', parent: -1, prototype: 0 }],
          instances: [{ node: 0, prototype: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
          prototypes: [mesh],
        },
        expander: { expand },
      },
      tree: [{ name: 'set', parent: -1, prototype: 0 }],
      stats: { nodes: 1, prototypes: 1, instances: 1, triangles: 1, edges: 1, textures: 0 },
    });
    // The set (0) as its assembly (1) of one piece (2).
    const expanded = {
      added: [-1, -1],
      children: [
        { parent: -1, nodes: [1] },
        { parent: 1, nodes: [2] },
      ],
      names: [],
      pieces: [
        { node: 1, expands: 0, piece: -1, name: 'set', part: false },
        { node: 2, expands: 0, piece: 0, name: 'set 1', part: true },
      ],
    };
    const piece = { name: '', parent: -1, prototype: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    const summary = (id: string) => ({ id, fileName: `${id}.step`, format: 'step', kind: 'brep', sizeBytes: 4 }) as const;
    const loaded: { id: string; edits: boolean; prototypes: number; warnings: string[] }[] = [];
    manager.subscribe({
      loaded: (model) =>
        loaded.push({ id: model.summary.id, edits: !!model.restored?.edits, prototypes: model.content.kind === 'brep' ? model.content.scene.prototypes.length : 0, warnings: model.warnings }),
    });

    manager.importStored(summary('fits'), Promise.resolve(files('fits.step')), [], [], expanded);
    manager.importStored(summary('changed'), Promise.resolve(files('changed.step')), [], [], expanded);
    await flush();
    tasks[0]!.resolve(result(async () => ({ pieces: [piece], prototypes: [mesh] }) as never));
    tasks[1]!.resolve(result(() => Promise.reject(new Error('That part has nothing to expand.'))));
    await flush();

    expect(loaded).toEqual([
      { id: 'fits', edits: true, prototypes: 2, warnings: [] },
      { id: 'changed', edits: false, prototypes: 1, warnings: [EditsDroppedWarning] },
    ]);
    // M16 (D203): the expanding is a phase of its own.
    expect(events).toContain('progress fits applying 0');
    warn.mockRestore();
  });

  it('disposes everything without raising events', async () => {
    const { manager, tasks, events } = setup();
    manager.importFiles(files('a.step', 'b.step'));
    tasks[0]!.resolve();
    await flush();
    events.length = 0;

    manager.dispose();
    expect(tasks.map((t) => t.disposals)).toEqual([1, 1]);
    expect(manager.models).toEqual([]);
    expect(events).toEqual([]);
  });
});
