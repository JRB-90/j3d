import type { ModelId } from '../import/types';
import type { StoreRequest, StoreRequestMessage, StoreResponse } from './protocol';
import type { KeptEdits, Manifest, ManifestModel, StoredMeta } from './types';

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
/** A model's edits and moves (M16, D205), written to two files in turn as the manifest is. */
export const EditsNames = ['edits-0.json', 'edits-1.json'] as const;
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
 * Thrown when the browser wrote less than it was given, twice, while the quota had room (M16, D200):
 * seen once in the built-in browser, where it was reported as a full store.
 */
export class ShortWriteError extends Error {
  constructor(written: number, size: number) {
    super(`The browser wrote only ${written} of ${size} bytes.`);
    this.name = 'ShortWriteError';
  }
}

/** The origin's storage use and quota, as `navigator.storage.estimate()` gives them. */
export type Estimate = () => Promise<{ usage?: number; quota?: number }>;

/** What the store held when it opened. */
export interface OpenedStore {
  manifest: Manifest | null;
  metas: Record<ModelId, StoredMeta>;
  /** Each listed model's edits and moves, from its own files or, before M16, the manifest. */
  edits: Record<ModelId, KeptEdits>;
  /** Models the manifest lists whose meta couldn't be read: kept for the next visit, not restored (D200). */
  unreadable: ManifestModel[];
}

/**
 * The store's file operations, run one at a time in the store worker (D112). Layout under the
 * origin's root: `j3d/manifest-0.json` and `j3d/manifest-1.json` (written in turn), and
 * `j3d/models/<id>/` holding a model's files (`0`, `1`, …), its `meta.json` and since M16 its
 * `edits-0.json` and `edits-1.json` (D205).
 */
export class StoreOps {
  private seq = 0;
  private readonly editsSeq = new Map<ModelId, number>();

  constructor(
    private readonly origin: DirectoryHandle,
    private readonly estimate?: Estimate,
  ) {}

  /**
   * Reads the newest readable manifest and each listed model's meta and edits, and deletes every model
   * folder it doesn't list: models deleted before the page closed (assumption 11) and copies a refresh
   * cut short (D113), which are never listed. A listed model whose meta can't be read is kept (D200):
   * deleting it lost a model in M16's timings.
   */
  async open(): Promise<OpenedStore> {
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
    const edits: Record<ModelId, KeptEdits> = {};
    const unreadable: ManifestModel[] = [];
    const listed = new Set(manifest?.models.map(({ id }) => id));
    if (manifest) {
      for (const entry of manifest.models) {
        const folder = await models.getDirectoryHandle(entry.id).catch(() => null);
        const meta = folder ? await readJson(folder, MetaName).then(toMeta, () => null) : null;
        if (!meta || meta.summary.id !== entry.id) {
          if (folder) {
            unreadable.push(entry);
          }
          continue;
        }
        metas[entry.id] = meta;
        const kept = folder ? await this.readEdits(entry.id, folder) : undefined;
        // Before M16 the manifest held them (D205); they move to the model's files at the next write.
        const legacy = entry.placements?.length || entry.edits ? { placements: entry.placements ?? [], ...(entry.edits ? { edits: entry.edits } : {}) } : undefined;
        if (kept ?? legacy) {
          edits[entry.id] = (kept ?? legacy)!;
        }
      }
      manifest = { ...manifest, models: manifest.models.filter((entry) => metas[entry.id] !== undefined) };
    }

    const stale: string[] = [];
    for await (const name of models.keys()) {
      if (!listed.has(name)) {
        stale.push(name);
      }
    }
    for (const name of stale) {
      await removeIfPresent(models, name);
    }
    return { manifest, metas, edits, unreadable };
  }

