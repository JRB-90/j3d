import type { ImportedScene, PrototypeMesh, SceneInstance } from '@j3d/occt/facade';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  type Material,
} from 'three';
import type { MaterialCache } from './materials';

/** Prototypes placed at least this many times are drawn with one instanced draw call (docs/plan.md §6.3). */
export const InstancingThreshold = 16;

export interface BrepObject {
  object: Group;
  /** Frees the geometry and releases the materials. The object is left empty. */
  dispose(): void;
}

/**
 * Builds the Three.js objects of an imported BREP model: one shared geometry per prototype, placed
 * by each instance's world matrix, with its translucent index range drawn by a second material and
 * its BREP edges drawn over it (docs/plan.md §6.3).
 */
export function buildBrepObject(name: string, scene: ImportedScene, materials: MaterialCache): BrepObject {
  const root = new Group();
  root.name = name;
  const geometries: BufferGeometry[] = [];
  const used: Material[] = [];

  const instancesOf = new Map<number, SceneInstance[]>();
  for (const instance of scene.instances) {
    const list = instancesOf.get(instance.prototype);
    if (list) {
      list.push(instance);
    } else {
      instancesOf.set(instance.prototype, [instance]);
    }
  }

  scene.prototypes.forEach((prototype, index) => {
    const instances = instancesOf.get(index);
    if (!instances) {
      return;
    }
    const nameOf = (instance: SceneInstance) => scene.nodes[instance.node]?.name ?? '';
    const instanced = instances.length >= InstancingThreshold;

    if (prototype.indices.length > 0) {
      const geometry = surfaceGeometry(prototype);
      geometries.push(geometry);
      const material = surfaceMaterials(prototype, materials);
      used.push(...(Array.isArray(material) ? material : [material]));
      if (instanced) {
        const mesh = new InstancedMesh(geometry, material, instances.length);
        mesh.name = nameOf(instances[0]!);
        instances.forEach((instance, i) => mesh.setMatrixAt(i, new Matrix4().fromArray(instance.matrix)));
        mesh.computeBoundingSphere();
        root.add(mesh);
      } else {
        for (const instance of instances) {
          root.add(place(new Mesh(geometry, material), instance, nameOf(instance)));
        }
      }
    }

    if (prototype.edges.length > 0) {
      const material = materials.edges(instanced);
      used.push(material);
      if (instanced) {
        const geometry = instancedEdgeGeometry(prototype, instances);
        geometries.push(geometry);
        const lines = new LineSegments(geometry, material);
        lines.name = `${nameOf(instances[0]!)} edges`;
        // The geometry's bounds don't account for the instance transforms.
        lines.frustumCulled = false;
        root.add(lines);
      } else {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(prototype.edges, 3));
        geometries.push(geometry);
        for (const instance of instances) {
          root.add(place(new LineSegments(geometry, material), instance, `${nameOf(instance)} edges`));
        }
      }
    }
  });

  return {
    object: root,
    dispose() {
      root.clear();
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of used) {
        materials.release(material);
      }
      geometries.length = 0;
      used.length = 0;
    },
  };
}

function place<T extends Mesh | LineSegments>(object: T, instance: SceneInstance, name: string): T {
  object.name = name;
  object.matrixAutoUpdate = false;
  object.matrix.fromArray(instance.matrix);
  return object;
}

function surfaceGeometry(prototype: PrototypeMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(prototype.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(prototype.normals, 3));
  geometry.setIndex(new BufferAttribute(prototype.indices, 1));
  if (prototype.colors) {
    geometry.setAttribute('color', new BufferAttribute(toUnorm8(prototype.colors), 4, true));
  }
  const { opaqueIndexCount } = prototype;
  const total = prototype.indices.length;
  if (opaqueIndexCount > 0 && opaqueIndexCount < total) {
    geometry.addGroup(0, opaqueIndexCount, 0);
    geometry.addGroup(opaqueIndexCount, total - opaqueIndexCount, 1);
  }
  return geometry;
}

/** One material, or [opaque, translucent] for the geometry's two groups. */
function surfaceMaterials(prototype: PrototypeMesh, materials: MaterialCache): Material | Material[] {
  const colour = prototype.colors ? null : prototype.uniformColor;
  const { opaqueIndexCount } = prototype;
  const total = prototype.indices.length;
  if (opaqueIndexCount === total) {
    return materials.surface(colour, false);
  }
  if (opaqueIndexCount === 0) {
    return materials.surface(colour, true);
  }
  return [materials.surface(colour, false), materials.surface(colour, true)];
}

/** Linear RGBA floats to normalised bytes: a quarter of the memory, and plenty for flat face colours. */
export function toUnorm8(colours: Float32Array): Uint8Array {
  const bytes = new Uint8Array(colours.length);
  for (let i = 0; i < colours.length; i++) {
    bytes[i] = Math.round(Math.min(Math.max(colours[i]!, 0), 1) * 255);
  }
  return bytes;
}

/** Three has no instanced lines, but any object can draw an InstancedBufferGeometry (see MaterialCache.edges). */
function instancedEdgeGeometry(prototype: PrototypeMesh, instances: SceneInstance[]): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(prototype.edges, 3));
  const matrices = new Float32Array(instances.length * 16);
  instances.forEach((instance, i) => matrices.set(instance.matrix, i * 16));
  geometry.setAttribute('instanceMatrix', new InstancedBufferAttribute(matrices, 16));
  geometry.instanceCount = instances.length;
  return geometry;
}
