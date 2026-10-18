import { ModelImportError, toImportError } from './errors';
import { compileOcctModule } from './occt-module';
import { ExportCancelledError, type BrepExporter, type BrepMeasurer } from './types';
import type { ExportRequest, MeasureRequest, ModelWorkerRequest, ModelWorkerResponse, OcctFormat } from './protocol';
import { liveWorkers, type ImportRunner } from './runner';
import type { ImportResult } from './types';

export interface OcctRunnerOptions {
  /** Test hook: hold each new import after instantiation until it is cancelled. */
  holdBeforeImport?: () => boolean;
  /** Called when a held import is waiting. */
  onHeld?: (fileName: string) => void;
}

/** BREP formats (STEP, IGES, BREP): one model worker per model, kept alive while the model exists. */
export function createOcctRunner(options: OcctRunnerOptions = {}): ImportRunner {
  return (request) => {
    let release: (() => void) | undefined;
    let queries: ModelChannel | undefined;
    let disposed = false;

    const result = (async (): Promise<ImportResult> => {
      const module = await compileOcctModule();
      if (disposed) {
        return new Promise<never>(() => {}); // cancelled before the worker started
      }

      const worker = new Worker(new URL('./workers/model-worker.ts', import.meta.url), {
        type: 'module',
        name: `J3D model: ${request.fileName}`,
      });
      release = liveWorkers.track(worker);

      const channel = (queries = modelChannel(worker));
      return new Promise<ImportResult>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<ModelWorkerResponse>) => {
          switch (data.type) {
            case 'progress':
              request.onProgress(data.phase, data.fraction);
              break;
            case 'held':
              options.onHeld?.(request.fileName);
              break;
            case 'loaded':
              resolve({
                content: { kind: 'brep', scene: data.scene, measure: channel.measure, exporter: channel.exporter },
                tree: data.scene.nodes,
                bounds: data.bounds,
                stats: data.stats,
                memoryBytes: data.memoryBytes,
                warnings: [],
              });
              break;
            case 'failed':
              reject(new ModelImportError(data.error.code, data.error.message));
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
          reject(new ModelImportError(code, message));
          channel.close(new Error(message));
        };
        worker.onmessageerror = () => reject(new ModelImportError('Internal', 'The model worker sent an unreadable message.'));

        const message: ModelWorkerRequest = {
          type: 'import',
          file: request.file,
          fileName: request.fileName,
          format: request.format as OcctFormat,
          module,
          holdBeforeImport: options.holdBeforeImport?.() ?? false,
        };
        worker.postMessage(message);
      });
    })();

    return {
      result,
      dispose() {
        disposed = true;
        release?.();
        queries?.close(new ExportCancelledError('The model was removed.'));
      },
    };
  };
}

/** The queries a loaded model's worker answers, one at a time, in order. */
interface ModelChannel {
  measure: BrepMeasurer;
  exporter: BrepExporter;
  /** Hands the channel a worker answer. */
  receive(data: ModelWorkerResponse): void;
  /** The worker is gone: exports in progress fail with `error`. */
  close(error: Error): void;
}

/**
 * The query channel to a model worker (M7): each request gets an id, and its promise settles when the
 * worker answers it. A terminated worker never answers, so its pending measurements never settle; its
 * exports fail, since .NET is waiting on them (M9).
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
    exporter: {
      export: (format, { onProgress, signal } = {}) =>
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
          const message: ExportRequest = { type: 'export', id, format, ...(cancel ? { cancel } : {}) };
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
