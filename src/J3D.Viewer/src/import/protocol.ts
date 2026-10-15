// Messages between the main thread and the import workers. Bulk data always travels in transferred
// ArrayBuffers; everything else is small.

import type { EntityRef, ImportedScene } from '@j3d/occt/facade';
import type { SerializedMeshScene } from './mesh/serialize';
import type { Bounds, ImportError, ImportPhase, ModelStats } from './types';

export type OcctFormat = 'step' | 'iges' | 'brep';
export type WorkerMeshFormat = 'stl' | 'obj';

export interface ProgressMessage {
  type: 'progress';
  phase: ImportPhase;
  fraction: number | null;
}

export interface FailedMessage {
  type: 'failed';
  error: ImportError;
}

/** Main thread → model worker (one per BREP model; it keeps the model alive until terminated). */
export type ModelWorkerRequest = ImportRequestMessage | MeasureRequest;

/**
 * A measurement query to a loaded model's worker (M7, D80, D102). Each carries an id its answer
 * echoes; the worker answers queries one at a time, in order.
 */
export type MeasureRequest =
  | { type: 'measureEntity'; id: number; entity: EntityRef }
  | { type: 'measurePair'; id: number; a: EntityRef; b: EntityRef; shapeB?: string }
  | { type: 'exportEntity'; id: number; entity: EntityRef };

export interface ImportRequestMessage {
  type: 'import';
  file: Blob;
  fileName: string;
  format: OcctFormat;
  /** Compiled once on the main thread and shared by every model worker. */
  module: WebAssembly.Module;
  /** Test hook: stop after instantiating (answering `held`), so a test can cancel a live import. */
  holdBeforeImport?: boolean;
}

/** Model worker → main thread. */
export type ModelWorkerResponse =
  | ProgressMessage
  | FailedMessage
  | { type: 'held' }
  | { type: 'measured'; id: number; result: unknown }
  | { type: 'measureFailed'; id: number; message: string }
  | {
      type: 'loaded';
      scene: ImportedScene;
      bounds: Bounds;
      stats: ModelStats;
      memoryBytes: number;
    };

/** Main thread → mesh worker (one per STL/OBJ import, terminated once it answers). */
export interface MeshWorkerRequest {
  type: 'parse';
  file: Blob;
  fileName: string;
  format: WorkerMeshFormat;
}

/** Mesh worker → main thread. */
export type MeshWorkerResponse = ProgressMessage | FailedMessage | { type: 'parsed'; scene: SerializedMeshScene };

/** The parts of a dedicated worker's global scope the workers use (the DOM lib types `self` as Window). */
export interface WorkerScope<TRequest, TResponse> {
  onmessage: ((event: MessageEvent<TRequest>) => void) | null;
  postMessage(message: TResponse, transfer?: Transferable[]): void;
}
