import { ModelImportError, toImportError } from './errors';
import { compileOcctModule } from './occt-module';
import type { ModelWorkerRequest, ModelWorkerResponse, OcctFormat } from './protocol';
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
                content: { kind: 'brep', scene: data.scene },
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
