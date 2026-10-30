import { openModel, type OcctFormat, type OpenedModel } from '@j3d/occt';
import { liveWorkers, type ImportRunner } from './runner.js';
import type { ImportResult } from './types.js';

export interface OcctRunnerOptions {
  /** Test hook: hold each new import after instantiation until it is cancelled. */
  holdBeforeImport?: () => boolean;
  /** Called when a held import is waiting. */
  onHeld?: (fileName: string) => void;
}

/** BREP formats (STEP, IGES, BREP): the kernel's model in its worker, kept alive while the model exists. */
export function createOcctRunner(options: OcctRunnerOptions = {}): ImportRunner {
  return (request) => {
    const cancelled = new AbortController();
    let opened: OpenedModel | undefined;

    const result = openModel(request.file, request.format as OcctFormat, {
      fileName: request.fileName,
      onProgress: request.onProgress,
      signal: cancelled.signal,
      testing: {
        track: (worker) => liveWorkers.track(worker),
        ...(options.holdBeforeImport ? { holdBeforeImport: options.holdBeforeImport } : {}),
        onHeld: () => options.onHeld?.(request.fileName),
      },
    }).then(
      (model): ImportResult | Promise<never> => {
        if (cancelled.signal.aborted) {
          model.dispose();
          return new Promise<never>(() => {});
        }
        opened = model;
        return {
          content: {
            kind: 'brep',
            scene: model.scene,
            measure: model.measure,
            exporter: model.exporter,
            expander: model.expander,
            arriver: model.arriver,
          },
          tree: model.scene.nodes,
          bounds: model.bounds,
          stats: model.stats,
          memoryBytes: model.memoryBytes,
          warnings: [],
        };
      },
      (error: unknown) => {
        if (cancelled.signal.aborted) {
          return new Promise<never>(() => {}); // a dispose() means no result ever arrives
        }
        throw error;
      },
    );

    return {
      result,
      dispose() {
        cancelled.abort();
        opened?.dispose();
      },
    };
  };
}
