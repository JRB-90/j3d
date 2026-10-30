import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelImportError } from './errors.js';
import { openModel } from './open-model.js';
import type { ModelWorkerRequest, ModelWorkerResponse } from './protocol.js';
import { ExportCancelledError } from './types.js';

/** A model worker that answers only when the test says so. */
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: ModelWorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: ModelWorkerRequest[] = [];
  terminated = 0;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.last = this;
  }

  postMessage(message: ModelWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated++;
  }

  answer(data: ModelWorkerResponse): void {
    this.onmessage?.({ data });
  }
}

const loaded: ModelWorkerResponse = {
  type: 'loaded',
  scene: { nodes: [], instances: [], prototypes: [] },
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  stats: { nodes: 0, prototypes: 0, instances: 0, triangles: 0, edges: 0, textures: 0 },
  memoryBytes: 1024,
};

const worker = async () => {
  await vi.waitFor(() => expect(FakeWorker.last?.posted.length).toBeGreaterThan(0));
  return FakeWorker.last;
};

describe('openModel', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('fetch', async () => new Response(new ArrayBuffer(0)));
    vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue({} as WebAssembly.Module);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeWorker.last = undefined as unknown as FakeWorker;
  });

  it('opens a file in a worker of its own, named for it, and reports its progress', async () => {
    const progress: unknown[] = [];
    const opening = openModel(new File(['x'], 'part.step'), 'step', { onProgress: (phase, fraction) => progress.push([phase, fraction]) });
    const fake = await worker();

    expect(fake.url.href).toMatch(/model-worker\.js$/);
    expect(fake.options).toMatchObject({ type: 'module', name: 'J3D model: part.step' });
    expect(fake.posted[0]).toMatchObject({ type: 'import', fileName: 'part.step', format: 'step' });

    fake.answer({ type: 'progress', phase: 'parsing', fraction: null });
    fake.answer(loaded);
    const model = await opening;

    expect(progress).toEqual([['parsing', null]]);
    expect(model.memoryBytes).toBe(1024);
    expect(fake.terminated).toBe(0);
  });

  it("names a Blob that has no name of its own by what it's opened as", async () => {
    void openModel(new Blob(['x']), 'iges').catch(() => {});
    expect((await worker()).posted[0]).toMatchObject({ fileName: 'model.iges' });
  });

  it('rejects with the code the worker gave, and ends the worker', async () => {
    const opening = openModel(new File(['x'], 'bad.step'), 'step');
    const fake = await worker();
    fake.answer({ type: 'failed', error: { code: 'ParseFailed', message: 'Not a STEP file.' } });

    const error = await opening.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelImportError);
    expect(error).toMatchObject({ code: 'ParseFailed', message: 'Not a STEP file.' });
    expect(fake.terminated).toBe(1);
  });

  it('maps a worker that dies to out of memory when that is why', async () => {
    const opening = openModel(new File(['x'], 'huge.step'), 'step');
    const fake = await worker();
    fake.onerror?.({ message: 'Uncaught RangeError: WebAssembly.Memory(): could not allocate memory', preventDefault: () => {} });

    await expect(opening).rejects.toMatchObject({ code: 'OutOfMemory' });
  });

  it('stops when its signal aborts, rejecting with the reason', async () => {
    const cancel = new AbortController();
    const opening = openModel(new File(['x'], 'part.step'), 'step', { signal: cancel.signal });
    const fake = await worker();
    cancel.abort(new Error('Cancelled.'));

    await expect(opening).rejects.toThrow('Cancelled.');
    expect(fake.terminated).toBe(1);
  });

  it('starts no worker when already aborted', async () => {
    await expect(openModel(new File(['x'], 'part.step'), 'step', { signal: AbortSignal.abort(new Error('No.')) })).rejects.toThrow('No.');
    expect(FakeWorker.last).toBeUndefined();
  });

  it('answers queries by id, and disposing ends the worker and rejects exports in progress', async () => {
    const opening = openModel(new File(['x'], 'part.step'), 'step');
    const fake = await worker();
    fake.answer(loaded);
    const model = await opening;

    const measuring = model.measure.exportEntity({ kind: 0, prototype: 0, index: 0, matrix: [] } as never);
    const { id } = fake.posted.at(-1) as { id: number };
    fake.answer({ type: 'measured', id, result: 'brep text' });
    await expect(measuring).resolves.toBe('brep text');

    const exporting = model.exporter.export('step');
    model.dispose();
    await expect(exporting).rejects.toBeInstanceOf(ExportCancelledError);
    expect(fake.terminated).toBe(1);
  });

  it('lets a test watch the worker and hold the import', async () => {
    const release = vi.fn();
    const onHeld = vi.fn();
    const cancel = new AbortController();
    const opening = openModel(new File(['x'], 'part.step'), 'step', {
      signal: cancel.signal,
      testing: { track: () => release, holdBeforeImport: () => true, onHeld },
    });
    const fake = await worker();
    expect(fake.posted[0]).toMatchObject({ holdBeforeImport: true });

    fake.answer({ type: 'held' });
    expect(onHeld).toHaveBeenCalledOnce();

    cancel.abort();
    await opening.catch(() => {});
    expect(release).toHaveBeenCalledOnce();
    expect(fake.terminated).toBe(0); // the tracker's to end
  });
});
