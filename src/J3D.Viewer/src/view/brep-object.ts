import type { ImportedScene, PrototypeMesh, SceneInstance } from '@j3d/occt/facade';
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Vector3,
  type Material,
  type MeshStandardMaterial,
} from 'three';
import type { LinearRgba, MaterialCache } from './materials';

/** Prototypes placed at least this many times are drawn with one instanced draw call (docs/plan.md §6.3). */
export const InstancingThreshold = 16;

export interface BrepObject {
  object: Group;
  /** Frees the geometry and releases the materials. The object is left empty. */
  dispose(): void;
}

/** The surfaces drawn with one material: each prototype range once, and an instance per placement. */
interface Batch {
  geometries: BufferGeometry[];
  placements: { geometry: number; matrix: readonly number[] }[];
}

/**
 * Builds the Three.js objects of an imported BREP model (docs/plan.md §6.3). A prototype placed
 * {@link InstancingThreshold} times or more is one InstancedMesh, with instanced edges. Everything
 * else is batched, so a model of thousands of parts costs a few draw calls rather than two per part
 * (decision D63): one BatchedMesh per surface material, holding each prototype's index range once and
 * an instance per placement, and one LineSegments of all their edges, already transformed. A
 * prototype's translucent index range is drawn with its own, transparent material (D34).
 */
export function buildBrepObject(name: string, scene: ImportedScene, materials: MaterialCache): BrepObject {
  const root = new Group();
  root.name = name;
  const owned: { dispose(): void }[] = [];
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

  const batches = new Map<MeshStandardMaterial, Batch>();
  const looseEdges: { edges: Float32Array; matrix: readonly number[] }[] = [];

  scene.prototypes.forEach((prototype, index) => {
    const instances = instancesOf.get(index);
    if (!instances) {
      return;
    }
    if (instances.length >= InstancingThreshold) {
      const nameOf = (instance: SceneInstance) => scene.nodes[instance.node]?.name ?? '';
      root.add(...instancedObjects(prototype, instances, nameOf(instances[0]!), materials, owned, used));
      return;
    }

    for (const range of surfaceRanges(prototype)) {
      const material = materials.surface(prototype.colors ? null : prototype.uniformColor, range.translucent);
      used.push(material);
      let batch = batches.get(material);
      if (!batch) {
        batch = { geometries: [], placements: [] };
        batches.set(material, batch);
      }
      const geometry = batch.geometries.push(range.geometry) - 1;
      for (const instance of instances) {
        batch.placements.push({ geometry, matrix: instance.matrix });
      }
    }
    if (prototype.edges.length > 0) {
      for (const instance of instances) {
        looseEdges.push({ edges: prototype.edges, matrix: instance.matrix });
      }
    }
  });

  const matrix = new Matrix4();
  for (const [material, { geometries, placements }] of batches) {
    const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
    const indices = geometries.reduce((sum, g) => sum + g.index!.count, 0);
    const batch = new BatchedMesh(placements.length, vertices, indices, material);
    batch.name = `${name} surfaces`;
    // Back to front for translucent parts; opaque ones gain nothing from sorting.
    batch.sortObjects = material.transparent;
    const ids = geometries.map((geometry) => batch.addGeometry(geometry));
    for (const placement of placements) {
      batch.setMatrixAt(batch.addInstance(ids[placement.geometry]!), matrix.fromArray(placement.matrix));
    }
    batch.computeBoundingSphere();
    root.add(batch);
    owned.push(batch);
  }

  if (looseEdges.length > 0) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(transformedEdges(looseEdges), 3));
    owned.push(geometry);
    const material = materials.edges(false);
    used.push(material);
    const lines = new LineSegments(geometry, material);
    lines.name = `${name} edges`;
    root.add(lines);
  }

  return {
    object: root,
    dispose() {
      root.clear();
      for (const object of owned) {
        object.dispose();
      }
      for (const material of used) {
        materials.release(material);
      }
      owned.length = 0;
      used.length = 0;
    },
  };
}

/** An InstancedMesh of a much-placed prototype and one LineSegments of its instanced edges. */
function instancedObjects(
  prototype: PrototypeMesh,
  instances: SceneInstance[],
  name: string,
  materials: MaterialCache,
  owned: { dispose(): void }[],
  used: Material[],
): (InstancedMesh | LineSegments)[] {
  const objects: (InstancedMesh | LineSegments)[] = [];
  if (prototype.indices.length > 0) {
    const geometry = surfaceGeometry(prototype);
    owned.push(geometry);
    const material = surfaceMaterials(prototype, materials);
    used.push(...(Array.isArray(material) ? material : [material]));
    const mesh = new InstancedMesh(geometry, material, instances.length);
    mesh.name = name;
    instances.forEach((instance, i) => mesh.setMatrixAt(i, new Matrix4().fromArray(instance.matrix)));
    mesh.computeBoundingSphere();
    objects.push(mesh);
  }
  if (prototype.edges.length > 0) {
    const material = materials.edges(true);
    used.push(material);
    const geometry = instancedEdgeGeometry(prototype, instances);
    owned.push(geometry);
    const lines = new LineSegments(geometry, material);
    lines.name = `${name} edges`;
    // The geometry's bounds don't account for the instance transforms.
    lines.frustumCulled = false;
    objects.push(lines);
  }
  return objects;
}

/**
 * A prototype's opaque and translucent index ranges as separate geometries, since a batch draws
 * each geometry with one material. Both share the prototype's vertex arrays; the batch copies them.
 */
function surfaceRanges(prototype: PrototypeMesh): { geometry: BufferGeometry; translucent: boolean }[] {
  const { opaqueIndexCount, indices } = prototype;
  const ranges = [
    { indices: indices.subarray(0, opaqueIndexCount), translucent: false },
    { indices: indices.subarray(opaqueIndexCount), translucent: true },
  ];
  return ranges
    .filter((range) => range.indices.length > 0)
    .map((range) => {
      const geometry = vertexGeometry(prototype);
      geometry.setIndex(new BufferAttribute(range.indices, 1));
      return { geometry, translucent: range.translucent };
    });
}

function vertexGeometry(prototype: PrototypeMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(prototype.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(prototype.normals, 3));
  if (prototype.colors) {
    geometry.setAttribute('color', new BufferAttribute(toUnorm8(prototype.colors), 4, true));
  }
  return geometry;
}

function surfaceGeometry(prototype: PrototypeMesh): BufferGeometry {
  const geometry = vertexGeometry(prototype);
  geometry.setIndex(new BufferAttribute(prototype.indices, 1));
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
  const colour: LinearRgba | null = prototype.colors ? null : prototype.uniformColor;
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

/** Every placement's edge segments moved into model space, in one array. */
function transformedEdges(placements: { edges: Float32Array; matrix: readonly number[] }[]): Float32Array {
  const positions = new Float32Array(placements.reduce((sum, p) => sum + p.edges.length, 0));
  const matrix = new Matrix4();
  const point = new Vector3();
  let offset = 0;
  for (const { edges, matrix: elements } of placements) {
    matrix.fromArray(elements);
    for (let i = 0; i < edges.length; i += 3) {
      point.set(edges[i]!, edges[i + 1]!, edges[i + 2]!).applyMatrix4(matrix);
      positions[offset++] = point.x;
      positions[offset++] = point.y;
      positions[offset++] = point.z;
    }
  }
  return positions;
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
