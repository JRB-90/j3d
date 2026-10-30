import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchFile } from '../import/sidecars.js';
import type { ModelSummary } from '../import/types.js';
import { FakeDisk } from './fake-opfs.js';
import { ModelStore, type ModelStoreOptions, type StoreWorker } from './model-store.js';
import type { StoreRequestMessage, StoreResponse } from './protocol.js';
import { respond, StoreOps, type Estimate } from './store-ops.js';
import type { CameraSnapshot } from './types.js';

const camera: CameraSnapshot = { projection: 'orthographic', position: [100, -100, 100], target: [0, 0, 0], focalOffset: [0, 0, 0], zoom: 2 };

/** The store worker, run in this thread on a fake file system; records each request it answers. */
class FakeWorker implements StoreWorker {
  readonly requests: StoreRequestMessage['type'][] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<StoreResponse>) => void) | null = null;
  private queue = Promise.resolve();
  private readonly ops: Promise<StoreOps>;

  constructor(disk: FakeDisk, unavailable = false, estimate?: Estimate) {
    this.ops = unavailable ? Promise.reject(new DOMException('No private file system.', 'UnknownError')) : Promise.resolve(new StoreOps(disk.root, estimate));
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

/**
 * Web Locks shared by the "tabs" of a test. An answer takes `delay` milliseconds, as on a page too busy to
 * take it: by then a request's signal may have given up.
 */
class FakeLocks {
  readonly held = new Set<string>();
  delay = 0;

  async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
    options.signal?.throwIfAborted();
    if (this.held.has(name)) {
      if (options.ifAvailable) {
        return callback(null);
      }
      throw new Error('This fake only waits for a lock with ifAvailable.');
    }
    this.held.add(name);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.held.delete(name);
    }
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

function openTab(disk: FakeDisk, locks: FakeLocks, options: Partial<ModelStoreOptions> & { unavailable?: boolean; estimate?: Estimate } = {}): Tab {
  const tab: Tab = { store: undefined!, worker: undefined, persist: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)) };
  tab.store = new ModelStore({
    createWorker: () => (tab.worker = new FakeWorker(disk, options.unavailable, options.estimate)),
    locks: locks as unknown as Pick<LockManager, 'request'>,
    persist: tab.persist,
    manifestDelay: 1,
    lockWait: 5,
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
    expect(await first.store.opened).toEqual({ status: 'kept', models: [], camera: null, unreadable: 0 });

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
      unreadable: 0,
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
    expect(await reopened.store.opened).toEqual({ status: 'kept', models: [{ summary: summary('a'), hidden: [] }], camera: null, unreadable: 0 });
    expect(reopened.store.placementsOf('a')).toEqual([
      { node: 2, matrix: moved },
      { node: -1, matrix: frame },
    ]);
    expect(reopened.store.placementsOf('b')).toEqual([]);
  });

  it("keeps each model's edits with it, and forgets them with its moves when they no longer fit (M14, R25)", async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const first = openTab(disk, locks);
    await first.store.opened;
    first.store.setOrder(['a', 'b']);
    await first.store.save(summary('a'), [source('a.step')]);
    await first.store.save(summary('b'), [source('b.step')]);
    const edits = { added: [1], children: [{ parent: 0, nodes: [1, 3] }], names: [{ node: 3, name: 'copy' }] };
    first.store.setEdits('a', edits);
    first.store.setEdits('b', edits);
    first.store.setPlacement('b', 3, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);
    first.store.forgetEdits('b');
    await first.store.idle();
    first.store.dispose();
    await first.store.idle();

    const reopened = openTab(disk, locks);
    await reopened.store.opened;
    expect(reopened.store.editsOf('a')).toEqual(edits);
    expect(reopened.store.editsOf('b')).toBeUndefined();
    expect(reopened.store.placementsOf('b')).toEqual([]);

    reopened.store.setEdits('a', { added: [], children: [], names: [] }); // every edit undone
    expect(reopened.store.editsOf('a')).toBeUndefined();
  });

  it("writes a model's moves and edits to its own files, only when they change (D205)", async () => {
    // M16: after Expand all of the large plant the manifest held 559 KB of them, written on every change.
    const disk = new FakeDisk();
    const tab = openTab(disk, new FakeLocks());
    await tab.store.opened;
    tab.store.setOrder(['a']);
    await tab.store.save(summary('a'), [source('a.step')]);
    const edits = { added: [1], children: [{ parent: 0, nodes: [1, 3] }], names: [] };
    tab.store.setEdits('a', edits);
    tab.store.setPlacement('a', 3, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);
    await tab.store.idle();
    const requests = () => tab.worker!.requests.filter((type) => type === 'edits' || type === 'manifest');
    expect(requests()).toEqual(['edits', 'manifest']); // the copy's and the edits' changes, gathered

    tab.store.setCamera(camera);
    tab.store.setHidden('a', [3]);
    await tab.store.idle();
    expect(requests()).toEqual(['edits', 'manifest', 'manifest']); // no edits written again

    const manifests = Object.entries(disk.files()).filter(([path]) => path.startsWith('j3d/manifest'));
    expect(manifests.every(([, text]) => !text.includes('"edits"') && !text.includes('"placements"'))).toBe(true);
    expect(JSON.parse(disk.files()['j3d/models/a/edits-1.json']!)).toMatchObject({ edits, placements: [{ node: 3 }] });
  });

  it("moves a version 1 manifest's moves and edits to the models' files (D205)", async () => {
    const disk = new FakeDisk();
    const ops = new StoreOps(disk.root);
    await ops.save('a', { summary: summary('a'), files: [{ name: '0', path: 'a.step', type: '', lastModified: 1 }] }, [new Blob(['a'])]);
    const edits = { added: [], children: [], names: [{ node: 1, name: 'Base' }] };
    const placements = [{ node: 2, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }];
    await ops.writeManifest({ version: 1, models: [{ id: 'a', hidden: [], placements, edits }], camera: null });

    const tab = openTab(disk, new FakeLocks());
    await tab.store.opened;
    expect([tab.store.editsOf('a'), tab.store.placementsOf('a')]).toEqual([edits, placements]);
    await tab.store.idle();

    expect(JSON.parse(disk.files()['j3d/models/a/edits-1.json']!)).toMatchObject({ edits, placements });
    const newest = [disk.files()['j3d/manifest-0.json'], disk.files()['j3d/manifest-1.json']].map((text) => JSON.parse(text!)).sort((x, y) => y.seq - x.seq)[0];
    expect(newest).toMatchObject({ version: 2, models: [{ id: 'a', hidden: [] }] });
  });

  it("lists a model it couldn't read in each manifest, so it comes back when it can be read (D200)", async () => {
    const disk = new FakeDisk();
    const ops = new StoreOps(disk.root);
    for (const id of ['a', 'b']) {
      await ops.save(id, { summary: summary(id), files: [{ name: '0', path: `${id}.step`, type: '', lastModified: 1 }] }, [new Blob([id])]);
    }
    await ops.writeManifest({ version: 2, models: [{ id: 'a', hidden: [] }, { id: 'b', hidden: [2] }], camera: null });
    const meta = (await (await (await (await disk.root.getDirectoryHandle('j3d')).getDirectoryHandle('models')).getDirectoryHandle('b')).getFileHandle('meta.json'));
    const intact = meta.data;
    meta.data = intact.slice(0, 5);

    const locks = new FakeLocks();
    const tab = openTab(disk, locks);
    const opened = await tab.store.opened;
    expect([opened.models.map(({ summary }) => summary.id), opened.unreadable]).toEqual([['a'], 1]);
    tab.store.setCamera(camera); // a manifest written without b's meta
    await tab.store.idle();
    tab.store.dispose();
    await tab.store.idle();

    meta.data = intact;
    const reopened = await openTab(disk, locks).store.opened;
    expect(reopened.models).toEqual([{ summary: summary('a'), hidden: [] }, { summary: summary('b'), hidden: [2] }]);
  });

  it('tries a manifest once more when its write fails with room to spare (D200)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const disk = new FakeDisk();
    const tab = openTab(disk, new FakeLocks(), { estimate: () => Promise.resolve({ usage: 0, quota: 1e9 }) });
    await tab.store.opened;
    tab.store.setOrder(['a']);
    await tab.store.save(summary('a'), [source('a.step')]);
    await tab.store.idle();
    const written = tab.worker!.requests.filter((type) => type === 'manifest').length;

    disk.shortWrites = 2; // both tries of the next write come up short
    tab.store.setCamera(camera);
    await tab.store.idle();
    await new Promise((resolve) => setTimeout(resolve, 10)); // the second try, a moment later
    await tab.store.idle();

    expect(tab.worker!.requests.filter((type) => type === 'manifest').length).toBe(written + 2);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toMatchObject({ message: expect.stringContaining('ShortWriteError'), full: false });
    const newest = [disk.files()['j3d/manifest-0.json'], disk.files()['j3d/manifest-1.json']].map((text) => JSON.parse(text!)).sort((x, y) => y.seq - x.seq)[0];
    expect(newest.camera).toEqual(camera);
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

    expect(await second.store.opened).toEqual({ status: 'otherTab', models: [], camera: null, unreadable: 0 });
    expect(second.worker).toBeUndefined();
    expect(await second.store.save(summary('x'), [source('x.step')])).toBe('notKept');
    expect(second.store.state.status).toBe('otherTab');

    first.store.dispose();
    await first.store.idle();
    expect((await openTab(disk, locks).store.opened).status).toBe('kept');
  });

  it("doesn't take a page still going away for a second tab (R35, D276)", async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const first = openTab(disk, locks);
    await first.store.opened;
    await first.store.save(summary('a'), [source('a.step')]);
    first.store.setOrder(['a']);
    await first.store.idle();

    const reloaded = openTab(disk, locks, { lockWait: 10_000 });
    first.store.dispose();

    const opened = await reloaded.store.opened;
    expect(opened.status).toBe('kept');
    expect(opened.models.map(({ summary }) => summary.id)).toEqual(['a']);
  });

  it('takes a free lock however late the answer comes, as on a page too busy to take it (D276)', async () => {
    const locks = new FakeLocks();
    locks.delay = 20;

    expect((await openTab(new FakeDisk(), locks, { lockWait: 1 }).store.opened).status).toBe('kept');
  });

  it("is unavailable where the browser gives the page no private file system", async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const locks = new FakeLocks();
    const tab = openTab(new FakeDisk(), locks, { unavailable: true });

    expect(await tab.store.opened).toEqual({ status: 'unavailable', models: [], camera: null, unreadable: 0 });
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

describe('ModelStore options (D256)', () => {
  it('keeps a named store in its own folder under its own lock, apart from another on the origin', async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const first = openTab(disk, locks, { name: 'first' });
    const second = openTab(disk, locks, { name: 'second' });

    expect((await first.store.opened).status).toBe('kept');
    expect((await second.store.opened).status).toBe('kept');
    expect(locks.held).toEqual(new Set(['first-store', 'second-store']));

    await first.store.save(summary('a'), [source('a.step')]);
    await second.store.save(summary('b'), [source('b.step')]);

    const files = Object.keys(disk.files());
    expect(files).toContain('first/models/a/0');
    expect(files).toContain('second/models/b/0');
    first.store.dispose();
    second.store.dispose();
  });

  it('is j3d when no name is given, so the app finds what it kept', async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const tab = openTab(disk, locks);

    await tab.store.opened;
    await tab.store.save(summary('a'), [source('a.step')]);

    expect(locks.held).toEqual(new Set(['j3d-store']));
    expect(Object.keys(disk.files())).toContain('j3d/models/a/0');
    tab.store.dispose();
  });

  it('keeps nothing when off: no worker, no lock and no files', async () => {
    const disk = new FakeDisk();
    const locks = new FakeLocks();
    const tab = openTab(disk, locks, { off: true });

    expect(await tab.store.opened).toEqual({ status: 'unavailable', models: [], camera: null, unreadable: 0 });
    expect(await tab.store.save(summary('a'), [source('a.step')])).toBe('notKept');

    expect(tab.worker).toBeUndefined();
    expect(locks.held.size).toBe(0);
    expect(disk.files()).toEqual({});
    tab.store.dispose();
  });
});
