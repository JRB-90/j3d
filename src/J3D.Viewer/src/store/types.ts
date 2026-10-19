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

/** A model the manifest lists, in list order, with its hidden part nodes (D82) and, since M13, its moves (D145). */
export interface ManifestModel {
  id: ModelId;
  hidden: number[];
  placements?: KeptPlacement[];
}

/**
 * The scene as stored (D82): the kept models in list order and the camera. It's written to two
 * files in turn with a rising `seq`, so a write cut short by closing the page leaves the other.
 */
export interface Manifest {
  version: 1;
  seq: number;
  models: ManifestModel[];
  camera: CameraSnapshot | null;
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

/** What the store held when the page opened: the models to import again, in order, and the camera. */
export interface StoredScene {
  status: StoreStatus;
  models: StoredModel[];
  camera: CameraSnapshot | null;
}
