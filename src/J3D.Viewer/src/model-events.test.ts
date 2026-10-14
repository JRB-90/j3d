import { Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelManagerListener } from './import/model-manager';
import type { LoadedModel, ModelSummary } from './import/types';
import type { DotNetObjectReference } from './interop';
import { forwardModelEvents } from './model-events';

function setup(invoke: (method: string, ...args: unknown[]) => Promise<unknown> = () => Promise.resolve()) {
  const listeners = new Set<ModelManagerListener>();
  const models = {
    subscribe(listener: ModelManagerListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const calls: [string, ...unknown[]][] = [];
  const dotnet: DotNetObjectReference = {
    invokeMethodAsync: <T>(method: string, ...args: unknown[]) => {
      calls.push([method, ...args]);
      return invoke(method, ...args) as Promise<T>;
    },
  };
  const unsubscribe = forwardModelEvents(models, dotnet);
  const emit = (event: (listener: ModelManagerListener) => void) => listeners.forEach(event);
  return { calls, emit, unsubscribe, listeners };
}

const summary: ModelSummary = { id: 'm1', fileName: 'part.step', format: 'step', kind: 'brep', sizeBytes: 1234 };

describe('forwardModelEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('calls .NET for each model event with the interop contract’s arguments', () => {
    const { calls, emit } = setup();

    emit((l) => l.queued?.(summary));
    emit((l) => l.progress?.('m1', 'meshing', 0.5));
    emit((l) => l.progress?.('m1', 'parsing', null));
    emit((l) => l.failed?.('m2', { code: 'ParseFailed', message: 'Not a readable STEP file.' }));
    emit((l) => l.removed?.('m1'));
    emit((l) => l.rejected?.('notes.txt', ".txt files aren't supported."));

    expect(calls).toEqual([
      ['OnModelQueued', summary],
      ['OnModelProgress', 'm1', 'meshing', 0.5],
      ['OnModelProgress', 'm1', 'parsing', null],
      ['OnModelFailed', 'm2', { code: 'ParseFailed', message: 'Not a readable STEP file.' }],
      ['OnModelRemoved', 'm1'],
      ['OnImportRejected', 'notes.txt', ".txt files aren't supported."],
    ]);
  });

  it('sends a loaded model’s tree, stats, bounds, memory and warnings, but not its geometry', () => {
    vi.useFakeTimers();
    const { calls, emit } = setup();
    const model: LoadedModel = {
      summary,
      content: { kind: 'mesh', root: new Object3D() },
      tree: [
        { name: 'assembly', parent: -1, prototype: -1 },
        { name: 'part', parent: 0, prototype: 0 },
      ],
      bounds: { min: [0, 0, 0], max: [1, 2, 3] },
      stats: { nodes: 1, prototypes: 1, instances: 1, triangles: 12, edges: 0, textures: 0 },
      memoryBytes: 4096,
      warnings: ['A texture is missing.'],
    };

    emit((l) => l.loaded?.(model));
    vi.runAllTimers();

    expect(calls).toEqual([
      [
        'OnModelLoaded',
        'm1',
        {
          tree: { names: ['assembly', 'part'], parents: [-1, 0], prototypes: [-1, 0] },
          stats: model.stats,
          bounds: model.bounds,
          memoryBytes: 4096,
          warnings: ['A texture is missing.'],
        },
      ],
    ]);
  });

  it('sends OnModelLoaded in a task of its own, with later calls waiting behind it in order', () => {
    vi.useFakeTimers();
    const { calls, emit } = setup();

    emit((l) => l.loaded?.(loaded('m1')));
    emit((l) => l.removed?.('m1'));
    emit((l) => l.queued?.(summary));
    expect(calls).toEqual([]);

    vi.runAllTimers();
    expect(calls.map(([method]) => method)).toEqual(['OnModelLoaded', 'OnModelRemoved', 'OnModelQueued']);

    emit((l) => l.removed?.('m2'));
    expect(calls.at(-1)).toEqual(['OnModelRemoved', 'm2']); // nothing waiting: straight away
  });

  it('drops calls still waiting when unsubscribed', () => {
    vi.useFakeTimers();
    const { calls, emit, unsubscribe } = setup();

    emit((l) => l.loaded?.(loaded('m1')));
    unsubscribe();
    vi.runAllTimers();

    expect(calls).toEqual([]);
  });

  it('logs a call that .NET rejects rather than throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { emit } = setup(() => Promise.reject(new Error('boom')));

    emit((l) => l.removed?.('m1'));
    await Promise.resolve();
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith("J3D: .NET's OnModelRemoved failed.", expect.any(Error));
  });

  it('stops forwarding once unsubscribed', () => {
    const { calls, emit, unsubscribe, listeners } = setup();

    unsubscribe();
    emit((l) => l.removed?.('m1'));

    expect(listeners.size).toBe(0);
    expect(calls).toEqual([]);
  });
});

function loaded(id: string): LoadedModel {
  return {
    summary: { ...summary, id },
    content: { kind: 'mesh', root: new Object3D() },
    tree: [],
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    stats: { nodes: 0, prototypes: 0, instances: 0, triangles: 0, edges: 0, textures: 0 },
    memoryBytes: 0,
    warnings: [],
  };
}
