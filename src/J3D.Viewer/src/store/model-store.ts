import { hasEdits, type ModelEdits } from '../edit/structure';
import { basename, type BatchFile } from '../import/sidecars';
import type { KeptPlacement, ModelId, ModelSummary } from '../import/types';
import type { StoreRequest, StoreRequestMessage, StoreResponse } from './protocol';
import type { OpenedStore } from './store-ops';
import type { CameraSnapshot, KeptEdits, ManifestModel, StoredMeta, StoredScene, StoreStatus } from './types';

/** The store worker, or a stand-in for tests. */
export interface StoreWorker {
  postMessage(message: StoreRequestMessage): void;
  onmessage: ((event: MessageEvent<StoreResponse>) => void) | null;
  terminate(): void;
}

export interface ModelStoreOptions {
  createWorker?: () => StoreWorker;
  /** The browser's Web Locks; without them the tab keeps the store. */
  locks?: Pick<LockManager, 'request'> | undefined;
  /** Asks the browser not to evict the store (D115). */
  persist?: (() => Promise<boolean>) | undefined;
  /** How long changes gather before the manifest is written, in milliseconds. */
  manifestDelay?: number;
}

/** How a copy went: kept, or not for want of space, or not for another reason, or not tried (D109, D115). */
export type SaveOutcome = 'kept' | 'full' | 'failed' | 'notKept';

/** Held by the tab that keeps the store (D109). */
export const LockName = 'j3d-store';

export const DefaultManifestDelay = 250;

export class StoreFailure extends Error {
  constructor(
    message: string,
    readonly full: boolean,
  ) {
    super(message);
    this.name = 'StoreFailure';
  }
}

/**
 * Keeps imported models and the scene in the browser's private file system (D82, docs/plan.md
 * §6.2): each loaded model's files and the sidecars it used (D113), and a manifest of the kept
 * models in list order, their hidden parts and the camera, written a moment after each change.
 * Only the tab holding the Web Lock keeps anything (D109); a store worker does the writing (D112).
 * Since M16 each model's moves and edits are written to its own files, only when they change (D205),
 * and a listed model the store couldn't read stays listed for the next visit (D200).
 */
export class ModelStore {
  /** What was stored when the page opened. Settles once; never rejects. */
  readonly opened: Promise<StoredScene>;
  private status: StoreStatus = 'unavailable';
  private worker: StoreWorker | undefined;
  private readonly answers = new Map<number, { resolve(value: unknown): void; reject(error: StoreFailure): void }>();
  private nextRequest = 1;
  /** The last request's answer: the worker answers in order, so all are done once it settles. */
  private last: Promise<unknown> = Promise.resolve();
  private order: ModelId[] = [];
  private readonly hidden = new Map<ModelId, number[]>();
  /** Each model's moved nodes and their placements in their parents' frames (M13, D145). */
  private readonly placements = new Map<ModelId, Map<number, number[]>>();
  /** Each model's edits to its tree (M14, D145). */
  private readonly edits = new Map<ModelId, ModelEdits>();
  /** Models whose copies are complete, so the manifest may list them. */
  private readonly complete = new Set<ModelId>();
  /** Models being copied; a delete meanwhile takes them out, so the finished copy isn't listed. */
  private readonly saving = new Set<ModelId>();
  /** Models whose moves or edits changed since their files were written (D205). */
  private readonly changedEdits = new Set<ModelId>();
  /** Listed models the store couldn't read when it opened, listed again in each manifest (D200). */
  private unreadable: ManifestModel[] = [];
  /** A failed manifest write is tried once more (D200). */
  private manifestRetried = false;
  private camera: CameraSnapshot | null = null;
  private manifestTimer: ReturnType<typeof setTimeout> | undefined;
  private releaseLock: (() => void) | undefined;
  private persistAsked = false;
  private disposed = false;

  constructor(private readonly options: ModelStoreOptions = {}) {
    this.opened = this.open().catch((error: unknown) => {
      console.info("J3D: this browser can't keep models between visits.", error);
      this.close();
      return { status: 'unavailable', models: [], camera: null, unreadable: 0 };
    });
  }

