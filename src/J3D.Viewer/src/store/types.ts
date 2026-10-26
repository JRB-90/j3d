import type { ModelEdits } from '../edit/structure';
import type { KeptPlacement, ModelId, ModelSummary } from '../import/types';
import type { Projection } from '../view/camera-math';

/** Where the camera was: what the viewer needs to put it back (D111). */
export interface CameraSnapshot {
  projection: Projection;
  position: [number, number, number];
  target: [number, number, number];
  focalOffset: [number, number, number];
  /** The orthographic camera's zoom; 1 in perspective, where the distance gives the framing. */
  zoom: number;
}

/**
 * A model the manifest lists, in list order, with its hidden part nodes (D82). In version 1 (M13–M15)
 * it also held the model's moves (D145) and edits; since M16 those are in the model's own files (D205).
 */
export interface ManifestModel {
  id: ModelId;
  hidden: number[];
  placements?: KeptPlacement[];
  edits?: ModelEdits;
}

/**
 * The scene as stored (D82): the kept models in list order and the camera. It's written to two
 * files in turn with a rising `seq`, so a write cut short by closing the page leaves the other.
 * Version 2 (M16, D205) leaves each model's moves and edits to its own files.
 */
export interface Manifest {
  version: 1 | 2;
  seq: number;
  models: ManifestModel[];
  camera: CameraSnapshot | null;
}

/**
 * A model's moves (M13, D145) and edits (M14), which the moves are in the frames of: since M16 in the
 * model's own `edits-0.json` and `edits-1.json`, written in turn, only when they change (D205).
 */
export interface KeptEdits {
  placements: KeptPlacement[];
  edits?: ModelEdits;
}

/** One stored file: its name in the model's folder, and the name and path it was imported with. */
export interface StoredFile {
  name: string;
  path: string;
  type: string;
  lastModified: number;
}

/**
 * A model's folder description, written after its files (D113). The first file is the model's own;
 * the rest are the sidecars it used (buffers, materials, textures).
 */
export interface StoredMeta {
  summary: ModelSummary;
  files: StoredFile[];
}

/** A model to import again, as .NET lists it: its summary and the hidden parts to apply on load. */
export interface StoredModel {
  summary: ModelSummary;
  hidden: number[];
}

/**
 * Whether this tab keeps its models (D109): `kept`, or `otherTab` when another J3D tab holds the
 * store, or `unavailable` when the browser gives this page no private file system.
 */
export type StoreStatus = 'kept' | 'otherTab' | 'unavailable';

/**
 * What the store held when the page opened: the models to import again, in order, and the camera; and
 * since M16 how many kept models couldn't be read this time, which stay kept for the next (D200).
 */
export interface StoredScene {
  status: StoreStatus;
  models: StoredModel[];
  camera: CameraSnapshot | null;
  unreadable: number;
}
