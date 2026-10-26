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
import type { PlanSource } from '../edit/export-plan';
import { ModelStructure, TopLevel, type Expansions } from '../edit/structure';
import type { KeptPlacement } from '../import/types';
import { EdgeVisibilityAttribute, type LinearRgba, type MaterialCache } from './materials';
import {
  EdgePickRadius,
  ModelFrame,
  pointHighlight,
  VertexPickRadius,
  type Highlight,
  type HighlightKind,
  type HighlightMaterials,
  type ModelParts,
  type PickedEntity,
  type Placement,
  type ScreenSpace,
} from './parts';

/** Prototypes placed at least this many times are drawn with one instanced draw call (docs/plan.md §6.3). */
export const InstancingThreshold = 16;

export interface BrepObject {
  object: Group;
  /** Picking, visibility and highlighting by tree node (D93–D95), and the tree's edits (M14). */
  parts: ModelParts & {
    /** The scene as edited, for exports: the live nodes' placements, on the imported prototypes. */
    exportScene(): ImportedScene;
    /** The tree as edited and placed now, for STEP and BREP exports (M15). */
    planSource(expansions: Expansions, hidden: ReadonlySet<number>): PlanSource;
  };
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
  edges?:
    | { geometry: BufferGeometry; visibility: BufferAttribute; start: number; count: number }
    | { matrices: InstancedBufferAttribute; index: number };
}

/** What the parts need to draw placements added after the build: copies (M14). */
interface Drawing {
  root: Group;
  name: string;
  materials: MaterialCache;
  owned: { dispose(): void }[];
  used: Material[];
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
      slots[instance]!.edges = { geometry, visibility, start, count };
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

  const parts = new BrepParts(scene, slots, pickedPlacement, indexOffsets, { root, name, materials, owned, used });
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
 * Copies of one prototype added after the build (M14): one InstancedMesh and one instanced edge set,
 * grown in steps (R23) rather than growing the batches they'd otherwise have joined.
 */
interface Addition {
  mesh: InstancedMesh | undefined;
  edges: { geometry: InstancedBufferGeometry; matrices: InstancedBufferAttribute } | undefined;
  /** The placement drawn in each slot, in slot order. */
  placements: number[];
  capacity: number;
}

/**
 * A BREP model's parts: each scene instance's tree node. Keeps the imported prototypes, which the
 * highlight draws again (D93), and works out a placement's bounds from its prototype's. Since M14 its
 * tree can change: copies get placements of their own, drawn as {@link Addition}s, and removed nodes'
 * placements are hidden as hidden parts are, so an undo can bring them back.
 */
class BrepParts implements ModelParts {
  partNodes: readonly number[];
  /** The scene's placements, then the copies' (M14); a copy dropped again keeps its slot with node -1. */
  private readonly instances: SceneInstance[];
  private readonly placementsOf = new Map<number, number[]>();
  /** Each file node's own placements, which its copies repeat. */
  private readonly filePlacements = new Map<number, number[]>();
  private hiddenPlacements: Uint8Array;
  private hiddenNodes: ReadonlySet<number> = new Set();
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private overlayGeometries = new Map<number, BufferGeometry>();
  private placementBoxes: Float64Array | undefined;
  /** Each tree node's placement in its parent's frame, 16 numbers each, and the model's frame (M13, D169). */
  private locals: Float64Array;
  /** Each node's parent now; a removed node keeps the one it had, so its place in the world is known. */
  private readonly parents: number[];
  private readonly frame = new Matrix4();
  private structure: ModelStructure;
  private readonly additions = new Map<number, Addition>();

  constructor(
    private readonly scene: ImportedScene,
    private readonly slots: PlacementSlots[],
    private readonly pickedPlacement: Map<Object3D, Int32Array>,
    private readonly indexOffsets: ReadonlyMap<BatchedMesh, readonly number[]>,
    private readonly drawing: Drawing,
  ) {
    this.instances = scene.instances;
    this.instances.forEach((instance, index) => {
      this.listOf(this.placementsOf, instance.node).push(index);
      this.listOf(this.filePlacements, instance.node).push(index);
    });
    this.partNodes = [...this.placementsOf.keys()].sort((a, b) => a - b);
    this.hiddenPlacements = new Uint8Array(this.instances.length);
    this.locals = new Float64Array(scene.nodes.length * 16);
    const identity = new Matrix4().elements;
    scene.nodes.forEach((node, index) => this.locals.set(node.matrix ?? identity, index * 16));
    this.parents = scene.nodes.map((node, index) => (node.parent >= 0 && node.parent < index ? node.parent : TopLevel));
    this.structure = new ModelStructure(scene.nodes);
  }

