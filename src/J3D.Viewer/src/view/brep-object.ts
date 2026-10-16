import { EntityKind, type ImportedScene, type PrototypeMesh, type SceneInstance } from '@j3d/occt/facade';
import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  Vector3,
  type Intersection,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { EdgeVisibilityAttribute, type LinearRgba, type MaterialCache } from './materials';
import {
  EdgePickRadius,
  pointHighlight,
  VertexPickRadius,
  type Highlight,
  type HighlightKind,
  type HighlightMaterials,
  type ModelParts,
  type PickedEntity,
  type ScreenSpace,
} from './parts';

/** Prototypes placed at least this many times are drawn with one instanced draw call (docs/plan.md §6.3). */
export const InstancingThreshold = 16;

export interface BrepObject {
  object: Group;
  /** Picking, visibility and highlighting by tree node (D93–D95). */
  parts: ModelParts;
  /** Frees the geometry and releases the materials. The object is left empty. */
  dispose(): void;
}

/** The surfaces drawn with one material: each prototype range once, and an instance per placement. */
interface Batch {
  geometries: BufferGeometry[];
  /** Where each geometry's indices start in its prototype's index array: 0, or after the opaque ones. */
  offsets: number[];
  placements: { geometry: number; instance: number }[];
}

/** Where one placement (scene instance) is drawn, so it can be hidden on its own. */
interface PlacementSlots {
  surfaces: ({ batch: BatchedMesh; id: number } | { mesh: InstancedMesh; index: number })[];
  edges?: { visibility: BufferAttribute; start: number; count: number } | { matrices: InstancedBufferAttribute; index: number };
}

/**
 * Builds the Three.js objects of an imported BREP model (docs/plan.md §6.3). A prototype placed
 * {@link InstancingThreshold} times or more is one InstancedMesh, with instanced edges. Everything
 * else is batched, so a model of thousands of parts costs a few draw calls rather than two per part
 * (decision D63): one BatchedMesh per surface material, holding each prototype's index range once and
 * an instance per placement, and one LineSegments of all their edges, already transformed. A
 * prototype's translucent index range is drawn with its own, transparent material (D34).
 *
 * Every placement remembers where it's drawn, so it can be hidden by itself: a batch instance is
 * switched off, an instanced copy gets a zero matrix, and its merged edges are dropped through a
 * per-vertex visibility attribute (D94).
 */
export function buildBrepObject(name: string, scene: ImportedScene, materials: MaterialCache): BrepObject {
  const root = new Group();
  root.name = name;
  const owned: { dispose(): void }[] = [];
  const used: Material[] = [];
  const slots: PlacementSlots[] = scene.instances.map(() => ({ surfaces: [] }));
  const pickedPlacement = new Map<Object3D, Int32Array>();
  const indexOffsets = new Map<BatchedMesh, number[]>();

  const instancesOf = new Map<number, number[]>();
  scene.instances.forEach((instance, index) => {
    const list = instancesOf.get(instance.prototype);
    if (list) {
      list.push(index);
    } else {
      instancesOf.set(instance.prototype, [index]);
    }
  });

  const batches = new Map<MeshStandardMaterial, Batch>();
  const looseEdges: { edges: Float32Array; matrix: readonly number[]; instance: number }[] = [];

  scene.prototypes.forEach((prototype, index) => {
    const instances = instancesOf.get(index);
    if (!instances) {
      return;
    }
    if (instances.length >= InstancingThreshold) {
      const nodeName = scene.nodes[scene.instances[instances[0]!]!.node]?.name ?? '';
      root.add(...instancedObjects(prototype, instances, scene.instances, nodeName, materials, owned, used, slots, pickedPlacement));
      return;
    }

    for (const range of surfaceRanges(prototype)) {
      const material = materials.surface(prototype.colors ? null : prototype.uniformColor, range.translucent);
      used.push(material);
      let batch = batches.get(material);
      if (!batch) {
        batch = { geometries: [], offsets: [], placements: [] };
        batches.set(material, batch);
      }
      const geometry = batch.geometries.push(range.geometry) - 1;
      batch.offsets.push(range.translucent ? prototype.opaqueIndexCount : 0);
      for (const instance of instances) {
        batch.placements.push({ geometry, instance });
      }
    }
    if (prototype.edges.length > 0) {
      for (const instance of instances) {
        looseEdges.push({ edges: prototype.edges, matrix: scene.instances[instance]!.matrix, instance });
      }
    }
  });

  const matrix = new Matrix4();
  for (const [material, { geometries, offsets, placements }] of batches) {
    const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
    const indices = geometries.reduce((sum, g) => sum + g.index!.count, 0);
    const batch = new BatchedMesh(placements.length, vertices, indices, material);
    batch.name = `${name} surfaces`;
    // Back to front for translucent parts; opaque ones gain nothing from sorting.
    batch.sortObjects = material.transparent;
    const ids = geometries.map((geometry) => batch.addGeometry(geometry));
    const offsetOf: number[] = [];
    ids.forEach((id, g) => (offsetOf[id] = offsets[g]!));
    indexOffsets.set(batch, offsetOf);
    const placementOf = new Int32Array(placements.length);
    for (const placement of placements) {
      const id = batch.addInstance(ids[placement.geometry]!);
      batch.setMatrixAt(id, matrix.fromArray(scene.instances[placement.instance]!.matrix));
      placementOf[id] = placement.instance;
      slots[placement.instance]!.surfaces.push({ batch, id });
    }
    batch.computeBoundingSphere();
    pickedPlacement.set(batch, placementOf);
    root.add(batch);
    owned.push(batch);
  }

  if (looseEdges.length > 0) {
    const geometry = new BufferGeometry();
    const positions = transformedEdges(looseEdges);
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const visibility = new BufferAttribute(new Uint8Array(positions.length / 3).fill(1), 1);
    geometry.setAttribute(EdgeVisibilityAttribute, visibility);
    let start = 0;
    for (const { edges, instance } of looseEdges) {
      const count = edges.length / 3;
      slots[instance]!.edges = { visibility, start, count };
      start += count;
    }
    owned.push(geometry);
    const material = materials.edges(false);
    used.push(material);
    const lines = new LineSegments(geometry, material);
    lines.name = `${name} edges`;
    lines.raycast = noRaycast; // parts are picked by their faces; testing every edge segment would be slow
    root.add(lines);
  }

  const parts = new BrepParts(scene, slots, pickedPlacement, indexOffsets);
  return {
    object: root,
    parts,
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
      parts.dispose();
    },
  };
}

