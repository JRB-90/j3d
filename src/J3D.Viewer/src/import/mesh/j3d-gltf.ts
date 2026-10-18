import type { Object3D } from 'three';

// What marks J3D's own GLB (M9). Kept apart from gltf-import.ts so the viewer and the exporter can use
// it without loading three's glTF loaders, which come with the first mesh import.

/**
 * J3D's GLB's `asset.extras` (D123): the file is Z-up and in millimetres, as J3D shows models, so J3D
 * reads it back as it is. Other tools ignore it.
 */
export const J3dGltfMarker = { unit: 'mm', up: 'z' } as const;

/** `userData.j3d` (glTF `extras.j3d`) of the line objects J3D writes for a BREP part's edges (D124). */
export const J3dEdgesTag = 'edges';

/**
 * `userData.j3d` of a part whose faces are drawn in two ranges, opaque and translucent: one glTF mesh of
 * two primitives, which three's loader turns into a group of two meshes, and J3D joins back into one.
 */
export const J3dRangesTag = 'ranges';

/** Whether an object is a BREP part's edges in J3D's GLB: drawn with its part, but not a part. */
export function isJ3dEdges(object: Object3D): boolean {
  return (object.userData as { j3d?: unknown }).j3d === J3dEdgesTag;
}

/** Whether a glTF file's `asset` carries J3D's marker. */
export function isJ3dGltf(asset: { extras?: { unit?: unknown; up?: unknown } } | undefined): boolean {
  return asset?.extras?.unit === J3dGltfMarker.unit && asset.extras.up === J3dGltfMarker.up;
}
