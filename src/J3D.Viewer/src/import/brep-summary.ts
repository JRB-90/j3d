import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import type { Bounds, ModelStats, Vector3Tuple } from './types';

/** World bounds and counts of an imported OCCT scene. Runs in the model worker, before transfer. */
export function summariseBrepScene(scene: ImportedScene): { bounds: Bounds; stats: ModelStats } {
  const boxes = scene.prototypes.map(prototypeBounds);
  const min: Vector3Tuple = [Infinity, Infinity, Infinity];
  const max: Vector3Tuple = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let edges = 0;

  for (const instance of scene.instances) {
    const prototype = scene.prototypes[instance.prototype];
    const box = boxes[instance.prototype];
    if (!prototype || !box) {
      continue;
    }
    triangles += prototype.indices.length / 3;
    edges += prototype.edges.length / 6;
    if (box.min[0] > box.max[0]) {
      continue; // no vertices
    }
    for (let corner = 0; corner < 8; corner++) {
      const x = corner & 1 ? box.max[0] : box.min[0];
      const y = corner & 2 ? box.max[1] : box.min[1];
      const z = corner & 4 ? box.max[2] : box.min[2];
      const m = instance.matrix;
      // Column-major 4x4 (Three.js Matrix4.fromArray order).
      const point: Vector3Tuple = [
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      ];
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, point[axis]!);
        max[axis] = Math.max(max[axis]!, point[axis]!);
      }
    }
  }

  return {
    bounds: min[0] <= max[0] ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] },
    stats: {
      nodes: scene.nodes.length,
      prototypes: scene.prototypes.length,
      instances: scene.instances.length,
      triangles,
      edges,
      textures: 0,
    },
  };
}

function prototypeBounds(prototype: PrototypeMesh): Bounds {
  const min: Vector3Tuple = [Infinity, Infinity, Infinity];
  const max: Vector3Tuple = [-Infinity, -Infinity, -Infinity];
  const { positions } = prototype;
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min, max };
}

/** The buffers of a scene, for the `transfer` list of `postMessage`. */
export function sceneTransferables(scene: ImportedScene): ArrayBuffer[] {
  return scene.prototypes.flatMap((p) =>
    [p.positions, p.normals, p.indices, p.edges, ...(p.colors ? [p.colors] : [])].map((array) => array.buffer as ArrayBuffer),
  );
}