/**
 * A BREP model's parts: each scene instance's tree node. Keeps the imported prototypes, which the
 * highlight draws again (D93), and works out a placement's bounds from its prototype's.
 */
class BrepParts implements ModelParts {
  readonly partNodes: readonly number[];
  private readonly placementsOf = new Map<number, number[]>();
  private readonly hiddenPlacements: Uint8Array;
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private overlayGeometries = new Map<number, BufferGeometry>();
  private placementBoxes: Float64Array | undefined;

  constructor(
    private readonly scene: ImportedScene,
    private readonly slots: readonly PlacementSlots[],
    private readonly pickedPlacement: ReadonlyMap<Object3D, Int32Array>,
    private readonly indexOffsets: ReadonlyMap<BatchedMesh, readonly number[]>,
  ) {
    scene.instances.forEach((instance, index) => {
      const list = this.placementsOf.get(instance.node);
      if (list) {
        list.push(index);
      } else {
        this.placementsOf.set(instance.node, [index]);
      }
    });
    this.partNodes = [...this.placementsOf.keys()].sort((a, b) => a - b);
    this.hiddenPlacements = new Uint8Array(scene.instances.length);
  }

  nodeOf(hit: Intersection): number {
    const placement = this.placementOf(hit);
    return placement === undefined ? -1 : (this.scene.instances[placement]?.node ?? -1);
  }

