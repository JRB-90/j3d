import { ModelImportError, toImportError } from './errors.js';
import type { ImportedScene } from './facade.js';
import { compileOcctModule } from './occt-module.js';
import type { ProgressListener } from './progress.js';
import type { ArriveRequest, ExpandRequest, ExportRequest, MeasureRequest, ModelWorkerRequest, ModelWorkerResponse } from './protocol.js';
import { ExportCancelledError, type Bounds, type BrepArriver, type BrepExpander, type BrepExporter, type BrepMeasurer, type ModelStats, type OcctFormat } from './types.js';

/** What {@link openModel} takes. */
export interface OpenModelOptions {
  /** Named in the worker and in OCCT's messages. Defaults to a `File`'s own name. */
  fileName?: string;
  /** The import's phases, each with a fraction, or null while OCCT can't say how far it is. */
  onProgress?: ProgressListener;
  /** Stops the import: its worker ends and the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** For J3D's own tests, not for applications: what they need to see a worker start, stop and wait. */
  testing?: {
    /** Takes the worker when it starts, and returns how to end it. */
    track?: (worker: Worker) => () => void;
    /** Whether to stop after instantiating the kernel, until the signal aborts. */
    holdBeforeImport?: () => boolean;
    onHeld?: () => void;
  };
}

/** A model open in a worker of its own, whose BREP stays alive there until {@link OpenedModel.dispose}. */
export interface OpenedModel {
  /** Its tree, placements and meshes. */
  scene: ImportedScene;
  /** Its bounds. */
  bounds: Bounds;
  /** What it draws. */
  stats: ModelStats;
  /** The worker's WebAssembly heap. */
  memoryBytes: number;
  /** Measures it. */
  measure: BrepMeasurer;
  /** Saves it as STEP or BREP. */
  exporter: BrepExporter;
  /** Splits its compound parts. */
  expander: BrepExpander;
  /** Reads in objects from another model. */
  arriver: BrepArriver;
  /** Ends the worker, which frees the whole model at once. Exports in progress reject. */
  dispose(): void;
}

/**
 * Opens a STEP, IGES or BREP file in a worker of its own (docs/plan.md §6.2), which keeps it, with its
 * BREP, for measuring, expanding and exporting. Rejects with a {@link ModelImportError}. The WebAssembly
 * module is compiled once a page and handed to each worker.
 */