  placement(node: number): Placement {
    if (node === ModelFrame || !this.structure.nodes[node]) {
      return { local: node === ModelFrame ? this.frame.clone() : new Matrix4(), parentWorld: new Matrix4() };
    }
    return { local: new Matrix4().fromArray(this.locals, node * 16), parentWorld: this.worldOf(this.parents[node]!) };
  }

  /**
   * Gives a node (or the model) a new placement in its parent's frame: every placement under it gets
   * its world matrix again from the chain of placements above it, and is drawn there (R23).
   */
  setPlacement(node: number, local: Matrix4): number[] {
    let tops: readonly number[];
    if (node === ModelFrame) {
      this.frame.copy(local);
      tops = this.structure.childrenOf(TopLevel);
    } else if (this.structure.nodes[node]) {
      local.toArray(this.locals, node * 16);
      tops = [node];
    } else {
      return [];
    }
    const parts: number[] = [];
    const placements: number[] = [];
    const visit = (current: number, parentWorld: Matrix4) => {
      const world = parentWorld.clone().multiply(new Matrix4().fromArray(this.locals, current * 16));
      const own = this.placementsOf.get(current);
      if (own) {
        parts.push(current);
        for (const placement of own) {
          world.toArray(this.instances[placement]!.matrix);
          placements.push(placement);
        }
      }
      this.structure.childrenOf(current).forEach((child) => visit(child, world));
    };
    for (const top of tops) {
      visit(top, this.worldOf(this.parents[top]!));
    }
    this.drawPlacements(placements);
    return parts;
  }

  /**
   * The tree as edited (M14). Copies dropped by an undo go first, with every added node after them,
   * since the ids that follow were added later. Then each node that's new or has a new parent gets its
   * placement in that parent's frame worked out so it stays where it was in the world (D151), a copy
   * where its source is (D152) and a new assembly at its parent's origin (D184); copies of parts get
   * placements of their own. Removed nodes are hidden, and shown again when an undo brings them back.
   */
  setStructure(next: ModelStructure): KeptPlacement[] {
    const fileCount = this.scene.nodes.length;
    const previous = this.structure;
    let kept = fileCount;
    while (kept < Math.min(previous.count, next.count) && previous.addedKey(kept) === next.addedKey(kept)) {
      kept++;
    }
    for (let node = previous.count - 1; node >= kept; node--) {
      for (const placement of this.placementsOf.get(node) ?? []) {
        this.dropPlacement(placement);
      }
      this.placementsOf.delete(node);
    }

    // Worlds before are read through the dropped nodes too: an undone New assembly's children were in it.
    const before = new Map<number, Matrix4>();
    const worldBefore = (node: number): Matrix4 => {
      let world = before.get(node);
      if (!world) {
        world = node === TopLevel ? this.frame.clone() : worldBefore(this.parents[node]!).clone().multiply(new Matrix4().fromArray(this.locals, node * 16));
        before.set(node, world);
      }
      return world;
    };
    const after = new Map<number, Matrix4>();
    const worldAfter = (node: number): Matrix4 => {
      if (node < kept) {
        return worldBefore(node); // existing nodes stay where they are
      }
      let world = after.get(node);
      if (!world) {
        // Expand's assembly takes its part's place, and its pieces go where they are in the part (M15).
        const expanded = next.expansionOf(node);
        const frame = next.pieceFrame(node);
        const source = next.sources[node]!;
        world = frame
          ? worldAfter(frame.parent).clone().multiply(new Matrix4().fromArray(frame.matrix))
          : expanded
            ? worldAfter(expanded.expands)
            : source >= 0
              ? worldAfter(source)
              : worldAfter(next.nodes[node]!.parent);
        after.set(node, world);
      }
      return world;
    };

    if (next.count * 16 > this.locals.length) {
      const grown = new Float64Array(next.count * 16);
      grown.set(this.locals);
      this.locals = grown;
    }
    // Worked out first and written after, since the worlds before are read from the parents and placements.
    const changed: (KeptPlacement & { parent: number })[] = [];
    const place = (node: number, parent: number) => {
      changed.push({ node, parent, matrix: worldAfter(parent).clone().invert().multiply(worldAfter(node)).toArray() });
    };
    for (const node of next.order()) {
      const parent = next.nodes[node]!.parent;
      if (node >= kept || parent !== this.parents[node]) {
        place(node, parent);
      }
    }
    for (let node = kept; node < next.count; node++) {
      if (!next.isLive(node)) {
        place(node, next.nodes[node]!.parent); // added, and removed again since (restoring kept edits)
      }
    }
    const worlds = Array.from({ length: next.count - kept }, (_, offset) => worldAfter(kept + offset).toArray());
    this.parents.length = kept;
    for (const { node, parent, matrix } of changed) {
      this.locals.set(matrix, node * 16);
      this.parents[node] = parent;
    }

    for (let node = kept; node < next.count; node++) {
      const world = worlds[node - kept]!;
      const fileNode = next.fileNodes[node]!;
      if (fileNode >= 0) {
        for (const filePlacement of this.filePlacements.get(fileNode) ?? []) {
          this.addPlacement(node, this.instances[filePlacement]!.prototype, world);
        }
      } else if (next.nodes[node]!.prototype >= 0) {
        this.addPlacement(node, next.nodes[node]!.prototype, world); // a piece of an expanded part, or a copy of one (M15)
      }
    }

    this.structure = next;
    this.partNodes = [...this.placementsOf.keys()].filter((node) => next.isLive(node)).sort((a, b) => a - b);
    this.placementBoxes = undefined;
    this.applyVisibility();
    // Once for all the copies made or dropped: per copy, a pasted line of hundreds of parts took quadratic time.
    this.additions.forEach((addition) => addition.mesh?.computeBoundingSphere());
    return changed.map(({ node, matrix }) => ({ node, matrix }));
  }

