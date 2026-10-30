import type { ModelFormat } from '../formats.js';
import type { ProgressListener } from '@j3d/occt/core';
import type { Sidecars } from './sidecars.js';
import type { ImportResult } from './types.js';

/** Everything an importer needs for one file. */
export interface ImportRequest {
  file: Blob;
  fileName: string;
  /** The file's path within its batch: just the name for picked files, folder-relative for dropped folders. */
  path: string;
  format: ModelFormat;
  /** Other files of the same batch that this file may reference (.bin, .mtl, textures). */
  sidecars: Sidecars;
  onProgress: ProgressListener;
}

/** A running (and later loaded) import. */
export interface ImportTask {
  /** Settles once with the model or a {@link ModelImportError}. Never settles after `dispose()`. */
  readonly result: Promise<ImportResult>;
  /** Cancels the import or releases the loaded model: terminates its worker, disposes its geometry. Idempotent. */
  dispose(): void;
}

export type ImportRunner = (request: ImportRequest) => ImportTask;

/** Tracks live import workers so tests can check that cancel and delete really free them. */
export const liveWorkers = {
  count: 0,
  track(worker: Worker): () => void {
    this.count++;
    let terminated = false;
    return () => {
      if (!terminated) {
        terminated = true;
        worker.terminate();
        this.count--;
      }
    };
  },
};