export async function openModel(file: Blob, format: OcctFormat, options: OpenModelOptions = {}): Promise<OpenedModel> {
  const { onProgress, signal, testing } = options;
  const fileName = options.fileName ?? (file instanceof File ? file.name : `model.${format}`);
  signal?.throwIfAborted();
  const module = await compileOcctModule();
  signal?.throwIfAborted();

  const worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module', name: `J3D model: ${fileName}` });
  const release = testing?.track?.(worker) ?? (() => worker.terminate());
  const channel = modelChannel(worker);
  const stop = (error: Error) => {
    release();
    channel.close(error);
  };

  return new Promise<OpenedModel>((resolve, reject) => {
    const onAbort = () => {
      stop(new ExportCancelledError('The model was removed.'));
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const settle = () => signal?.removeEventListener('abort', onAbort);
    const fail = (code: ConstructorParameters<typeof ModelImportError>[0], message: string) => {
      settle();
      stop(new Error(message));
      reject(new ModelImportError(code, message));
    };

    worker.onmessage = ({ data }: MessageEvent<ModelWorkerResponse>) => {
      switch (data.type) {
        case 'progress':
          onProgress?.(data.phase, data.fraction);
          break;
        case 'held':
          testing?.onHeld?.();
          break;
        case 'loaded':
          settle();
          resolve({
            scene: data.scene,
            bounds: data.bounds,
            stats: data.stats,
            memoryBytes: data.memoryBytes,
            measure: channel.measure,
            exporter: channel.exporter,
            expander: channel.expander,
            arriver: channel.arriver,
            dispose: () => stop(new ExportCancelledError('The model was removed.')),
          });
          break;
        case 'failed':
          fail(data.error.code, data.error.message);
          break;
        default:
          channel.receive(data);
          break;
      }
    };
    // A worker that dies outright (e.g. the browser kills it for using too much memory).
    worker.onerror = (event) => {
      event.preventDefault();
      const { code, message } = toImportError(event.message || 'The model worker stopped unexpectedly.', true);
      fail(code, message);
    };
    worker.onmessageerror = () => fail('Internal', 'The model worker sent an unreadable message.');

    const message: ModelWorkerRequest = {
      type: 'import',
      file,
      fileName,
      format,
      module,
      holdBeforeImport: testing?.holdBeforeImport?.() ?? false,
    };
    worker.postMessage(message);
  });
}

/** The queries a loaded model's worker answers, one at a time, in order. */
interface ModelChannel {
  measure: BrepMeasurer;
  exporter: BrepExporter;
  expander: BrepExpander;
  arriver: BrepArriver;
  /** Hands the channel a worker answer. */
  receive(data: ModelWorkerResponse): void;
  /** The worker is gone: exports in progress fail with `error`. */
  close(error: Error): void;
}

/**
 * The query channel to a model worker (M7): each request gets an id, and its promise settles when the
 * worker answers it. A terminated worker never answers, so its pending measurements never settle; its
 * exports fail, since their callers are waiting on them (M9).
 */
function modelChannel(worker: Worker): ModelChannel {
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const exports = new Map<number, { resolve(bytes: ArrayBuffer): void; reject(error: Error): void; onProgress?: (fraction: number | null) => void }>();
  const ask = <T>(request: MeasureRequest extends infer R ? (R extends MeasureRequest ? Omit<R, 'id'> : never) : never): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...request, id } as MeasureRequest);
    });

  return {
    measure: {
      entity: (entity) => ask({ type: 'measureEntity', entity }),
      pair: (a, b, shapeB) => ask({ type: 'measurePair', a, b, ...(shapeB === undefined ? {} : { shapeB }) }),
      exportEntity: (entity) => ask({ type: 'exportEntity', entity }),
    },
    expander: {
      expand: (node) =>
        new Promise((resolve, reject) => {
          const id = ++next;
          pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
          const message: ExpandRequest = { type: 'expand', id, node };
          worker.postMessage(message);
        }),
    },
    arriver: {
      arrive: (file, base) =>
        new Promise((resolve, reject) => {
          const id = ++next;
          pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
          const message: ArriveRequest = { type: 'arrive', id, file, base };
          worker.postMessage(message);
        }),
    },
    exporter: {
      export: (format, { plan, onProgress, signal } = {}) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new ExportCancelledError());
            return;
          }
          const id = ++next;
          // OCCT polls this while it works (D125); without cross-origin isolation the export runs to its
          // end in the worker and its result is dropped.
          const cancel = globalThis.crossOriginIsolated ? new SharedArrayBuffer(4) : undefined;
          const settle = () => {
            exports.delete(id);
            signal?.removeEventListener('abort', abort);
          };
          const abort = () => {
            if (cancel) {
              Atomics.store(new Int32Array(cancel), 0, 1);
            }
            settle();
            reject(new ExportCancelledError());
          };
          signal?.addEventListener('abort', abort, { once: true });
          exports.set(id, {
            resolve: (bytes) => {
              settle();
              resolve(bytes);
            },
            reject: (error) => {
              settle();
              reject(error);
            },
            ...(onProgress ? { onProgress } : {}),
          });
          const message: ExportRequest = { type: 'export', id, format, ...(plan ? { plan } : {}), ...(cancel ? { cancel } : {}) };
          worker.postMessage(message);
        }),
    },
    receive(data) {
      switch (data.type) {
        case 'measured':
        case 'measureFailed': {
          const waiting = pending.get(data.id);
          pending.delete(data.id);
          if (data.type === 'measured') {
            waiting?.resolve(data.result);
          } else {
            waiting?.reject(new Error(data.message));
          }
          break;
        }
        case 'expanded': {
          const waiting = pending.get(data.id);
          pending.delete(data.id);
          waiting?.resolve({ pieces: data.pieces, prototypes: data.prototypes });
          break;
        }
        case 'arrived': {
          const waiting = pending.get(data.id);
          pending.delete(data.id);
          waiting?.resolve({ arrival: data.arrival, prototypes: data.prototypes });
          break;
        }
        case 'exportProgress':
          exports.get(data.id)?.onProgress?.(data.fraction);
          break;
        case 'exported':
          exports.get(data.id)?.resolve(data.bytes);
          break;
        case 'exportFailed':
          exports.get(data.id)?.reject(data.cancelled ? new ExportCancelledError() : new Error(data.message));
          break;
      }
    },
    close(error) {
      for (const waiting of [...exports.values()]) {
        waiting.reject(error);
      }
    },
  };
}