  planSource(expansions: Expansions, hidden: ReadonlySet<number>): PlanSource {
    return {
      structure: this.structure,
      fileTree: this.scene.nodes,
      expansions,
      local: (node) => Array.from(this.locals.subarray(node * 16, node * 16 + 16)),
      frame: this.frame.toArray(),
      hidden,
    };
  }

  /** The scene as edited, for exports: live nodes' placements only. */
  exportScene(): ImportedScene {
    return {
      nodes: this.structure.nodes,
      instances: this.instances.filter((instance) => instance.node >= 0 && this.structure.isLive(instance.node)),
      prototypes: this.scene.prototypes,
    };
  }

  /** A node's world placement; {@link ModelFrame}'s is the model's frame. */
  private worldOf(node: number): Matrix4 {
    const world = new Matrix4();
    const local = new Matrix4();
    for (let current = node; current >= 0; current = this.parents[current]!) {
      world.premultiply(local.fromArray(this.locals, current * 16));
    }
    return world.premultiply(this.frame);
  }

  /** Draws these placements where their instance matrices now say: a hidden instanced copy stays zeroed (D94). */
  private drawPlacements(placements: readonly number[]): void {
    const matrix = new Matrix4();
    const point = new Vector3();
    const batches = new Set<BatchedMesh>();
    const instanced = new Set<InstancedMesh>();
    const attributes = new Set<BufferAttribute | InstancedBufferAttribute>();
    const edgeGeometries = new Set<BufferGeometry>();
    for (const placement of placements) {
      const instance = this.instances[placement]!;
      const hidden = this.hiddenPlacements[placement] === 1;
      matrix.fromArray(instance.matrix);
      const slot = this.slots[placement]!;
      for (const surface of slot.surfaces) {
        if ('batch' in surface) {
          surface.batch.setMatrixAt(surface.id, matrix);
          batches.add(surface.batch);
        } else if (!hidden) {
          surface.mesh.setMatrixAt(surface.index, matrix);
          instanced.add(surface.mesh);
        }
      }
      const edges = slot.edges;
      if (edges && 'visibility' in edges) {
        const positions = edges.geometry.getAttribute('position') as BufferAttribute;
        const source = this.scene.prototypes[instance.prototype]!.edges;
        for (let i = 0; i < edges.count; i++) {
          point.fromArray(source, i * 3).applyMatrix4(matrix).toArray(positions.array, (edges.start + i) * 3);
        }
        attributes.add(positions);
        edgeGeometries.add(edges.geometry);
      } else if (edges && !hidden) {
        matrix.toArray(edges.matrices.array, edges.index * 16);
        attributes.add(edges.matrices);
      }
    }
    batches.forEach((batch) => batch.computeBoundingSphere());
    instanced.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    attributes.forEach((attribute) => (attribute.needsUpdate = true));
    edgeGeometries.forEach((geometry) => geometry.computeBoundingSphere());
    this.placementBoxes = undefined;
  }