  /** Writes a model's edits and moves over the older of its two files, or removes both when it has none (D205). */
  async writeEdits(id: ModelId, kept: KeptEdits | null): Promise<void> {
    const folder = await (await this.models()).getDirectoryHandle(id);
    if (!kept) {
      for (const name of EditsNames) {
        await removeIfPresent(folder, name);
      }
      this.editsSeq.delete(id);
      return;
    }
    const seq = (this.editsSeq.get(id) ?? 0) + 1;
    await this.writeFile(folder, EditsNames[seq % 2]!, new Blob([JSON.stringify({ ...kept, seq })]));
    this.editsSeq.set(id, seq);
  }

  private async readEdits(id: ModelId, folder: DirectoryHandle): Promise<KeptEdits | undefined> {
    let newest: (KeptEdits & { seq: number }) | undefined;
    for (const name of EditsNames) {
      const read = await readJson(folder, name).then(toKeptEdits, () => null);
      if (read && (!newest || read.seq > newest.seq)) {
        newest = read;
      }
    }
    if (newest) {
      this.editsSeq.set(id, newest.seq);
      const { seq: _, ...kept } = newest;
      return kept;
    }
    return undefined;
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
        await this.writeFile(folder, meta.files[index]!.name, file);
      }
      await this.writeFile(folder, MetaName, new Blob([JSON.stringify(meta)]));
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
    await this.writeFile(await this.root(), ManifestNames[seq % 2]!, new Blob([JSON.stringify({ ...manifest, seq })]));
    this.seq = seq;
  }

  /**
   * Streams a file into a synchronous access handle a chunk at a time. A write that comes up short is
   * tried once more for the rest (D200), and then taken for a full store only if the quota says so: in
   * WebKit a full store writes short, but in M16's timings one write came up short in Chromium with
   * gigabytes free, and was reported as a full store.
   */
  private async writeFile(folder: DirectoryHandle, name: string, blob: Blob): Promise<void> {
    const handle = await (await folder.getFileHandle(name, { create: true })).createSyncAccessHandle();
    try {
      handle.truncate(0);
      for (let at = 0; at < blob.size; at += ChunkBytes) {
        const chunk = new Uint8Array(await blob.slice(at, at + ChunkBytes).arrayBuffer());
        let written = handle.write(chunk, { at });
        if (written < chunk.byteLength) {
          written += handle.write(chunk.subarray(written), { at: at + written });
        }
        if (written < chunk.byteLength) {
          throw (await this.isFull(chunk.byteLength - written)) ? new StorageFullError() : new ShortWriteError(at + written, blob.size);
        }
      }
      handle.flush();
    } finally {
      handle.close();
    }
  }

  /** Whether this many more bytes don't fit the quota; without an estimate, a short write is taken for a full store. */
  private async isFull(bytes: number): Promise<boolean> {
    try {
      const { usage, quota } = (await this.estimate?.()) ?? {};
      return usage === undefined || quota === undefined || quota - usage < bytes;
    } catch {
      return true;
    }
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
    case 'edits':
      return store.writeEdits(request.id, request.kept);
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

/** A manifest of either version: before M16 its models carried their moves and edits (D205). */
function toManifest(value: unknown): Manifest | null {
  const manifest = value as Partial<Manifest> | null;
  return (manifest?.version === 1 || manifest?.version === 2) && typeof manifest.seq === 'number' && Array.isArray(manifest.models)
    ? { version: manifest.version, seq: manifest.seq, models: manifest.models, camera: manifest.camera ?? null }
    : null;
}

function toKeptEdits(value: unknown): (KeptEdits & { seq: number }) | null {
  const kept = value as Partial<KeptEdits & { seq: number }> | null;
  return typeof kept?.seq === 'number' && Array.isArray(kept.placements) ? (kept as KeptEdits & { seq: number }) : null;
}

function toMeta(value: unknown): StoredMeta | null {
  const meta = value as Partial<StoredMeta> | null;
  return meta?.summary && Array.isArray(meta.files) && meta.files.length > 0 ? (meta as StoredMeta) : null;
}
