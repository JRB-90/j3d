// Mesh objects moving between mesh models (M18, D227, D228): written as J3D's GLB for the model they
// arrive in, which keeps the file and reads it back on restore. Loaded with the first transfer.

import { Group, Matrix4, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TopLevel, type ArrivalContent, type ModelStructure } from '../edit/structure';
import { joinRanges } from '../import/mesh/gltf-import';
import { isJ3dEdges, J3dRangesTag } from '../import/mesh/j3d-gltf';
import { writeMeshFile } from './mesh-export';
import { cloneNode } from './parts';

/** `userData` (glTF `extras`) key of each written node's place in the arrival, so it's found again whatever the loader adds. */
const ArrivalTag = 'j3dArrival';

/**
 * Objects of a mesh model as a GLB arrival: an assembly holding each object, at the placement given (its
 * place in the target model's frame), with every live node under it in tree order, hidden ones
 * included and drawn (D229). `order` is the nodes written after the assembly, as the arrival numbers them.
 */
export async function writeMeshArrival(
  structure: ModelStructure,
  objectOf: (node: number) => Object3D,
  objects: readonly { node: number; matrix: Matrix4 }[],
): Promise<{ bytes: Uint8Array<ArrayBuffer>; order: number[] }> {
  const root = new Group();
  root.userData[ArrivalTag] = 0;
  const order: number[] = [];
  const visit = (node: number, parent: Object3D, matrix: Matrix4) => {
    const copy = cloneNode(objectOf(node));
    copy.visible = true;
    matrix.decompose(copy.position, copy.quaternion, copy.scale);
    order.push(node);
    copy.userData = { ...copy.userData, [ArrivalTag]: order.length };
    // A mesh of several materials is written as primitives on its vertices, which the loader joins back.
    if (Array.isArray((copy as Partial<Mesh>).material)) {
      copy.userData['j3d'] = J3dRangesTag;
    }
    parent.add(copy);
    for (const child of structure.childrenOf(node)) {
      if (structure.isLive(child)) {
        visit(child, copy, localOf(objectOf(child)));
      }
    }
  };
  for (const { node, matrix } of objects) {
    visit(node, root, matrix);
  }
  root.updateMatrixWorld(true);
  return { bytes: await writeMeshFile(root, 'glb'), order };
}

/**
 * A mesh arrival read from its GLB: the nodes in the order they were written, the assembly first, each
 * with its parent, whether it draws, and its placement in its parent's frame; and their objects.
 */
export async function readMeshArrival(file: Blob): Promise<ArrivalContent> {
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  joinRanges(gltf.scene);
  const tagged = new Map<number, Object3D>();
  gltf.scene.traverse((object) => {
    const index = (object.userData as Record<string, unknown>)[ArrivalTag];
    if (typeof index === 'number' && !isJ3dEdges(object)) {
      tagged.set(index, object);
    }
  });
  const nodes: ArrivalContent['nodes'][number][] = [];
  const objects: Object3D[] = [];
  for (let index = 0; index < tagged.size; index++) {
    const object = tagged.get(index);
    if (!object) {
      throw new Error('The objects that arrived are incomplete.');
    }
    let parent = TopLevel;
    for (let above = object.parent; above && parent === TopLevel; above = above.parent) {
      const value = (above.userData as Record<string, unknown>)[ArrivalTag];
      parent = typeof value === 'number' ? value : TopLevel;
    }
    object.updateMatrix();
    const name = (object.userData as { name?: unknown }).name;
    nodes.push({
      name: typeof name === 'string' ? name : object.name,
      parent,
      prototype: (object as Partial<Mesh>).geometry ? 0 : -1,
      matrix: new Matrix4().copy(object.matrix).toArray(),
    });
    objects.push(object);
  }
  return { nodes, objects };
}

/** An object's placement in its parent's frame, up to date with its position, turn and scale. */
function localOf(object: Object3D): Matrix4 {
  if (object.matrixAutoUpdate) {
    object.updateMatrix();
  }
  return object.matrix.clone();
}