  /** A copy's placement of a prototype, drawn in that prototype's {@link Addition}. */
  private addPlacement(node: number, prototype: number, matrix: number[]): void {
    const placement = this.instances.push({ node, prototype, matrix }) - 1;
    this.slots[placement] = { surfaces: [] };
    if (placement >= this.hiddenPlacements.length) {
      const grown = new Uint8Array(Math.max(16, this.hiddenPlacements.length * 2));
      grown.set(this.hiddenPlacements);
      this.hiddenPlacements = grown;
    }
    this.hiddenPlacements[placement] = 0;
    this.listOf(this.placementsOf, node).push(placement);

    const addition = this.additionOf(prototype);
    const slot = addition.placements.length;
    if (slot === addition.capacity) {
      this.grow(addition, Math.max(4, addition.capacity * 2));
    }
    addition.placements.push(placement);
    const transform = new Matrix4().fromArray(matrix);
    if (addition.mesh) {
      addition.mesh.setMatrixAt(slot, transform);
      addition.mesh.count = addition.placements.length;
      addition.mesh.instanceMatrix.needsUpdate = true;
      this.pickedPlacement.get(addition.mesh)![slot] = placement;
      this.slots[placement]!.surfaces.push({ mesh: addition.mesh, index: slot });
    }
    if (addition.edges) {
      transform.toArray(addition.edges.matrices.array, slot * 16);
      addition.edges.matrices.needsUpdate = true;
      addition.edges.geometry.instanceCount = addition.placements.length;
      this.slots[placement]!.edges = { matrices: addition.edges.matrices, index: slot };
    }
  }

  /** Drops a copy's placement: its slot goes to the addition's last placement, so the drawn ones stay together. */
  private dropPlacement(placement: number): void {
    const instance = this.instances[placement]!;
    const addition = this.additions.get(instance.prototype);
    instance.node = -1;
    this.hiddenPlacements[placement] = 1;
    this.slots[placement] = { surfaces: [] };
    if (!addition) {
      return;
    }
    const slot = addition.placements.indexOf(placement);
    const last = addition.placements.length - 1;
    if (slot < 0) {
      return;
    }
    if (slot !== last) {
      const moved = addition.placements[last]!;
      addition.placements[slot] = moved;
      const matrix = new Matrix4();
      if (addition.mesh) {
        addition.mesh.getMatrixAt(last, matrix);
        addition.mesh.setMatrixAt(slot, matrix);
        this.pickedPlacement.get(addition.mesh)![slot] = moved;
      }
      if (addition.edges) {
        addition.edges.matrices.array.copyWithin(slot * 16, last * 16, last * 16 + 16);
      }
      const movedSlots = this.slots[moved]!;
      movedSlots.surfaces = addition.mesh ? [{ mesh: addition.mesh, index: slot }] : [];
      if (addition.edges) {
        movedSlots.edges = { matrices: addition.edges.matrices, index: slot };
      }
    }
    addition.placements.pop();
    if (addition.mesh) {
      addition.mesh.count = addition.placements.length;
      addition.mesh.instanceMatrix.needsUpdate = true;
    }
    if (addition.edges) {
      addition.edges.geometry.instanceCount = addition.placements.length;
      addition.edges.matrices.needsUpdate = true;
    }
  }

  private additionOf(prototype: number): Addition {
    let addition = this.additions.get(prototype);
    if (!addition) {
      addition = { mesh: undefined, edges: undefined, placements: [], capacity: 0 };
      this.additions.set(prototype, addition);
      const mesh = this.scene.prototypes[prototype]!;
      const { root, name, materials, owned, used } = this.drawing;
      if (mesh.indices.length > 0) {
        const geometry = surfaceGeometry(mesh);
        owned.push(geometry);
        const material = surfaceMaterials(mesh, materials);
        used.push(...(Array.isArray(material) ? material : [material]));
        addition.mesh = new InstancedMesh(geometry, material, 0);
        addition.mesh.name = `${name} copies`;
        addition.mesh.count = 0;
        this.pickedPlacement.set(addition.mesh, new Int32Array(0));
        root.add(addition.mesh);
      }
      if (mesh.edges.length > 0) {
        const material = materials.edges(true);
        used.push(material);
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(mesh.edges, 3));
        const matrices = new InstancedBufferAttribute(new Float32Array(0), 16);
        geometry.setAttribute('instanceMatrix', matrices);
        geometry.instanceCount = 0;
        owned.push(geometry);
        const lines = new LineSegments(geometry, material);
        lines.name = `${name} copies' edges`;
        lines.frustumCulled = false;
        lines.raycast = noRaycast;
        root.add(lines);
        addition.edges = { geometry, matrices };
      }
    }
    return addition;
  }

