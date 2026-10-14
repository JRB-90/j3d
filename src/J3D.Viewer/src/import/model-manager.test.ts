import { describe, expect, it } from 'vitest';
import { ModelImportError } from './errors';
import { ModelManager, type ModelManagerListener } from './model-manager';
import type { ImportRequest, ImportRunner, ImportTask } from './runner';
import { UnusedSidecarReason, type BatchFile } from './sidecars';
import type { ImportResult } from './types';

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