  /**
   * A vertex within reach of the pointer, else an edge, else the face under it (D107). Vertices and
   * edges are found on screen, and only count if nothing nearer the camera hides them.
   */
  entityAt(hit: Intersection, screen: ScreenSpace): PickedEntity | undefined {
    const placement = this.placementOf(hit);
    if (placement === undefined) {
      return undefined;
    }
    const instance = this.scene.instances[placement]!;
    const mesh = this.scene.prototypes[instance.prototype]!;
    const matrix = new Matrix4().fromArray(instance.matrix);
    const boxes = (this.placementBoxes ??= this.computePlacementBoxes());
    const tolerance =
      Math.hypot(boxes[placement * 6 + 3]! - boxes[placement * 6]!, boxes[placement * 6 + 4]! - boxes[placement * 6 + 1]!, boxes[placement * 6 + 5]! - boxes[placement * 6 + 2]!) * 0.01;
    const visible = (depth: number) => depth <= screen.hitDepth + tolerance;
    const ref = (kind: EntityKind, index: number) => ({ kind, prototype: instance.prototype, index, matrix: instance.matrix });
    const point = new Vector3();

    let vertex: { index: number; distance: number; point: Vector3 } | undefined;
    for (let i = 0; i < mesh.vertices.length / 3; i++) {
      point.fromArray(mesh.vertices, i * 3).applyMatrix4(matrix);
      const onScreen = screen.project(point);
      const distance = Math.hypot(onScreen.x - screen.x, onScreen.y - screen.y);
      if (distance <= VertexPickRadius && visible(onScreen.depth) && (!vertex || distance < vertex.distance)) {
        vertex = { index: i, distance, point: point.clone() };
      }
    }
    if (vertex) {
      return { kind: 'vertex', node: instance.node, ref: ref(EntityKind.Vertex, vertex.index), point: vertex.point.toArray() };
    }

    const a = new Vector3();
    const b = new Vector3();
    let edge: { index: number; distance: number; point: Vector3 } | undefined;
    for (let e = 0; e < mesh.edgeRanges.length / 2; e++) {
      const first = mesh.edgeRanges[e * 2]!;
      const count = mesh.edgeRanges[e * 2 + 1]!;
      for (let p = first; p < first + count; p += 2) {
        a.fromArray(mesh.edges, p * 3).applyMatrix4(matrix);
        b.fromArray(mesh.edges, p * 3 + 3).applyMatrix4(matrix);
        const sa = screen.project(a);
        const sb = screen.project(b);
        const dx = sb.x - sa.x;
        const dy = sb.y - sa.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 > 0 ? Math.min(1, Math.max(0, ((screen.x - sa.x) * dx + (screen.y - sa.y) * dy) / length2)) : 0;
        const distance = Math.hypot(sa.x + dx * t - screen.x, sa.y + dy * t - screen.y);
        if (distance <= EdgePickRadius && visible(sa.depth + (sb.depth - sa.depth) * t) && (!edge || distance < edge.distance)) {
          edge = { index: e, distance, point: a.clone().lerp(b, t) };
        }
      }
    }
    if (edge) {
      return { kind: 'edge', node: instance.node, ref: ref(EntityKind.Edge, edge.index), point: edge.point.toArray() };
    }

    const position = this.indexPosition(hit);
    if (position === undefined) {
      return undefined;
    }
    for (let f = 0; f < mesh.faceRanges.length / 2; f++) {
      const start = mesh.faceRanges[f * 2]!;
      if (position >= start && position < start + mesh.faceRanges[f * 2 + 1]!) {
        return { kind: 'face', node: instance.node, ref: ref(EntityKind.Face, f), point: hit.point.toArray() };
      }
    }
    return undefined;
  }

