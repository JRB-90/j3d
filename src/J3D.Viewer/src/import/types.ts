import type { EntityMeasure, EntityRef, ImportedScene, PairMeasure } from '@j3d/occt/facade';
import type { Object3D } from 'three';
import type { ModelFormat, ModelKind } from '../formats';
import type { BrepExportFormat } from './protocol';

export type ModelId = string;

/**
 * Import phases in the order they occur. OCCT imports go through all of them; mesh imports use
 * only `reading` and `parsing`.
 */
export type ImportPhase = 'reading' | 'parsing' | 'transferring' | 'meshing' | 'extracting';

/** Error codes shown in the model list (docs/plan.md §6.2). */
export type ImportErrorCode = 'Unsupported' | 'MissingFile' | 'ParseFailed' | 'Empty' | 'OutOfMemory' | 'Internal';

export interface ImportError {
  code: ImportErrorCode;
  message: string;
}

export type ModelStatus = 'queued' | 'importing' | 'loaded' | 'failed';

export interface ModelSummary {
  id: ModelId;
  fileName: string;
  format: ModelFormat;
  kind: ModelKind;
  sizeBytes: number;
}

export type Vector3Tuple = [number, number, number];

/** Axis-aligned bounds in world (Z-up) coordinates. */
export interface Bounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

/** One node of the model tree. The tree is flat: parents always come before their children. */
export interface TreeNode {
  name: string;
  /** Index of the parent node, or -1 for a root. */
  parent: number;
  /** Index of the prototype a part node draws, or -1 for a group or assembly. */
  prototype: number;
}

export interface ModelStats {
  nodes: number;
  /** Unique meshes (BREP: unique part + style; mesh models: geometries). */
  prototypes: number;
  /** Placements of those meshes in the scene. */
  instances: number;
  /** Triangles drawn, counting every instance. */
  triangles: number;
  /** BREP edge segments drawn, counting every instance. Always 0 for mesh models. */
  edges: number;
  /** Textures referenced by materials. */
  textures: number;
}

/**
 * The geometry of a loaded model, handed to the viewer.
 * - BREP models arrive as plain buffers: each prototype in its part's own coordinates, placed by
 *   world matrices (docs/plan.md §6.1). The viewer builds the Three.js objects.
 * - Mesh models arrive as a ready Three.js object, already rotated to Z-up, with each tree node's object.
 */
/** Measurement queries to a BREP model's worker (M7), answered one at a time. */
export interface BrepMeasurer {
  entity(entity: EntityRef): Promise<EntityMeasure>;
  /** `shapeB`: entity B exported from another model's worker (D102). */
  pair(a: EntityRef, b: EntityRef, shapeB?: string): Promise<PairMeasure>;
  /** BREP text of an entity, for a pair measured in another model's worker. */
  exportEntity(entity: EntityRef): Promise<string>;
}

/** Saving a BREP model as imported, in its worker (M9, D83, D125). */
export interface BrepExporter {
  /**
   * The file's bytes. `onProgress` gets a fraction, or null while OCCT writes a STEP file. Aborting
   * `signal` stops OCCT and rejects with an {@link ExportCancelledError}; so does removing the model.
   */
  export(format: BrepExportFormat, options?: { onProgress?: (fraction: number | null) => void; signal?: AbortSignal }): Promise<ArrayBuffer>;
}

/** An export that was cancelled, or whose model was removed, before it finished. */
export class ExportCancelledError extends Error {
  constructor(message = 'Export cancelled.') {
    super(message);
    this.name = 'ExportCancelledError';
  }
}

export type ModelContent =
  | { kind: 'brep'; scene: ImportedScene; measure?: BrepMeasurer; exporter?: BrepExporter }
  /**
   * `nodes[i]` is the object of tree node i, for picking and hiding parts (D81). `unitScale` takes
   * model units to millimetres (D105): 1000 for glTF, which is in metres, except J3D's own GLB, which
   * says it's in millimetres (D123); 1 when absent.
   */
  | { kind: 'mesh'; root: Object3D; nodes: Object3D[]; unitScale?: number };

/** What an import produces, before the manager attaches the model's summary. */
export interface ImportResult {
  content: ModelContent;
  tree: TreeNode[];
  bounds: Bounds;
  stats: ModelStats;
  /** Memory held for the model: the worker's WASM heap (BREP) or geometry and texture bytes (mesh). */
  memoryBytes: number;
  /** Non-fatal problems, such as textures that weren't supplied. */
  warnings: string[];
}

export interface LoadedModel extends ImportResult {
  summary: ModelSummary;
  /**
   * Imported again from its kept files, after a reload or an undone delete (M8): the hidden parts to
   * apply as it's added. The view doesn't fit to it (D111).
   */
  restored?: { hidden: number[] };
}
