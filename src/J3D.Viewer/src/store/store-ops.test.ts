import { describe, expect, it } from 'vitest';
import type { ModelSummary } from '../import/types';
import { FakeDisk } from './fake-opfs';
import { ChunkBytes, StorageFullError, StoreOps } from './store-ops';
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
    expect(await new StoreOps(disk.root).open()).toEqual({ manifest: null, metas: {} });
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

  it('deletes model folders the manifest no longer lists, and those whose copy never finished', async () => {
    const disk = new FakeDisk();
    const ops = await saved(disk, 'kept', 'deleted');
    await ops.writeManifest({ version: 1, models: [{ id: 'kept', hidden: [] }, { id: 'unfinished', hidden: [] }], camera: null });
    const models = await (await disk.root.getDirectoryHandle('j3d')).getDirectoryHandle('models');
    (await (await models.getDirectoryHandle('unfinished', { create: true })).getFileHandle('0', { create: true })).data = new Uint8Array(5);

    const { manifest, metas } = await new StoreOps(disk.root).open();

    expect(manifest?.models.map((model) => model.id)).toEqual(['kept']);
    expect(Object.keys(metas)).toEqual(['kept']);
    expect([...models.entries.keys()]).toEqual(['kept']);
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