  /** A face's triangles, an edge's segments or a vertex's dot, where the placement puts them. */
  entityHighlight(entity: PickedEntity, kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined {
    if (entity.kind === 'point' || entity.kind === 'vertex') {
      return pointHighlight(entity.point, kind, materials);
    }
    const mesh = this.scene.prototypes[entity.ref.prototype];
    if (!mesh) {
      return undefined;
    }
    const geometry = new BufferGeometry();
    const order = materials.renderOrder(kind);
    let object: Mesh | LineSegments;
    if (entity.kind === 'face') {
      const start = mesh.faceRanges[entity.ref.index * 2]!;
      const count = mesh.faceRanges[entity.ref.index * 2 + 1]!;
      geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
      geometry.setIndex(new BufferAttribute(mesh.indices.subarray(start, start + count), 1));
      object = new Mesh(geometry, materials.surface(kind));
      object.renderOrder = order.surface;
    } else {
      const first = mesh.edgeRanges[entity.ref.index * 2]!;
      const count = mesh.edgeRanges[entity.ref.index * 2 + 1]!;
      geometry.setAttribute('position', new BufferAttribute(mesh.edges.subarray(first * 3, (first + count) * 3), 3));
      object = new LineSegments(geometry, materials.edges(kind));
      object.renderOrder = order.edges;
    }
    object.matrixAutoUpdate = false;
    object.matrix.fromArray(entity.ref.matrix);
    object.raycast = noRaycast;
    return {
      object,
      dispose() {
        geometry.dispose();
      },
    };
  }

  /** The placement an intersection hit: a batch instance or an instanced copy. */
  private placementOf(hit: Intersection): number | undefined {
    const placements = this.pickedPlacement.get(hit.object);
    const id = (hit as Intersection & { batchId?: number }).batchId ?? hit.instanceId;
    return placements !== undefined && id !== undefined ? placements[id] : undefined;
  }

  /** Where the hit triangle starts in its prototype's index array. */
  private indexPosition(hit: Intersection): number | undefined {
    if (hit.faceIndex === undefined || hit.faceIndex === null) {
      return undefined;
    }
    if (hit.object instanceof BatchedMesh) {
      const batchId = (hit as Intersection & { batchId?: number }).batchId!;
      const geometryId = hit.object.getGeometryIdAt(batchId);
      const range = hit.object.getGeometryRangeAt(geometryId);
      return hit.faceIndex * 3 - (range?.indexStart ?? 0) + (this.indexOffsets.get(hit.object)?.[geometryId] ?? 0);
    }
    return hit.faceIndex * 3; // an InstancedMesh draws the prototype's whole index array
  }

  setHidden(hidden: ReadonlySet<number>): void {
    const changed = new Set<BufferAttribute | InstancedBufferAttribute>();
    const instanced = new Set<InstancedMesh>();
    this.scene.instances.forEach((instance, placement) => {
      const hide = hidden.has(instance.node) ? 1 : 0;
      if (hide === this.hiddenPlacements[placement]) {
        return;
      }
      this.hiddenPlacements[placement] = hide;
      const matrix = hide ? this.zero : new Matrix4().fromArray(instance.matrix);
      const slot = this.slots[placement]!;
      for (const surface of slot.surfaces) {
        if ('batch' in surface) {
          surface.batch.setVisibleAt(surface.id, !hide);
        } else {
          surface.mesh.setMatrixAt(surface.index, matrix);
          instanced.add(surface.mesh);
        }
      }
      const edges = slot.edges;
      if (edges && 'visibility' in edges) {
        (edges.visibility.array as Uint8Array).fill(hide ? 0 : 1, edges.start, edges.start + edges.count);
        changed.add(edges.visibility);
      } else if (edges) {
        matrix.toArray(edges.matrices.array, edges.index * 16);
        changed.add(edges.matrices);
      }
    });
    instanced.forEach((mesh) => (mesh.instanceMatrix.needsUpdate = true));
    changed.forEach((attribute) => (attribute.needsUpdate = true));
  }

  addVisibleBounds(target: Box3): Box3 {
    const boxes = (this.placementBoxes ??= this.computePlacementBoxes());
    const box = new Box3();
    for (let placement = 0; placement < this.hiddenPlacements.length; placement++) {
      if (!this.hiddenPlacements[placement] && boxes[placement * 6]! <= boxes[placement * 6 + 3]!) {
        box.min.fromArray(boxes, placement * 6);
        box.max.fromArray(boxes, placement * 6 + 3);
        target.union(box);
      }
    }
    return target;
  }

  nodeBounds(node: number): Box3 {
    const boxes = (this.placementBoxes ??= this.computePlacementBoxes());
    const bounds = new Box3();
    const box = new Box3();
    for (const placement of this.placementsOf.get(node) ?? []) {
      if (boxes[placement * 6]! <= boxes[placement * 6 + 3]!) {
        bounds.union(box.set(new Vector3().fromArray(boxes, placement * 6), new Vector3().fromArray(boxes, placement * 6 + 3)));
      }
    }
    return bounds;
  }

  /**
   * One BatchedMesh of the parts' surfaces in the overlay material, and one LineSegments of their
   * edges, so even a selection of thousands of parts is two draw calls.
   */
  highlight(nodes: readonly number[], kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined {
    const placements = nodes.flatMap((node) => this.placementsOf.get(node) ?? []);
    const surfaced = placements.filter((placement) => this.scene.prototypes[this.scene.instances[placement]!.prototype]!.indices.length > 0);
    const group = new Group();
    const disposables: { dispose(): void }[] = [];
    const order = materials.renderOrder(kind);

    if (surfaced.length > 0) {
      const prototypes = [...new Set(surfaced.map((placement) => this.scene.instances[placement]!.prototype))];
      const geometries = prototypes.map((prototype) => this.overlayGeometry(prototype));
      const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
      const indices = geometries.reduce((sum, g) => sum + g.index!.count, 0);
      const batch = new BatchedMesh(surfaced.length, vertices, indices, materials.surface(kind));
      const ids = new Map(prototypes.map((prototype, i) => [prototype, batch.addGeometry(geometries[i]!)]));
      const matrix = new Matrix4();
      for (const placement of surfaced) {
        const instance = this.scene.instances[placement]!;
        batch.setMatrixAt(batch.addInstance(ids.get(instance.prototype)!), matrix.fromArray(instance.matrix));
      }
      batch.computeBoundingSphere();
      batch.renderOrder = order.surface;
      batch.raycast = noRaycast;
      group.add(batch);
      disposables.push(batch);
    }

    const edges = placements
      .map((placement) => this.scene.instances[placement]!)
      .filter((instance) => this.scene.prototypes[instance.prototype]!.edges.length > 0)
      .map((instance) => ({ edges: this.scene.prototypes[instance.prototype]!.edges, matrix: instance.matrix }));
    if (edges.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(transformedEdges(edges), 3));
      const lines = new LineSegments(geometry, materials.edges(kind));
      lines.renderOrder = order.edges;
      lines.raycast = noRaycast;
      group.add(lines);
      disposables.push(geometry);
    }

    if (group.children.length === 0) {
      return undefined;
    }
    return {
      object: group,
      dispose() {
        group.clear();
        disposables.forEach((item) => item.dispose());
      },
    };
  }

  dispose(): void {
    this.overlayGeometries.forEach((geometry) => geometry.dispose());
    this.overlayGeometries = new Map();
  }

  /** A prototype's whole index range over its positions only: what the overlay material needs. */
  private overlayGeometry(prototype: number): BufferGeometry {
    let geometry = this.overlayGeometries.get(prototype);
    if (!geometry) {
      const mesh = this.scene.prototypes[prototype]!;
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
      geometry.setIndex(new BufferAttribute(mesh.indices, 1));
      this.overlayGeometries.set(prototype, geometry);
    }
    return geometry;
  }

  /** Each placement's world bounds as min xyz, max xyz (min > max when it has no vertices). */
  private computePlacementBoxes(): Float64Array {
    const prototypeBoxes = this.scene.prototypes.map((prototype) => new Box3().setFromArray(prototype.positions));
    const boxes = new Float64Array(this.scene.instances.length * 6);
    const box = new Box3();
    const matrix = new Matrix4();
    this.scene.instances.forEach((instance, placement) => {
      box.copy(prototypeBoxes[instance.prototype]!);
      if (!box.isEmpty()) {
        box.applyMatrix4(matrix.fromArray(instance.matrix));
      }
      box.min.toArray(boxes, placement * 6);
      box.max.toArray(boxes, placement * 6 + 3);
    });
    return boxes;
  }
}

function noRaycast(): void {}

/** An InstancedMesh of a much-placed prototype and one LineSegments of its instanced edges. */
function instancedObjects(
  prototype: PrototypeMesh,
  placements: number[],
  instances: readonly SceneInstance[],
  name: string,
  materials: MaterialCache,
  owned: { dispose(): void }[],
  used: Material[],
  slots: PlacementSlots[],
  pickedPlacement: Map<Object3D, Int32Array>,
): (InstancedMesh | LineSegments)[] {
  const objects: (InstancedMesh | LineSegments)[] = [];
  if (prototype.indices.length > 0) {
    const geometry = surfaceGeometry(prototype);
    owned.push(geometry);
    const material = surfaceMaterials(prototype, materials);
    used.push(...(Array.isArray(material) ? material : [material]));
    const mesh = new InstancedMesh(geometry, material, placements.length);
    mesh.name = name;
    placements.forEach((placement, i) => {
      mesh.setMatrixAt(i, new Matrix4().fromArray(instances[placement]!.matrix));
      slots[placement]!.surfaces.push({ mesh, index: i });
    });
    mesh.computeBoundingSphere();
    pickedPlacement.set(mesh, Int32Array.from(placements));
    objects.push(mesh);
  }
  if (prototype.edges.length > 0) {
    const material = materials.edges(true);
    used.push(material);
    const geometry = instancedEdgeGeometry(prototype, placements.map((placement) => instances[placement]!));
    owned.push(geometry);
    const matrices = geometry.getAttribute('instanceMatrix') as InstancedBufferAttribute;
    placements.forEach((placement, index) => (slots[placement]!.edges = { matrices, index }));
    const lines = new LineSegments(geometry, material);
    lines.name = `${name} edges`;
    // The geometry's bounds don't account for the instance transforms.
    lines.frustumCulled = false;
    lines.raycast = noRaycast;
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
function transformedEdges(placements: readonly { edges: Float32Array; matrix: readonly number[] }[]): Float32Array {
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
function instancedEdgeGeometry(prototype: PrototypeMesh, instances: readonly SceneInstance[]): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(prototype.edges, 3));
  const matrices = new Float32Array(instances.length * 16);
  instances.forEach((instance, i) => matrices.set(instance.matrix, i * 16));
  geometry.setAttribute('instanceMatrix', new InstancedBufferAttribute(matrices, 16));
  geometry.instanceCount = instances.length;
  return geometry;
}
