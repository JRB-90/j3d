import { describe, expect, it } from 'vitest';
import type { ModelSummary } from '../import/types';
import { FakeDisk } from './fake-opfs';
import { ChunkBytes, ShortWriteError, StorageFullError, StoreOps } from './store-ops';
import type { CameraSnapshot, StoredMeta } from './types';

const camera: CameraSnapshot = { projection: 'perspective', position: [1, 2, 3], target: [0, 0, 0], focalOffset: [0, 0, 0], zoom: 1 };

function summary(id: string, fileName = `${id}.step`): ModelSummary {
  return { id, fileName, format: 'step', kind: 'brep', sizeBytes: 4 };
}

function meta(id: string, ...paths: string[]): StoredMeta {
  return {
    summary: summary(id),
    files: (paths.length > 0 ? paths : [`${id}.step`]).map((path, index) => ({ name: String(index), path, type: '', lastModified: 1 })),
  };
}

async function saved(disk: FakeDisk, ...ids: string[]): Promise<StoreOps> {
  const ops = new StoreOps(disk.root);
  for (const id of ids) {
    await ops.save(id, meta(id), [new Blob([`${id} data`])]);
  }
  return ops;
}

describe('StoreOps', () => {
  it('opens an empty store', async () => {
    const disk = new FakeDisk();
    expect(await new StoreOps(disk.root).open()).toEqual({ manifest: null, metas: {}, edits: {}, unreadable: [] });
  });

  it("copies a model's files and then its meta, closing every handle", async () => {
    const disk = new FakeDisk();
    const ops = new StoreOps(disk.root);

    await ops.save('a', meta('a', 'scene.gltf', 'textures/wood.png'), [new Blob(['gltf']), new Blob(['png'])]);

    const files = disk.files();
    expect(files['j3d/models/a/0']).toBe('gltf');
    expect(files['j3d/models/a/1']).toBe('png');
    expect(JSON.parse(files['j3d/models/a/meta.json']!)).toEqual(meta('a', 'scene.gltf', 'textures/wood.png'));
    expect(disk.closed).toBe(disk.opened);
  });

  it('streams a file larger than one chunk in pieces', async () => {
    const disk = new FakeDisk();
    const bytes = new Uint8Array(ChunkBytes * 2 + 3);
    for (let index = 0; index < bytes.length; index += 4096) {
      bytes[index] = (index / 4096) % 251;
    }

    await new StoreOps(disk.root).save('a', meta('a'), [new Blob([bytes])]);

    const stored = (await (await (await (await disk.root.getDirectoryHandle('j3d')).getDirectoryHandle('models')).getDirectoryHandle('a')).getFileHandle('0')).data;
    expect(stored.length).toBe(bytes.length);
    expect(stored.every((value, index) => value === bytes[index])).toBe(true);
    expect(disk.writes).toEqual([ChunkBytes, ChunkBytes, 3, expect.any(Number)]); // three pieces, then the meta
  });

  it('writes the manifest to its two files in turn, and opens the newest', async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'a', 'b');

    await ops.writeManifest({ version: 1, models: [{ id: 'a', hidden: [] }], camera: null });
    await ops.writeManifest({ version: 1, models: [{ id: 'b', hidden: [3] }, { id: 'a', hidden: [1] }], camera });

    expect(JSON.parse(disk.files()['j3d/manifest-1.json']!).seq).toBe(1);
    expect(JSON.parse(disk.files()['j3d/manifest-0.json']!).seq).toBe(2);
    const { manifest, metas } = await new StoreOps(disk.root).open();
    expect(manifest).toEqual({ version: 1, seq: 2, models: [{ id: 'b', hidden: [3] }, { id: 'a', hidden: [1] }], camera });
    expect(Object.keys(metas).sort()).toEqual(['a', 'b']);
  });

  it('falls back to the other manifest when the newer one was cut short', async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'a');
    await ops.writeManifest({ version: 1, models: [{ id: 'a', hidden: [] }], camera: null });
    await ops.writeManifest({ version: 1, models: [], camera: null });
    const newer = await (await disk.root.getDirectoryHandle('j3d')).getFileHandle('manifest-0.json');
    newer.data = newer.data.slice(0, 10);

    const reopened = new StoreOps(disk.root);
    const { manifest } = await reopened.open();
    expect(manifest?.models).toEqual([{ id: 'a', hidden: [] }]);

    await reopened.writeManifest({ version: 1, models: [], camera: null }); // over the broken one, with a higher seq
    expect(JSON.parse(disk.files()['j3d/manifest-0.json']!).seq).toBe(2);
  });

  it('deletes model folders the manifest no longer lists, and copies that never finished', async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'kept', 'deleted');
    await ops.writeManifest({ version: 2, models: [{ id: 'kept', hidden: [] }], camera: null });
    const models = await (await disk.root.getDirectoryHandle('j3d')).getDirectoryHandle('models');
    (await (await models.getDirectoryHandle('unfinished', { create: true })).getFileHandle('0', { create: true })).data = new Uint8Array(5);

    const { manifest, metas, unreadable } = await new StoreOps(disk.root).open();

    expect(manifest?.models.map((model) => model.id)).toEqual(['kept']);
    expect(Object.keys(metas)).toEqual(['kept']);
    expect(unreadable).toEqual([]);
    expect([...models.entries.keys()]).toEqual(['kept']);
  });

  it('keeps a listed model whose meta it cannot read, for the next visit (D200)', async () => {
    // Found in M16: deleting it lost a kept model, its meta unreadable for a reason never found.
    const disk = new FakeDisk();
    const ops = await saved(disk, 'kept', 'damaged');
    await ops.writeManifest({ version: 2, models: [{ id: 'kept', hidden: [] }, { id: 'damaged', hidden: [4] }], camera: null });
    const models = await (await disk.root.getDirectoryHandle('j3d')).getDirectoryHandle('models');
    (await (await models.getDirectoryHandle('damaged')).getFileHandle('meta.json')).data = new TextEncoder().encode('{"summa');

    const { manifest, metas, unreadable } = await new StoreOps(disk.root).open();

    expect(manifest?.models.map((model) => model.id)).toEqual(['kept']);
    expect(Object.keys(metas)).toEqual(['kept']);
    expect(unreadable).toEqual([{ id: 'damaged', hidden: [4] }]);
    expect([...models.entries.keys()].sort()).toEqual(['damaged', 'kept']);
    expect(disk.files()['j3d/models/damaged/0']).toBe('damaged data');
  });

  it("keeps each model's moves and edits in its own two files, the newer read (D205)", async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'a', 'b');
    const edits = { added: [1], children: [{ parent: 0, nodes: [1, 3] }], names: [] };
    const placements = [{ node: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }];
    await ops.writeEdits('a', { placements: [] , edits });
    await ops.writeEdits('a', { placements, edits });
    await ops.writeEdits('b', { placements });
    await ops.writeEdits('b', null); // every edit undone: the files go
    await ops.writeManifest({ version: 2, models: [{ id: 'a', hidden: [] }, { id: 'b', hidden: [] }], camera: null });

    expect(JSON.parse(disk.files()['j3d/models/a/edits-1.json']!).seq).toBe(1);
    expect(JSON.parse(disk.files()['j3d/models/a/edits-0.json']!).seq).toBe(2);
    expect(Object.keys(disk.files()).some((path) => path.startsWith('j3d/models/b/edits'))).toBe(false);
    const reopened = new StoreOps(disk.root);
    expect((await reopened.open()).edits).toEqual({ a: { placements, edits } });

    // The seq carries on from the files after a reopen.
    await reopened.writeEdits('a', { placements: [], edits });
    expect(JSON.parse(disk.files()['j3d/models/a/edits-1.json']!).seq).toBe(3);
  });

  it('reads the moves and edits a version 1 manifest held (before M16)', async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'a');
    const edits = { added: [], children: [], names: [{ node: 1, name: 'Base' }] };
    const placements = [{ node: -1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 7, 0, 1] }];
    await ops.writeManifest({ version: 1, models: [{ id: 'a', hidden: [2], placements, edits }], camera: null });

    const { manifest, edits: kept } = await new StoreOps(disk.root).open();

    expect(manifest?.version).toBe(1);
    expect(kept).toEqual({ a: { placements, edits } });
  });

  it('tries a short write once more before giving up on it (D200)', async () => {
    const disk = new FakeDisk();
    disk.shortWrites = 1; // the next write stops half-way
    const ops = new StoreOps(disk.root, () => Promise.resolve({ usage: 0, quota: 1e9 }));

    await ops.save('a', meta('a'), [new Blob(['a data'])]);

    expect(disk.files()['j3d/models/a/0']).toBe('a data');
  });

  it('reports a write that keeps coming up short with room to spare as what it is, not a full store', async () => {
    const disk = new FakeDisk();
    disk.shortWrites = Infinity;
    const ops = new StoreOps(disk.root, () => Promise.resolve({ usage: 10, quota: 1e9 }));

    await expect(ops.writeManifest({ version: 2, models: [], camera: null })).rejects.toBeInstanceOf(ShortWriteError);
    await expect(ops.save('a', meta('a'), [new Blob(['a data'])])).rejects.toBeInstanceOf(ShortWriteError);
    expect(disk.closed).toBe(disk.opened);
  });

  it.each(['throw', 'short'] as const)('reports a copy that runs out of space (%s) and deletes what it wrote', async (fullWrites) => {
    const disk = new FakeDisk(1000, fullWrites);
    const ops = await saved(disk, 'small');

    await expect(ops.save('big', meta('big'), [new Blob([new Uint8Array(2000)])])).rejects.toBeInstanceOf(StorageFullError);

    expect(Object.keys(disk.files()).filter((path) => path.includes('/big'))).toEqual([]);
    expect(disk.closed).toBe(disk.opened);
    await expect(ops.load('small')).resolves.toBeDefined();
  });

  it('loads a model as files named by the store, deletes one, and clears everything', async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'a', 'b');

    const { meta: loaded, files } = await ops.load('a');
    expect(loaded.summary.id).toBe('a');
    expect(await files[0]!.text()).toBe('a data');

    await ops.delete('a');
    await ops.delete('a'); // already gone
    await expect(ops.load('a')).rejects.toThrow();

    await ops.clear();
    expect(disk.files()).toEqual({});
    await ops.save('c', meta('c'), [new Blob(['c'])]); // usable again after a clear
    expect(Object.keys(disk.files())).toContain('j3d/models/c/0');
  });
});
