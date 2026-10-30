import type { Bounds, BrepArriver, BrepExpander, BrepExporter, BrepMeasurer, ImportError, ImportPhase, ModelStats } from '@j3d/occt/core';
import type { ExpandedPiece, ImportedScene } from '@j3d/occt/facade';
import type { Object3D } from 'three';
import type { ArrivalContent, ModelEdits } from '../edit/structure.js';
import type { ModelFormat, ModelKind } from '../formats.js';

export { ExportCancelledError } from '@j3d/occt/core';
export type {
  Bounds,
  BrepArriver,
  BrepExpander,
  BrepExporter,
  BrepExportFormat,
  BrepMeasurer,
  ImportError,
  ImportErrorCode,
  ImportPhase,
  ModelStats,
  OcctFormat,
  Vector3Tuple,
} from '@j3d/occt/core';

export type ModelId = string;

export type ModelStatus = 'queued' | 'importing' | 'loaded' | 'failed';

export interface ModelSummary {
  id: ModelId;
  fileName: string;
  format: ModelFormat;
  kind: ModelKind;
  sizeBytes: number;
}

/** A moved node's placement in its parent's frame (node -1: the model's frame), column-major (M13, D145). */
export interface KeptPlacement {
  node: number;
  matrix: number[];
}

/** One node of the model tree. The tree is flat: parents always come before their children. */
export interface TreeNode {
  name: string;
  /** Index of the parent node, or -1 for a root. */
  parent: number;
  /** Index of the prototype a part node draws, or -1 for a group or assembly. */
  prototype: number;
}

/**
 * The geometry of a loaded model, handed to the viewer.
 * - BREP models arrive as plain buffers: each prototype in its part's own coordinates, placed by
 *   world matrices (docs/plan.md §6.1). The viewer builds the Three.js objects.
 * - Mesh models arrive as a ready Three.js object, already rotated to Z-up, with each tree node's object.
 */

/**
 * The arrivals a model has read in (M18), in the order the facade numbers them (a BREP model) or in the
 * order they came (a mesh model), and every arrival file's bytes this visit, to read one in again when
 * an undo and a new arrival have replaced it.
 */
export interface ArrivalsState {
  loaded: (ArrivalContent & { file: string; base: number })[];
  files: Map<string, Blob>;
}

export type ModelContent =
  /**
   * `expansions` are the file parts expanded so far (M15), by file node: their prototypes are appended
   * to the scene's as they arrive.
   */
  | {
      kind: 'brep';
      scene: ImportedScene;
      measure?: BrepMeasurer;
      exporter?: BrepExporter;
      expander?: BrepExpander;
      expansions?: Map<number, ExpandedPiece[]>;
      arriver?: BrepArriver;
      arrivals?: ArrivalsState;
    }
  /**
   * `nodes[i]` is the object of tree node i, for picking and hiding parts (D81). `unitScale` takes
   * model units to millimetres (D105): 1000 for glTF, which is in metres, except J3D's own GLB, which
   * says it's in millimetres (D123); 1 when absent.
   */
  | { kind: 'mesh'; root: Object3D; nodes: Object3D[]; unitScale?: number; arrivals?: ArrivalsState };

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
   * apply as it's added, its moves (M13) and its edits (M14), which have been checked against its tree
   * (R25). The view doesn't fit to it (D111).
   */
  restored?: KeptState;
}

/** What's kept of a model besides its files: hidden parts (D82), moves (M13) and edits (M14). */
export interface KeptState {
  hidden: number[];
  placements?: KeptPlacement[];
  edits?: ModelEdits;
}
