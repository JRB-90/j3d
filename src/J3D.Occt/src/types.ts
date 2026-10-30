import type { Arrival, EntityMeasure, EntityRef, ExpandedPiece, PairMeasure, PlanNode, PrototypeMesh } from './facade.js';

/**
 * Import phases in the order they occur. OCCT imports go through the first five; mesh imports use
 * only `reading` and `parsing`. Since M16 a restored model with kept edits ends with `applying` them (D203).
 */
export type ImportPhase = 'reading' | 'parsing' | 'transferring' | 'meshing' | 'extracting' | 'applying';

/** Error codes shown in the model list (docs/plan.md §6.2). */
export type ImportErrorCode = 'Unsupported' | 'MissingFile' | 'ParseFailed' | 'Empty' | 'OutOfMemory' | 'Internal';

export interface ImportError {
  code: ImportErrorCode;
  message: string;
}

export type Vector3Tuple = [number, number, number];

/** Axis-aligned bounds in world (Z-up) coordinates. */
export interface Bounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
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

/** The formats OCCT reads. */
export type OcctFormat = 'step' | 'iges' | 'brep';

/** What a BREP model can be saved as (M9, D83). */
export type BrepExportFormat = 'step' | 'brep';

/** Measurement queries to a BREP model's worker (M7), answered one at a time. */
export interface BrepMeasurer {
  entity(entity: EntityRef): Promise<EntityMeasure>;
  /** `shapeB`: entity B exported from another model's worker (D102). */
  pair(a: EntityRef, b: EntityRef, shapeB?: string): Promise<PairMeasure>;
  /** BREP text of an entity, for a pair measured in another model's worker. */
  exportEntity(entity: EntityRef): Promise<string>;
}

/** Saving a BREP model, in its worker (M9, D83, D125): as imported, or its edited tree from a plan (M15). */
export interface BrepExporter {
  /**
   * The file's bytes. `onProgress` gets a fraction, or null while OCCT writes a STEP file. Aborting
   * `signal` stops OCCT and rejects with an {@link ExportCancelledError}; so does removing the model.
   */
  export(
    format: BrepExportFormat,
    options?: { plan?: PlanNode[]; onProgress?: (fraction: number | null) => void; signal?: AbortSignal },
  ): Promise<ArrayBuffer>;
}

/** Reading objects from another model into a BREP model, in its worker (M18, D225). */
export interface BrepArriver {
  /** An arrival's nodes (from `base` on), and the prototypes its parts draw, numbered after the model's others. */
  arrive(file: Blob, base: number): Promise<{ arrival: Arrival; prototypes: PrototypeMesh[] }>;
}

/** Expanding a BREP model's file parts, in its worker (M15, D154). */
export interface BrepExpander {
  /** A file part's pieces, and the prototypes they draw that the model didn't have yet, numbered after its others. */
  expand(node: number): Promise<{ pieces: ExpandedPiece[]; prototypes: PrototypeMesh[] }>;
}

/** An export that was cancelled, or whose model was removed, before it finished. */
export class ExportCancelledError extends Error {
  constructor(message = 'Export cancelled.') {
    super(message);
    this.name = 'ExportCancelledError';
  }
}
