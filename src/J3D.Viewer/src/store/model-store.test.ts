import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchFile } from '../import/sidecars';
import type { ModelSummary } from '../import/types';
import { FakeDisk } from './fake-opfs';
import { ModelStore, type ModelStoreOptions, type StoreWorker } from './model-store';
import type { StoreRequestMessage, StoreResponse } from './protocol';
import { respond, StoreOps } from './store-ops';
import type { CameraSnapshot } from './types';

const camera: CameraSnapshot = { projection: 'orthographic', position: [100, -100, 100], target: [0, 0, 0], focalOffset: [0, 0, 0], zoom: 2 };

/** The store worker, run in this thread on a fake file system; records each request it answers. */
class FakeWorker implements StoreWorker {
  readonly requests: StoreRequestMessage['type'][] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<StoreResponse>) => void) | null = null;
  private queue = Promise.resolve();
  private readonly ops: Promise<StoreOps>;

  constructor(disk: FakeDisk, unavailable = false) {
    this.ops = unavailable ? Promise.reject(new DOMException('No private file system.', 'UnknownError')) : Promise.resolve(new StoreOps(disk.root));
    this.ops.catch(() => {});
  }

  postMessage(message: StoreRequestMessage): void {
    this.requests.push(message.type);
    this.queue = this.queue.then(async () => {
      const response = await respond(this.ops, message);
      if (!this.terminated) {
        this.onmessage?.({ data: response } as MessageEvent<StoreResponse>);
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Web Locks with `ifAvailable`, shared by the "tabs" of a test. */
class FakeLocks {
  readonly held = new Set<string>();

  request(name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
    if (this.held.has(name)) {
      return Promise.resolve(callback(null));
    }
    this.held.add(name);
    return Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).finally(() => this.held.delete(name));
  }
}

function summary(id: string, fileName = `${id}.step`): ModelSummary {
  return { id, fileName, format: 'step', kind: 'brep', sizeBytes: 4 };
}

function source(path: string, text = path): BatchFile {
  return { file: new File([text], path.slice(path.lastIndexOf('/') + 1), { type: 'model/test', lastModified: 7 }), path };
}

interface Tab {
  store: ModelStore;
  worker: FakeWorker | undefined;
  persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
}

function openTab(disk: FakeDisk, locks: FakeLocks, options: Partial<ModelStoreOptions> & { unavailable?: boolean } = {}): Tab {
  const tab: Tab = { store: undefined!, worker: undefined, persist: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)) };
  tab.store = new ModelStore({
    createWorker: () => (tab.worker = new FakeWorker(disk, options.unavailable)),
    locks: locks as unknown as Pick<LockManager, 'request'>,
    persist: tab.persist,
    manifestDelay: 1,
    ...options,
  });
  return tab;
}

describe('ModelStore', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps loaded models in the order .NET lists them, with their hidden parts and the camera', async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const first = openTab(disk, locks);
    expect(await first.store.opened).toEqual({ status: 'kept', models: [], camera: null });

    first.store.setOrder(['b', 'pending', 'a']);
    expect(await first.store.save(summary('a'), [source('a.step')])).toBe('kept');
    expect(await first.store.save(summary('b'), [source('b.step')])).toBe('kept');
    first.store.setHidden('a', [3, 4]);
    first.store.setCamera(camera);
    await first.store.idle();
    expect(first.persist).toHaveBeenCalledOnce(); // on the first copy (D115)
    first.store.dispose();
    await first.store.idle();
    expect(first.worker!.terminated).toBe(true);
    expect(locks.held.size).toBe(0);

    const reopened = openTab(disk, locks);
    expect(await reopened.store.opened).toEqual({
      status: 'kept',
      models: [
        { summary: summary('b'), hidden: [] },
        { summary: summary('a'), hidden: [3, 4] },
      ],
      camera,
    });
    expect(reopened.store.has('a')).toBe(true);
  });

  it('keeps the order .NET gave while the store was still opening', async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const tab = openTab(disk, locks);
    tab.store.setOrder(['a']); // a model imported at once, before the store has opened
    await tab.store.opened;
    await tab.store.save(summary('a'), [source('a.step')]);
    await tab.store.idle();
    tab.store.dispose();
    await tab.store.idle();

    expect((await openTab(disk, locks).store.opened).models).toEqual([{ summary: summary('a'), hidden: [] }]);
  });

  it("keeps each model's moves with it, the model's own frame too, and drops them with the model (M13, D145)", async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const first = openTab(disk, locks);
    await first.store.opened;
    first.store.setOrder(['a', 'b']);
    await first.store.save(summary('a'), [source('a.step')]);
    await first.store.save(summary('b'), [source('b.step')]);
    const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
    const frame = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 7, 0, 1];
    first.store.setPlacement('a', 2, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]);
    first.store.setPlacement('a', 2, moved); // the latest placement replaces the last
    first.store.setPlacement('a', -1, frame);
    first.store.setPlacement('b', 3, moved);
    first.store.delete('b');
    await first.store.idle();
    first.store.dispose();
    await first.store.idle();

    const reopened = openTab(disk, locks);
    expect(await reopened.store.opened).toEqual({ status: 'kept', models: [{ summary: summary('a'), hidden: [] }], camera: null });
    expect(reopened.store.placementsOf('a')).toEqual([
      { node: 2, matrix: moved },
      { node: -1, matrix: frame },
    ]);
    expect(reopened.store.placementsOf('b')).toEqual([]);
  });

  it('gathers changes into one manifest write', async () => {
    const tab = openTab(new FakeDisk(), new FakeLocks());
    await tab.store.opened;
    await tab.store.save(summary('a'), [source('a.step')]);
    await tab.store.idle();
    const written = tab.worker!.requests.filter((type) => type === 'manifest').length;

    tab.store.setOrder(['a']);
    tab.store.setHidden('a', [1]);
    tab.store.setCamera(camera);
    tab.store.setHidden('unknown', [1]); // not kept: no write of its own
    await tab.store.idle();

    expect(tab.worker!.requests.filter((type) => type === 'manifest').length).toBe(written + 1);
  });

  it('keeps nothing in a second tab while the first holds the store (D109)', async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const first = openTab(disk, locks);
    await first.store.opened;
    const second = openTab(disk, locks);

    expect(await second.store.opened).toEqual({ status: 'otherTab', models: [], camera: null });
    expect(second.worker).toBeUndefined();
    expect(await second.store.save(summary('x'), [source('x.step')])).toBe('notKept');
    expect(second.store.state.status).toBe('otherTab');

    first.store.dispose();
    await first.store.idle();
    expect((await openTab(disk, locks).store.opened).status).toBe('kept');
  });

  it("is unavailable where the browser gives the page no private file system", async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const locks = new FakeLocks();
    const tab = openTab(new FakeDisk(), locks, { unavailable: true });

    expect(await tab.store.opened).toEqual({ status: 'unavailable', models: [], camera: null });
    expect(info).toHaveBeenCalledOnce();
    expect(tab.worker!.terminated).toBe(true);
    expect(locks.held.size).toBe(0); // another tab may yet keep its models
    expect(await tab.store.save(summary('a'), [source('a.step')])).toBe('notKept');
  });

  it('reports a copy that does not fit and never lists it', async () => {
    const disk = new FakeDisk(1000);
    const tab = openTab(disk, new FakeLocks());
    await tab.store.opened;
    tab.store.setOrder(['big']);

    expect(await tab.store.save(summary('big'), [source('big.step', 'x'.repeat(2000))])).toBe('full');
    await tab.store.idle();

    expect(tab.store.state.stored).toEqual([]);
    expect(Object.keys(disk.files()).some((path) => path.includes('big'))).toBe(false);
  });

  it('does not list a model deleted while it was being copied', async () => {
    const disk = new FakeDisk();
    const tab = openTab(disk, new FakeLocks());
    await tab.store.opened;
    tab.store.setOrder(['a']);

    const saving = tab.store.save(summary('a'), [source('a.step')]);
    tab.store.delete('a');
    await saving;
    await tab.store.idle();

    expect(tab.store.has('a')).toBe(false);
    expect(Object.keys(disk.files()).some((path) => path.startsWith('j3d/models/a'))).toBe(false);
  });

  it('loads a kept model as files named and pathed as they were imported', async () => {
    const tab = openTab(new FakeDisk(), new FakeLocks());
    await tab.store.opened;
    await tab.store.save(summary('g', 'scene.gltf'), [source('scenes/scene.gltf', '{}'), source('scenes/textures/wood.png', 'png')]);

    const [model, texture] = await tab.store.load('g');

    expect([model!.path, model!.file.name, model!.fromFolder]).toEqual(['scenes/scene.gltf', 'scene.gltf', undefined]);
    expect([texture!.path, texture!.file.name, texture!.fromFolder]).toEqual(['scenes/textures/wood.png', 'wood.png', true]);
    expect([await model!.file.text(), texture!.file.type, texture!.file.lastModified]).toEqual(['{}', 'model/test', 7]);
  });

  it('clears everything kept (D110)', async () => {
    const disk = new FakeDisk();
    const tab = openTab(disk, new FakeLocks());
    await tab.store.opened;
    tab.store.setOrder(['a']);
    await tab.store.save(summary('a'), [source('a.step')]);
    await tab.store.idle();

    tab.store.clear();
    await tab.store.idle();

    expect(disk.files()).toEqual({});
    expect(tab.store.state).toMatchObject({ stored: [], order: [] });
  });
});
