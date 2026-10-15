import { ModelImportError, toImportError } from './errors';
import { compileOcctModule } from './occt-module';
import type { BrepMeasurer } from './types';
import type { MeasureRequest, ModelWorkerRequest, ModelWorkerResponse, OcctFormat } from './protocol';
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

      const measure = measurer(worker);
      return new Promise<ImportResult>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<ModelWorkerResponse>) => {
          switch (data.type) {
            case 'measured':
            case 'measureFailed':
              measure.answer(data.id, data.type === 'measured' ? { result: data.result } : { message: data.message });
              break;
            case 'progress':
              request.onProgress(data.phase, data.fraction);
              break;
            case 'held':
              options.onHeld?.(request.fileName);
              break;
            case 'loaded':
              resolve({
                content: { kind: 'brep', scene: data.scene, measure: measure.channel },
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
          }
        };
        // A worker that dies outright (e.g. the browser kills it for using too much memory).
        worker.onerror = (event) => {
          event.preventDefault();
          const { code, message } = toImportError(event.message || 'The model worker stopped unexpectedly.', true);
          reject(new ModelImportError(code, message));
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
      },
    };
  };
}

/**
 * The query channel to a model worker (M7): each request gets an id, and its promise settles when the
 * worker answers it. A terminated worker never answers, so its pending queries never settle.
 */
function measurer(worker: Worker): {
  channel: BrepMeasurer;
  answer(id: number, outcome: { result: unknown } | { message: string }): void;
} {
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const ask = <T>(request: MeasureRequest extends infer R ? (R extends MeasureRequest ? Omit<R, 'id'> : never) : never): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...request, id } as MeasureRequest);
    });
  return {
    channel: {
      entity: (entity) => ask({ type: 'measureEntity', entity }),
      pair: (a, b, shapeB) => ask({ type: 'measurePair', a, b, ...(shapeB === undefined ? {} : { shapeB }) }),
      exportEntity: (entity) => ask({ type: 'exportEntity', entity }),
    },
    answer(id, outcome) {
      const waiting = pending.get(id);
      pending.delete(id);
      if ('result' in outcome) {
        waiting?.resolve(outcome.result);
      } else {
        waiting?.reject(new Error(outcome.message));
      }
    },
  };
}
