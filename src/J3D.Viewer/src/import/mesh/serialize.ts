// A transferable form of the meshes the STL and OBJ loaders produce, so they can be parsed in a
// worker and rebuilt as Three.js objects on the main thread without copying.

import {
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  Mesh,
  Points,
  type Material,
  type Object3D,
} from 'three';

export type SerializedObjectKind = 'mesh' | 'lines' | 'points';

/** Material properties from the file itself (not from an MTL library, which the main thread loads). */
export interface SerializedMaterial {
  name: string;
  vertexColors: boolean;
  flatShading: boolean;
  opacity: number;
}

export interface SerializedAttribute {
  name: string;
  array: Float32Array;
  itemSize: number;
}

export interface SerializedMesh {
  name: string;
  kind: SerializedObjectKind;
  attributes: SerializedAttribute[];
  index?: Uint32Array;
  /** Material ranges; empty when the whole geometry uses `materials[0]`. */
  groups: { start: number; count: number; materialIndex: number }[];
  materials: SerializedMaterial[];
}

export interface SerializedMeshScene {
  meshes: SerializedMesh[];
  /** OBJ `mtllib` names, resolved against the batch's sidecars on the main thread. */
  materialLibraries: string[];
}

export function serializeGeometry(
  name: string,
  kind: SerializedObjectKind,
  geometry: BufferGeometry,
  materials: SerializedMaterial[],
): SerializedMesh {
  const attributes = Object.entries(geometry.attributes).map(([attributeName, attribute]) => ({
    name: attributeName,
    array: toFloat32(attribute.array),
    itemSize: attribute.itemSize,
  }));
  const mesh: SerializedMesh = {
    name,
    kind,
    attributes,
    groups: geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex: materialIndex ?? 0 })),
    materials,
  };
  if (geometry.index) {
    mesh.index = Uint32Array.from(geometry.index.array);
  }
  return mesh;
}

/** Each buffer once: transferring the same buffer twice throws a DataCloneError. */
export function meshTransferables(scene: SerializedMeshScene): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const mesh of scene.meshes) {
    for (const attribute of mesh.attributes) buffers.add(attribute.array.buffer as ArrayBuffer);
    if (mesh.index) buffers.add(mesh.index.buffer as ArrayBuffer);
  }
  return [...buffers];
}

/** Rebuilds one serialized object with the materials chosen by the caller. */
export function buildObject(mesh: SerializedMesh, materialFor: (material: SerializedMaterial, kind: SerializedObjectKind) => Material): Object3D {
  const geometry = new BufferGeometry();
  for (const attribute of mesh.attributes) {
    geometry.setAttribute(attribute.name, new BufferAttribute(attribute.array, attribute.itemSize));
  }
  if (mesh.index) {
    geometry.setIndex(new BufferAttribute(mesh.index, 1));
  }
  for (const group of mesh.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }

  const materials = mesh.materials.map((material) => materialFor(material, mesh.kind));
  const material = materials.length === 1 ? materials[0]! : materials;
  const object =
    mesh.kind === 'lines' ? new LineSegments(geometry, material) : mesh.kind === 'points' ? new Points(geometry, material) : new Mesh(geometry, material);
  object.name = mesh.name;
  return object;
}

function toFloat32(array: ArrayLike<number>): Float32Array {
  // Own buffer, exactly sized, so it can be transferred on its own.
  return array instanceof Float32Array && array.byteOffset === 0 && array.byteLength === array.buffer.byteLength
    ? array
    : Float32Array.from(array);
}