  get state(): { status: StoreStatus; stored: ModelId[]; order: ModelId[]; camera: CameraSnapshot | null } {
    return { status: this.status, stored: [...this.complete], order: [...this.order], camera: this.camera };
  }

  /** Whether a complete copy of the model is stored. */
  has(id: ModelId): boolean {
    return this.complete.has(id);
  }

  /** Copies a loaded model's file and the sidecars it used (D113). */
  async save(summary: ModelSummary, sources: readonly BatchFile[]): Promise<SaveOutcome> {
    if (this.status !== 'kept') {
      return 'notKept';
    }
    this.askToPersist();
    const meta: StoredMeta = {
      summary,
      files: sources.map(({ file, path }, index) => ({ name: String(index), path, type: file.type, lastModified: file.lastModified })),
    };
    this.saving.add(summary.id);
    try {
      await this.request({ type: 'save', id: summary.id, meta, files: sources.map(({ file }) => file) });
    } catch (error) {
      this.saving.delete(summary.id);
      if (error instanceof StoreFailure && error.full) {
        return 'full';
      }
      console.warn(`J3D: ${summary.fileName} couldn't be kept.`, error);
      return 'failed';
    }
    if (!this.saving.delete(summary.id)) {
      return 'kept'; // deleted while it was being copied; the delete followed the copy
    }
    this.complete.add(summary.id);
    // Moves or edits made while it was copied go to its files now.
    if (this.placements.has(summary.id) || this.edits.has(summary.id)) {
      this.changedEdits.add(summary.id);
    }
    this.scheduleManifest();
    return 'kept';
  }

  /** A stored model's files, named and pathed as they were imported, its own file first. */
  async load(id: ModelId): Promise<BatchFile[]> {
    const { meta, files } = await this.request<{ meta: StoredMeta; files: File[] }>({ type: 'load', id });
    return meta.files.map((stored, index) => ({
      file: new File([files[index]!], basename(stored.path), { type: stored.type, lastModified: stored.lastModified }),
      path: stored.path,
      // Sidecars are matched as before; one the model doesn't use again isn't reported.
      ...(index > 0 ? { fromFolder: true } : {}),
    }));
  }

  /** Deletes a model's copy, for good (cancel, dismiss, or a delete that can no longer be undone). */
  delete(id: ModelId): void {
    const listed = this.complete.delete(id);
    this.saving.delete(id);
    this.hidden.delete(id);
    this.placements.delete(id);
    this.edits.delete(id);
    this.changedEdits.delete(id);
    if (this.status === 'kept') {
      this.request({ type: 'delete', id }).catch((error: unknown) => console.warn('J3D: a kept model could not be deleted.', error));
      if (listed) {
        this.scheduleManifest();
      }
    }
  }

  /** Removes everything stored (D110). */
  clear(): void {
    this.complete.clear();
    this.saving.clear();
    this.hidden.clear();
    this.placements.clear();
    this.edits.clear();
    this.changedEdits.clear();
    this.unreadable = [];
    this.order = [];
    clearTimeout(this.manifestTimer);
    this.manifestTimer = undefined;
    if (this.status === 'kept') {
      this.request({ type: 'clear' }).catch((error: unknown) => console.warn('J3D: the kept models could not be cleared.', error));
    }
  }

  /** The models .NET lists, in order (D117); the manifest lists those with complete copies. */
  setOrder(ids: readonly ModelId[]): void {
    if (ids.length !== this.order.length || ids.some((id, index) => id !== this.order[index])) {
      this.order = [...ids];
      this.scheduleManifest();
    }
  }

  setHidden(id: ModelId, hidden: readonly number[]): void {
    const before = this.hidden.get(id) ?? [];
    if (hidden.length !== before.length || hidden.some((node, index) => node !== before[index])) {
      this.hidden.set(id, [...hidden]);
      if (this.complete.has(id)) {
        this.scheduleManifest();
      }
    }
  }

