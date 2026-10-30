// Messages between the main thread and the import workers. Bulk data always travels in transferred
// ArrayBuffers; everything else is small.

import type { Arrival, EntityRef, ExpandedPiece, ImportedScene, PlanNode, PrototypeMesh } from '@j3d/occt/facade';
import type { SerializedMeshScene } from './mesh/serialize.js';
import type { Bounds, ImportError, ImportPhase, ModelStats } from './types.js';

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
export type ModelWorkerRequest = ImportRequestMessage | MeasureRequest | ExportRequest | ExpandRequest | ArriveRequest;

/** What a BREP model can be saved as (M9, D83). */
export type BrepExportFormat = 'step' | 'brep';

/**
 * Saving the model (M9, D83, D125): as imported, or since M15 its edited tree as `plan` gives it. It's
 * answered in turn with the queries. `cancel`, when the page is cross-origin isolated, is a shared
 * Int32 flag the page sets to 1 to stop OCCT mid-export, since the worker can't take a message while
 * OCCT runs.
 */
export interface ExportRequest {
  type: 'export';
  id: number;
  format: BrepExportFormat;
  plan?: PlanNode[];
  cancel?: SharedArrayBuffer;
}

/** A file part's pieces (M15, D154), answered with `expanded` (or `measureFailed`) in turn with the queries. */
export interface ExpandRequest {
  type: 'expand';
  id: number;
  node: number;
}

/**
 * Objects from another model, as the STEP its worker wrote (M18, D225): read in as an arrival whose
 * nodes start at `base`, and answered with `arrived` (or `measureFailed`) in turn with the queries.
 */
export interface ArriveRequest {
  type: 'arrive';
  id: number;
  file: Blob;
  base: number;
}

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
  /** Export progress: a fraction, or null while OCCT writes the STEP file (it can't tell how far it is). */
  | { type: 'exportProgress'; id: number; fraction: number | null }
  | { type: 'exported'; id: number; bytes: ArrayBuffer }
  | { type: 'exportFailed'; id: number; cancelled: boolean; message: string }
  /** The prototypes the pieces draw that weren't drawn before, numbered after the model's (transferred). */
  | { type: 'expanded'; id: number; pieces: ExpandedPiece[]; prototypes: PrototypeMesh[] }
  /** An arrival's nodes, and the prototypes its parts draw, numbered after the model's (transferred). */
  | { type: 'arrived'; id: number; arrival: Arrival; prototypes: PrototypeMesh[] }
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
