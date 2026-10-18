import { Box3, type BufferGeometry, type InstancedMesh, type Material, type Mesh, type Object3D, type Texture } from 'three';
import type { ImportResult, TreeNode } from '../types';
import { isJ3dEdges } from './j3d-gltf';

/**
 * Tree, counts, bounds and memory of a loaded mesh model.
 * @param root The object handed to the viewer (already Z-up).
 * @param treeRoot The object the tree starts from (the file's own root, inside `root`).
 * @param unitScale Model units to millimetres (D105).
 *
 * A glTF node's name is the file's own (GLTFLoader keeps it in `userData.name`), not three's
 * sanitised copy. The edges of J3D's own GLB belong to their parts and aren't nodes (D124).
 */
export function describeMeshModel(root: Object3D, treeRoot: Object3D, rootName: string, warnings: string[], unitScale = 1): ImportResult {
  root.updateMatrixWorld(true);
  const geometries = new Map<BufferGeometry, number>();
  const textures = new Set<Texture>();
  const tree: TreeNode[] = [];
  const nodes: Object3D[] = [];
  let instances = 0;
  let triangles = 0;

  const visit = (object: Object3D, parent: number) => {
    const index = tree.length;
    let prototype = -1;
    const geometry = (object as Partial<Mesh>).geometry;
    if (geometry) {
      prototype = geometries.get(geometry) ?? geometries.set(geometry, geometries.size).size - 1;
      const count = (object as Partial<InstancedMesh>).isInstancedMesh ? (object as InstancedMesh).count : 1;
      instances += count;
      if ((object as Partial<Mesh>).isMesh) {
        triangles += (count * (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0)) / 3;
      }
      for (const material of materialsOf(object)) {
        texturesOf(material).forEach((texture) => textures.add(texture));
      }
    }
    const fileName = (object.userData as { name?: unknown }).name;
    tree.push({ name: (typeof fileName === 'string' ? fileName : object.name) || (parent < 0 ? rootName : object.type), parent, prototype });
    nodes.push(object);
    for (const child of object.children) {
      if (!isJ3dEdges(child)) {
        visit(child, index);
      }
    }
  };
  visit(treeRoot, -1);

  const box = new Box3().setFromObject(root);
  return {
    content: { kind: 'mesh', root, nodes, ...(unitScale === 1 ? {} : { unitScale }) },
    tree,
    bounds: box.isEmpty() ? { min: [0, 0, 0], max: [0, 0, 0] } : { min: box.min.toArray(), max: box.max.toArray() },
    stats: {
      nodes: tree.length,
      prototypes: geometries.size,
      instances,
      triangles: Math.floor(triangles),
      edges: 0,
      textures: textures.size,
    },
    memoryBytes: geometryBytes(geometries.keys()) + [...textures].reduce((sum, texture) => sum + textureBytes(texture), 0),
    warnings,
  };
}

/** Frees a mesh model's geometry, materials and textures (including decoded ImageBitmaps). */
export function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    (object as Partial<Mesh>).geometry?.dispose();
    for (const material of materialsOf(object)) {
      for (const texture of texturesOf(material)) {
        texture.dispose();
        (texture.image as Partial<ImageBitmap> | null)?.close?.();
      }
      material.dispose();
    }
  });
}

function materialsOf(object: Object3D): Material[] {
  const material = (object as Partial<Mesh>).material;
  return Array.isArray(material) ? material : material ? [material] : [];
}

function texturesOf(material: Material): Texture[] {
  return Object.values(material).filter((value): value is Texture => (value as Partial<Texture> | null)?.isTexture === true);
}

function geometryBytes(geometries: Iterable<BufferGeometry>): number {
  const buffers = new Set<ArrayBufferLike>();
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) {
      buffers.add((attribute as { array: ArrayLike<number> & { buffer: ArrayBufferLike } }).array.buffer);
    }
    if (geometry.index) {
      buffers.add((geometry.index.array as unknown as { buffer: ArrayBufferLike }).buffer);
    }
  }
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}

function textureBytes(texture: Texture): number {
  const mipmaps = (texture as Texture & { mipmaps?: { data?: ArrayBufferView }[] }).mipmaps ?? [];
  const compressed = mipmaps.reduce((sum, mipmap) => sum + (mipmap.data?.byteLength ?? 0), 0);
  if (compressed > 0) {
    return compressed;
  }
  const image = texture.image as { width?: number; height?: number } | null;
  return (image?.width ?? 0) * (image?.height ?? 0) * 4;
}