  /** A node of a model (or the model, node -1) moved to this placement in its parent's frame (M13). */
  setPlacement(id: ModelId, node: number, matrix: readonly number[]): void {
    let moved = this.placements.get(id);
    if (!moved) {
      moved = new Map();
      this.placements.set(id, moved);
    }
    moved.set(node, [...matrix]);
    this.editsChanged(id);
  }

  /** A model's kept moves, to apply when it's imported again. */
  placementsOf(id: ModelId): KeptPlacement[] {
    return [...(this.placements.get(id) ?? [])].map(([node, matrix]) => ({ node, matrix }));
  }

  /** A model's tree as edited (M14), kept as a whole: .NET sends all its edits each time. */
  setEdits(id: ModelId, edits: ModelEdits): void {
    if (hasEdits(edits)) {
      this.edits.set(id, edits);
    } else if (!this.edits.delete(id)) {
      return;
    }
    this.editsChanged(id);
  }

  /** A model's kept edits, to apply when it's imported again. */
  editsOf(id: ModelId): ModelEdits | undefined {
    return this.edits.get(id);
  }

  /** Forgets a model's edits and moves: they no longer fit it (R25), so it's kept as imported. */
  forgetEdits(id: ModelId): void {
    const edited = this.edits.delete(id);
    const moved = this.placements.delete(id);
    if (edited || moved) {
      this.editsChanged(id);
    }
  }

  /** A kept model's moves or edits changed: its files are written with the next manifest (D205). */
  private editsChanged(id: ModelId): void {
    if (this.complete.has(id)) {
      this.changedEdits.add(id);
      this.scheduleManifest();
    }
  }

  setCamera(camera: CameraSnapshot): void {
    this.camera = camera;
    this.scheduleManifest();
  }

  /** Once the store has opened, writes a waiting manifest now and resolves when every request so far is done (tests). */
  async idle(): Promise<void> {
    await this.opened;
    for (let last = undefined as Promise<unknown> | undefined; last !== this.last; ) {
      if (this.manifestTimer !== undefined) {
        this.writeManifest();
      }
      last = this.last;
      await last;
    }
  }