  /** A bigger InstancedMesh and edge matrices for an addition, its placements copied across. */
  private grow(addition: Addition, capacity: number): void {
    if (addition.mesh) {
      const old = addition.mesh;
      const mesh = new InstancedMesh(old.geometry, old.material, capacity);
      mesh.name = old.name;
      (mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array);
      mesh.count = old.count;
      const picked = new Int32Array(capacity);
      picked.set(this.pickedPlacement.get(old)!);
      this.pickedPlacement.delete(old);
      this.pickedPlacement.set(mesh, picked);
      this.drawing.root.remove(old);
      this.drawing.root.add(mesh);
      old.dispose();
      addition.mesh = mesh;
      addition.placements.forEach((placement, slot) => (this.slots[placement]!.surfaces = [{ mesh, index: slot }]));
    }
    if (addition.edges) {
      const array = new Float32Array(capacity * 16);
      array.set(addition.edges.matrices.array);
      const matrices = new InstancedBufferAttribute(array, 16);
      addition.edges.geometry.setAttribute('instanceMatrix', matrices);
      addition.edges.matrices = matrices;
      addition.placements.forEach((placement, slot) => (this.slots[placement]!.edges = { matrices, index: slot }));
    }
    addition.capacity = capacity;
  }

  private listOf(map: Map<number, number[]>, key: number): number[] {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    return list;
  }

  nodeOf(hit: Intersection): number {
    const placement = this.placementOf(hit);
    return placement === undefined ? -1 : (this.instances[placement]?.node ?? -1);
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
    const instance = this.instances[placement]!;
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
    this.hiddenNodes = hidden;
    this.applyVisibility();
  }

  /** Hides the placements of hidden parts and of removed nodes (M14), and shows the rest. */
  private applyVisibility(): void {
    const changed = new Set<BufferAttribute | InstancedBufferAttribute>();
    const instanced = new Set<InstancedMesh>();
    this.instances.forEach((instance, placement) => {
      if (instance.node < 0) {
        return; // a copy dropped again
      }
      const hide = this.hiddenNodes.has(instance.node) || !this.structure.isLive(instance.node) ? 1 : 0;
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
    instanced.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    changed.forEach((attribute) => (attribute.needsUpdate = true));
  }

  addVisibleBounds(target: Box3): Box3 {
    const boxes = (this.placementBoxes ??= this.computePlacementBoxes());
    const box = new Box3();
    for (let placement = 0; placement < this.instances.length; placement++) {
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
    const surfaced = placements.filter((placement) => this.scene.prototypes[this.instances[placement]!.prototype]!.indices.length > 0);
    const group = new Group();
    const disposables: { dispose(): void }[] = [];
    const order = materials.renderOrder(kind);

    if (surfaced.length > 0) {
      const prototypes = [...new Set(surfaced.map((placement) => this.instances[placement]!.prototype))];
      const geometries = prototypes.map((prototype) => this.overlayGeometry(prototype));
      const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
      const indices = geometries.reduce((sum, g) => sum + g.index!.count, 0);
      const batch = new BatchedMesh(surfaced.length, vertices, indices, materials.surface(kind));
      const ids = new Map(prototypes.map((prototype, i) => [prototype, batch.addGeometry(geometries[i]!)]));
      const matrix = new Matrix4();
      for (const placement of surfaced) {
        const instance = this.instances[placement]!;
        batch.setMatrixAt(batch.addInstance(ids.get(instance.prototype)!), matrix.fromArray(instance.matrix));
      }
      batch.computeBoundingSphere();
      batch.renderOrder = order.surface;
      batch.raycast = noRaycast;
      group.add(batch);
      disposables.push(batch);
    }

    const edges = placements
      .map((placement) => this.instances[placement]!)
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
    this.additions.forEach((addition) => addition.mesh?.dispose());
    this.additions.clear();
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
    const boxes = new Float64Array(this.instances.length * 6);
    const box = new Box3();
    const matrix = new Matrix4();
    this.instances.forEach((instance, placement) => {
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
