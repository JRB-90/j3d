import type { ModelId } from '../import/types';
import type { StoreRequest, StoreRequestMessage, StoreResponse } from './protocol';
import type { Manifest, StoredMeta } from './types';

// The parts of the origin private file system the store worker uses (docs/plan.md §6.2, D112).
// Declared here because TypeScript's DOM library lacks the worker-only synchronous access handle,
// and so tests can stand in for them.

export interface SyncHandle {
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

export interface FileHandle {
  getFile(): Promise<File>;
  createSyncAccessHandle(): Promise<SyncHandle>;
}

export interface DirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
}

export const RootName = 'j3d';
export const ModelsName = 'models';
export const ManifestNames = ['manifest-0.json', 'manifest-1.json'] as const;
export const MetaName = 'meta.json';
/** Files are copied this many bytes at a time, so none is ever whole in memory. */
export const ChunkBytes = 4 * 1024 * 1024;

/** Thrown when a write doesn't fit the origin's quota (D115). */
export class StorageFullError extends Error {
  constructor() {
    super("The browser's storage for this page is full.");
    this.name = 'StorageFullError';
  }
}

/**
 * The store's file operations, run one at a time in the store worker (D112). Layout under the
 * origin's root: `j3d/manifest-0.json` and `j3d/manifest-1.json` (written in turn), and
 * `j3d/models/<id>/` holding a model's files (`0`, `1`, …) and its `meta.json`.
 */
export class StoreOps {
  private seq = 0;

  constructor(private readonly origin: DirectoryHandle) {}

  /**
   * Reads the newest readable manifest, keeping the models whose folders are complete, and deletes
   * every other model folder: models deleted before the page closed (assumption 11) and copies a
   * refresh cut short (D113).
   */
  async open(): Promise<{ manifest: Manifest | null; metas: Record<ModelId, StoredMeta> }> {
    const root = await this.root();
    let manifest: Manifest | null = null;
    for (const name of ManifestNames) {
      const read = await readJson(root, name).then(toManifest, () => null);
      if (read && (!manifest || read.seq > manifest.seq)) {
        manifest = read;
      }
    }
    this.seq = manifest?.seq ?? 0;

    const models = await this.models();
    const metas: Record<ModelId, StoredMeta> = {};
    if (manifest) {
      for (const entry of manifest.models) {
        const meta = await models
          .getDirectoryHandle(entry.id)
          .then((folder) => readJson(folder, MetaName))
          .then(toMeta, () => null);
        if (meta && meta.summary.id === entry.id) {
          metas[entry.id] = meta;
        }
      }
      manifest = { ...manifest, models: manifest.models.filter((entry) => metas[entry.id] !== undefined) };
    }

    const stale: string[] = [];
    for await (const name of models.keys()) {
      if (metas[name] === undefined) {
        stale.push(name);
      }
    }
    for (const name of stale) {
      await removeIfPresent(models, name);
    }
    return { manifest, metas };
  }

  /**
   * Copies a model's files into its folder, then writes its meta, which marks it complete. A copy
   * that fails, for want of space or otherwise, is deleted again.
   */
  async save(id: ModelId, meta: StoredMeta, files: readonly Blob[]): Promise<void> {
    const models = await this.models();
    try {
      const folder = await models.getDirectoryHandle(id, { create: true });
      for (const [index, file] of files.entries()) {
        await writeFile(folder, meta.files[index]!.name, file);
      }
      await writeFile(folder, MetaName, new Blob([JSON.stringify(meta)]));
    } catch (error) {
      await removeIfPresent(models, id).catch(() => {});
      throw isQuotaError(error) ? new StorageFullError() : error;
    }
  }

  /** A complete model's meta and files. Files read from the store are backed by it, not copied. */
  async load(id: ModelId): Promise<{ meta: StoredMeta; files: File[] }> {
    const folder = await (await this.models()).getDirectoryHandle(id);
    const meta = toMeta(await readJson(folder, MetaName));
    if (!meta) {
      throw new Error(`The kept copy of model ${id} is incomplete.`);
    }
    const files = await Promise.all(meta.files.map(async (file) => (await folder.getFileHandle(file.name)).getFile()));
    return { meta, files };
  }

  async delete(id: ModelId): Promise<void> {
    await removeIfPresent(await this.models(), id);
  }

  /** Removes everything stored (Clear all, D110). */
  async clear(): Promise<void> {
    await removeIfPresent(this.origin, RootName);
    this.seq = 0;
  }

  /** Writes the manifest over the older of its two files. */
  async writeManifest(manifest: Omit<Manifest, 'seq'>): Promise<void> {
    const seq = this.seq + 1;
    await writeFile(await this.root(), ManifestNames[seq % 2]!, new Blob([JSON.stringify({ ...manifest, seq })]));
    this.seq = seq;
  }

  private root(): Promise<DirectoryHandle> {
    return this.origin.getDirectoryHandle(RootName, { create: true });
  }

  private async models(): Promise<DirectoryHandle> {
    return (await this.root()).getDirectoryHandle(ModelsName, { create: true });
  }
}

/** Answers one request from the ModelStore: the store worker's whole job. */
export async function respond(store: Promise<StoreOps>, { requestId, ...request }: StoreRequestMessage): Promise<StoreResponse> {
  try {
    return { requestId, ok: true, value: await run(await store, request) };
  } catch (error) {
    return {
      requestId,
      ok: false,
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      full: error instanceof StorageFullError,
    };
  }
}

function run(store: StoreOps, request: StoreRequest): Promise<unknown> {
  switch (request.type) {
    case 'open':
      return store.open();
    case 'save':
      return store.save(request.id, request.meta, request.files);
    case 'load':
      return store.load(request.id);
    case 'delete':
      return store.delete(request.id);
    case 'clear':
      return store.clear();
    case 'manifest':
      return store.writeManifest(request.manifest);
  }
}

async function writeFile(folder: DirectoryHandle, name: string, blob: Blob): Promise<void> {
  const handle = await (await folder.getFileHandle(name, { create: true })).createSyncAccessHandle();
  try {
    handle.truncate(0);
    for (let at = 0; at < blob.size; at += ChunkBytes) {
      const chunk = new Uint8Array(await blob.slice(at, at + ChunkBytes).arrayBuffer());
      if (handle.write(chunk, { at }) !== chunk.byteLength) {
        throw new StorageFullError(); // a short write: the quota ran out
      }
    }
    handle.flush();
  } finally {
    handle.close();
  }
}

async function readJson(folder: DirectoryHandle, name: string): Promise<unknown> {
  const file = await (await folder.getFileHandle(name)).getFile();
  return JSON.parse(await file.text()) as unknown;
}

async function removeIfPresent(folder: DirectoryHandle, name: string): Promise<void> {
  try {
    await folder.removeEntry(name, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      throw error;
    }
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof StorageFullError || (error instanceof DOMException && error.name === 'QuotaExceededError');
}

function toManifest(value: unknown): Manifest | null {
  const manifest = value as Partial<Manifest> | null;
  return manifest?.version === 1 && typeof manifest.seq === 'number' && Array.isArray(manifest.models)
    ? { version: 1, seq: manifest.seq, models: manifest.models, camera: manifest.camera ?? null }
    : null;
}

function toMeta(value: unknown): StoredMeta | null {
  const meta = value as Partial<StoredMeta> | null;
  return meta?.summary && Array.isArray(meta.files) && meta.files.length > 0 ? (meta as StoredMeta) : null;
}