  /** Writes a waiting manifest at once: the page is going away. */
  flush(): void {
    if (this.manifestTimer !== undefined) {
      this.writeManifest();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.flush();
    this.disposed = true;
    void this.last.then(() => this.close());
  }

  private async open(): Promise<StoredScene> {
    if (!(await this.acquire())) {
      this.status = 'otherTab';
      return { status: 'otherTab', models: [], camera: null, unreadable: 0 };
    }
    if (this.disposed) {
      this.close();
      return { status: 'unavailable', models: [], camera: null, unreadable: 0 };
    }
    const worker = (this.options.createWorker ?? createStoreWorker)();
    worker.onmessage = ({ data }) => this.answer(data);
    this.worker = worker;

    const { manifest, metas, edits, unreadable } = await this.request<OpenedStore>({ type: 'open' });
    this.status = 'kept';
    this.unreadable = unreadable;
    const models = (manifest?.models ?? []).map(({ id, hidden }) => {
      this.complete.add(id);
      this.hidden.set(id, hidden);
      const kept = edits[id];
      if (kept?.placements.length) {
        this.placements.set(id, new Map(kept.placements.map(({ node, matrix }) => [node, matrix])));
      }
      if (hasEdits(kept?.edits)) {
        this.edits.set(id, kept.edits!);
      }
      // A version 1 manifest held them: they move to the model's files with the next write (D205).
      if (manifest?.version === 1 && kept) {
        this.changedEdits.add(id);
      }
      return { summary: metas[id]!.summary, hidden };
    });
    // .NET may have listed models imported while the store was opening: its order stands, and it lists
    // the kept models too once they're back (found in M13: the order was lost, so nothing was kept).
    if (this.order.length === 0) {
      this.order = models.map(({ summary }) => summary.id);
    }
    this.camera = manifest?.camera ?? null;
    if (this.changedEdits.size > 0) {
      this.scheduleManifest();
    }
    return { status: 'kept', models, camera: this.camera, unreadable: unreadable.length };
  }

  /** Takes the store's lock if no other tab holds it, and keeps it until the store closes. */
  private acquire(): Promise<boolean> {
    const locks = this.options.locks;
    if (!locks) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve, reject) => {
      locks
        .request(LockName, { ifAvailable: true }, (lock) => {
          resolve(lock !== null);
          return lock === null ? undefined : new Promise<void>((release) => (this.releaseLock = release));
        })
        .catch(reject);
    });
  }

  private close(): void {
    this.status = this.status === 'otherTab' ? 'otherTab' : 'unavailable';
    this.worker?.terminate();
    this.worker = undefined;
    for (const { reject } of this.answers.values()) {
      reject(new StoreFailure('The store is closed.', false));
    }
    this.answers.clear();
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private request<T>(request: StoreRequest): Promise<T> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new StoreFailure('The store is closed.', false));
    }
    const requestId = this.nextRequest++;
    const answer = new Promise<T>((resolve, reject) => {
      this.answers.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
    });
    worker.postMessage({ ...request, requestId });
    this.last = answer.catch(() => {});
    return answer;
  }

  private answer(response: StoreResponse): void {
    const waiting = this.answers.get(response.requestId);
    this.answers.delete(response.requestId);
    if (response.ok) {
      waiting?.resolve(response.value);
    } else {
      waiting?.reject(new StoreFailure(response.message, response.full));
    }
  }

  private scheduleManifest(): void {
    if (this.status !== 'kept' || this.disposed) {
      return;
    }
    clearTimeout(this.manifestTimer);
    this.manifestTimer = setTimeout(() => this.writeManifest(), this.options.manifestDelay ?? DefaultManifestDelay);
  }

  /**
   * Writes the changed models' moves and edits to their files, then the manifest (D205): the kept
   * models in order with their hidden parts, then those the store couldn't read when it opened (D200),
   * and the camera. A failed manifest is tried once more.
   */
  private writeManifest(): void {
    clearTimeout(this.manifestTimer);
    this.manifestTimer = undefined;
    for (const id of this.changedEdits) {
      if (this.complete.has(id)) {
        this.request({ type: 'edits', id, kept: this.keptEditsOf(id) }).catch((error: unknown) =>
          console.warn("J3D: a model's edits couldn't be kept.", error),
        );
      }
    }
    this.changedEdits.clear();
    const models = [
      ...this.order.filter((id) => this.complete.has(id)).map((id) => ({ id, hidden: this.hidden.get(id) ?? [] })),
      ...this.unreadable,
    ];
    this.request({ type: 'manifest', manifest: { version: 2, models, camera: this.camera } }).then(
      () => (this.manifestRetried = false),
      (error: unknown) => {
        console.warn("J3D: the scene couldn't be kept.", error);
        if (!this.manifestRetried && !(error instanceof StoreFailure && error.full)) {
          this.manifestRetried = true;
          this.scheduleManifest();
        }
      },
    );
  }

  /** A model's moves and edits as its files keep them, or null when it has none. */
  private keptEditsOf(id: ModelId): KeptEdits | null {
    const placements = this.placementsOf(id);
    const edits = this.edits.get(id);
    return placements.length > 0 || edits ? { placements, ...(edits ? { edits } : {}) } : null;
  }

  private askToPersist(): void {
    if (this.persistAsked) {
      return;
    }
    this.persistAsked = true;
    const persist = this.options.persist ?? (navigator.storage?.persist ? () => navigator.storage.persist() : undefined);
    // Chrome decides without asking; Firefox asks the user. Either way the store works (D115).
    persist?.().catch(() => {});
  }
}

function createStoreWorker(): StoreWorker {
  return new Worker(new URL('./workers/store-worker.ts', import.meta.url), { type: 'module', name: 'J3D store' });
}
