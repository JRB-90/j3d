import type { EntityRef } from '@j3d/occt/facade';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
  type Intersection,
  type Material,
  type Object3D,
} from 'three';
import { ModelStructure, TopLevel } from '../edit/structure';
import { isJ3dEdges } from '../import/mesh/j3d-gltf';
import type { KeptPlacement, TreeNode, Vector3Tuple } from '../import/types';

/** The accent colour (docs/plan.md §6.6), used for the selection and, fainter, for hover (assumption 8). */
export const AccentColour = new Color(0x4f9dff);

/** A layer neither the camera nor the raycaster uses: an object moved onto it is hidden without hiding its children. */
export const HiddenLayer = 31;

export type HighlightKind = 'selected' | 'hovered';

/** Overlay objects drawn after everything else (D93). */
const RenderOrder: Record<HighlightKind, { surface: number; edges: number }> = {
  selected: { surface: 10, edges: 11 },
  hovered: { surface: 12, edges: 13 },
};

/** How close to a vertex or an edge, in CSS pixels, the pointer has to be to pick it (D107). */
export const VertexPickRadius = 8;
export const EdgePickRadius = 6;

/**
 * Something the Measure tool picked (M7): a BREP face, edge or vertex of one placement, which its
 * worker can measure exactly, or a point on a mesh model, snapped to a vertex when one is near (D81).
 * `point` is where on it the pointer was, in world coordinates.
 */
export type PickedEntity =
  | { kind: 'face' | 'edge' | 'vertex'; node: number; ref: EntityRef; point: Vector3Tuple }
  | { kind: 'point'; node: number; point: Vector3Tuple };

/** What entity picking needs of the view: the pointer, and where world points land on screen. */
export interface ScreenSpace {
  x: number;
  y: number;
  /** Client coordinates, and the distance in front of the camera. */
  project(world: Vector3): { x: number; y: number; depth: number };
  /** How far in front of the camera the surface under the pointer is. */
  hitDepth: number;
}

/** Highlighted parts drawn again on top of themselves, in the accent colour. */
export interface Highlight {
  object: Object3D;
  dispose(): void;
}

/**
 * A model seen as parts (docs/plan.md §6.3, decisions D93–D95): the tree nodes that draw something,
 * which can be picked, hidden and highlighted. Selection and visibility themselves are .NET's
 * (D95); a model only applies them.
 */
export interface ModelParts {
  /** Every node that draws something, in tree order. */
  readonly partNodes: readonly number[];
  /** The part node an intersection with this model hit, or -1. */
  nodeOf(hit: Intersection): number;
  /** Hides exactly these part nodes, showing the rest. */
  setHidden(hidden: ReadonlySet<number>): void;
  /** Bounds of the parts not hidden, added to `target`. */
  addVisibleBounds(target: Box3): Box3;
  /** One part node's world bounds (empty if it draws nothing). */
  nodeBounds(node: number): Box3;
  /** The overlay of these parts, or undefined when none of them draws anything. */
  highlight(nodes: readonly number[], kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined;
  /** The entity to measure where the pointer is over this hit (M7, D107), if any. */
  entityAt(hit: Intersection, screen: ScreenSpace): PickedEntity | undefined;
  /** One picked entity drawn in the accent colour. */
  entityHighlight(entity: PickedEntity, kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined;
  /**
   * A tree node's placement in its parent's frame, and that frame in the world (M13, D148). Node
   * {@link ModelFrame} is the model itself: its frame is the file's, identity until it's moved (D169),
   * and a root node's parent frame is the model's.
   */
  placement(node: number): Placement;
  /**
   * Gives a node, or the model ({@link ModelFrame}), a new placement in its parent's frame; everything
   * under it moves with it. Returns the part nodes that moved.
   */
  setPlacement(node: number, local: Matrix4): number[];
  /**
   * Applies the model's tree as edited (M14, D151, D152): copies and new assemblies are added, nodes
   * that changed parents keep where they are in the world, and removed nodes are dropped from view
   * and from picking. Returns the nodes whose placements in their parents' frames were worked out
   * again, to be kept as moves are.
   */
  setStructure(structure: ModelStructure): KeptPlacement[];
}

/** The node number that stands for a whole model (M13, D169). */
export const ModelFrame = -1;

/** Where a node is: its placement in its parent's frame, and that frame's placement in the world. */
export interface Placement {
  local: Matrix4;
  parentWorld: Matrix4;
}

/** The overlay materials, shared by every model's highlights. */
export class HighlightMaterials {
  private readonly surfaces = new Map<HighlightKind, MeshBasicMaterial>();
  private readonly lines = new Map<HighlightKind, LineBasicMaterial>();
  private readonly points = new Map<HighlightKind, PointsMaterial>();

  surface(kind: HighlightKind): MeshBasicMaterial {
    let material = this.surfaces.get(kind);
    if (!material) {
      material = new MeshBasicMaterial({
        color: AccentColour,
        transparent: true,
        opacity: kind === 'selected' ? 0.45 : 0.22,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      });
      this.surfaces.set(kind, material);
    }
    return material;
  }

  edges(kind: HighlightKind): LineBasicMaterial {
    let material = this.lines.get(kind);
    if (!material) {
      // Transparent, so it draws after the near-black edges it lies on, at the same depth.
      material = new LineBasicMaterial({
        color: AccentColour,
        transparent: true,
        opacity: kind === 'selected' ? 1 : 0.6,
        depthWrite: false,
        toneMapped: false,
      });
      this.lines.set(kind, material);
    }
    return material;
  }

  /** A dot of fixed screen size, drawn over everything: a picked vertex or point (M7). */
  point(kind: HighlightKind): PointsMaterial {
    let material = this.points.get(kind);
    if (!material) {
      material = new PointsMaterial({
        color: AccentColour,
        size: kind === 'selected' ? 10 : 8,
        sizeAttenuation: false,
        transparent: true,
        opacity: kind === 'selected' ? 1 : 0.7,
        depthTest: false,
        toneMapped: false,
      });
      this.points.set(kind, material);
    }
    return material;
  }

  renderOrder(kind: HighlightKind): { surface: number; edges: number } {
    return RenderOrder[kind];
  }

  dispose(): void {
    const all: Material[] = [...this.surfaces.values(), ...this.lines.values(), ...this.points.values()];
    all.forEach((material) => material.dispose());
    this.surfaces.clear();
    this.lines.clear();
    this.points.clear();
  }
}

/**
 * The parts of a mesh model: each tree node whose object has geometry (a glTF node's mesh, an OBJ
 * object, an STL's single mesh; D81). Hiding moves the object to {@link HiddenLayer}, which hides it
 * but not its children; the highlight draws the same geometry again with the accent material.
 *
 * Since M14 its tree can change (D153): a copy is a shallow clone of its source's object, sharing its
 * geometry and materials; a new assembly is an empty group; a node that changes parents is attached to
 * its new parent's object where it is in the world; and a removed part is hidden as a hidden one is.
 */
export class MeshParts implements ModelParts {
  partNodes: readonly number[];
  /** Each node's object, the file's and then the added ones'. */
  private readonly objects: Object3D[];
  private readonly nodeOfObject = new Map<Object3D, number>();
  private readonly hidden = new Set<number>();
  private hiddenNodes: ReadonlySet<number> = new Set();
  private boxes: Map<number, Box3> | undefined;
  /** The model's frame (M13, D169), which the frame object (a group around the import's root) is placed by. */
  private readonly frame = new Matrix4();
  /** Where the model's top-level nodes hang: the file's own root's parent (glTF's turn to Z-up, or the frame). */
  private readonly topParent: Object3D | undefined;
  private structure: ModelStructure;

  constructor(
    objects: readonly Object3D[],
    tree: readonly TreeNode[],
    private readonly frameObject?: Object3D,
  ) {
    this.objects = [...objects];
    this.topParent = objects[0]?.parent ?? frameObject;
    this.structure = new ModelStructure(tree);
    this.partNodes = this.liveParts();
  }

  /** Each node's object, by node, for exports (M9). */
  get nodeObjects(): readonly Object3D[] {
    return this.objects;
  }

  nodeOf(hit: Intersection): number {
    const node = this.nodeOfObject.get(hit.object);
    return node !== undefined && this.structure.isLive(node) ? node : -1;
  }

  setHidden(hidden: ReadonlySet<number>): void {
    this.hiddenNodes = hidden;
    this.applyVisibility();
  }

  /**
   * The tree as edited (M14), as BREP models apply it (see BrepParts.setStructure): copies dropped by
   * an undo go, new nodes are made where their sources are (a new assembly at its parent's origin,
   * D184), each node whose parent changed is attached to its new parent keeping its place in the world
   * (D151), and removed parts are hidden.
   */
  setStructure(next: ModelStructure): KeptPlacement[] {
    const previous = this.structure;
    const fileCount = previous.fileTree.length;
    let kept = fileCount;
    while (kept < Math.min(previous.count, next.count) && previous.addedKey(kept) === next.addedKey(kept)) {
      kept++;
    }
    const discarded = this.objects.splice(kept);
    this.topParent?.updateWorldMatrix(true, true);
    this.objects.slice(0, kept).forEach((object) => object.updateWorldMatrix(true, false));

    // Where each new node goes in the world: a copy where its source is, a new assembly at its parent's origin.
    const worlds = new Map<number, Matrix4>();
    const worldOf = (node: number): Matrix4 => {
      if (node === TopLevel) {
        return this.topParent?.matrixWorld.clone() ?? new Matrix4();
      }
      if (node < kept) {
        return this.objects[node]!.matrixWorld.clone();
      }
      let world = worlds.get(node);
      if (!world) {
        const source = next.sources[node]!;
        world = source >= 0 ? worldOf(source) : worldOf(next.nodes[node]!.parent);
        worlds.set(node, world);
      }
      return world;
    };
    for (let node = kept; node < next.count; node++) {
      worldOf(node);
    }
    for (let node = kept; node < next.count; node++) {
      const source = next.sources[node]!;
      const object = source >= 0 ? cloneNode(this.objects[source]!) : new Group();
      object.name = next.nodes[node]!.name;
      this.objects.push(object);
    }

    const changed: KeptPlacement[] = [];
    const place = (node: number, parent: number) => {
      const object = this.objects[node]!;
      const target = parent === TopLevel ? this.topParent : this.objects[parent];
      if (!target) {
        return;
      }
      const world = node >= kept ? worldOf(node) : object.matrixWorld.clone();
      target.updateWorldMatrix(true, false);
      target.add(object);
      setObjectMatrix(object, target.matrixWorld.clone().invert().multiply(world));
      object.updateMatrixWorld(true);
      changed.push({ node, matrix: object.matrix.toArray() });
    };
    for (const node of next.order()) {
      const parent = next.nodes[node]!.parent;
      const target = parent === TopLevel ? this.topParent : this.objects[parent];
      if (node >= kept || this.objects[node]!.parent !== target) {
        place(node, parent);
      }
    }
    for (let node = kept; node < next.count; node++) {
      if (!next.isLive(node)) {
        place(node, next.nodes[node]!.parent); // added, and removed again since (restoring kept edits)
      }
    }
    for (const object of discarded) {
      // Anything of the file's still under a dropped copy stays where it is in the world.
      for (const child of [...object.children]) {
        if (this.objects.includes(child)) {
          (object.parent ?? this.topParent)?.attach(child);
        }
      }
      object.removeFromParent();
    }

    this.structure = next;
    this.nodeOfObject.clear();
    this.partNodes = this.liveParts();
    this.boxes = undefined;
    this.applyVisibility();
    return changed;
  }

  /** The live part nodes, which can be picked by their objects. */
  private liveParts(): number[] {
    const parts = this.structure.parts().filter((node) => this.objects[node]);
    this.nodeOfObject.clear();
    this.structure.nodes.forEach((node, index) => {
      if (node.prototype >= 0 && this.objects[index]) {
        this.nodeOfObject.set(this.objects[index]!, index);
      }
    });
    return parts;
  }

  /** Hides hidden parts and removed ones (M14), and shows the rest. */
  private applyVisibility(): void {
    this.structure.nodes.forEach((treeNode, node) => {
      const object = this.objects[node];
      if (treeNode.prototype < 0 || !object) {
        return;
      }
      const hide = this.hiddenNodes.has(node) || !this.structure.isLive(node);
      if (hide !== this.hidden.has(node)) {
        object.layers.set(hide ? HiddenLayer : 0);
        // J3D's own GLB: a BREP part's edges go with it (D124).
        object.children.filter(isJ3dEdges).forEach((edges) => edges.layers.set(hide ? HiddenLayer : 0));
        if (hide) {
          this.hidden.add(node);
        } else {
          this.hidden.delete(node);
        }
      }
    });
  }

  addVisibleBounds(target: Box3): Box3 {
    if (!this.boxes) {
      this.boxes = new Map();
      for (const node of this.partNodes) {
        this.boxes.set(node, objectBox(this.objects[node]!));
      }
    }
    for (const [node, box] of this.boxes) {
      if (!this.hidden.has(node) && !box.isEmpty()) {
        target.union(box);
      }
    }
    return target;
  }

  nodeBounds(node: number): Box3 {
    const object = this.objects[node];
    return object && this.nodeOfObject.get(object) === node ? objectBox(object) : new Box3();
  }

  highlight(nodes: readonly number[], kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined {
    const group = new Group();
    const material = materials.surface(kind);
    for (const node of nodes) {
      const object = this.objects[node] as Partial<Mesh & InstancedMesh> | undefined;
      if (!object?.isMesh || !object.geometry) {
        continue;
      }
      let overlay: Mesh;
      if (object.isInstancedMesh) {
        const instanced = new InstancedMesh(object.geometry, material, object.count!);
        instanced.instanceMatrix = object.instanceMatrix!;
        overlay = instanced;
      } else {
        overlay = new Mesh(object.geometry, material);
      }
      overlay.matrixAutoUpdate = false;
      overlay.matrix.copy(object.matrixWorld!);
      overlay.matrixWorld.copy(object.matrixWorld!);
      overlay.renderOrder = materials.renderOrder(kind).surface;
      overlay.raycast = () => {};
      group.add(overlay);
    }
    if (group.children.length === 0) {
      return undefined;
    }
    group.matrixAutoUpdate = false;
    // The overlays share the model's geometry, so there's nothing of their own to free.
    return { object: group, dispose: () => group.clear() };
  }

  /** The hit triangle's corner nearest the pointer if it's within reach, else the hit point (D81). */
  entityAt(hit: Intersection, screen: ScreenSpace): PickedEntity | undefined {
    const node = this.nodeOf(hit);
    const mesh = hit.object as Partial<Mesh & InstancedMesh>;
    if (node < 0 || !hit.face || !mesh.geometry) {
      return undefined;
    }
    const toWorld = new Matrix4();
    if (mesh.isInstancedMesh && hit.instanceId !== undefined) {
      mesh.getMatrixAt!(hit.instanceId, toWorld);
    }
    toWorld.premultiply(hit.object.matrixWorld);
    const positions = mesh.geometry.getAttribute('position');
    let best: { point: Vector3; distance: number } | undefined;
    for (const corner of [hit.face.a, hit.face.b, hit.face.c]) {
      const world = new Vector3().fromBufferAttribute(positions, corner).applyMatrix4(toWorld);
      const onScreen = screen.project(world);
      const distance = Math.hypot(onScreen.x - screen.x, onScreen.y - screen.y);
      if (distance <= VertexPickRadius && (!best || distance < best.distance)) {
        best = { point: world, distance };
      }
    }
    return { kind: 'point', node, point: (best?.point ?? hit.point).toArray() };
  }

  entityHighlight(entity: PickedEntity, kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined {
    return pointHighlight(entity.point, kind, materials);
  }

  /** A node's object's own matrix, in its Three.js parent's frame (D153). */
  placement(node: number): Placement {
    if (node === ModelFrame) {
      return { local: this.frame.clone(), parentWorld: new Matrix4() };
    }
    const object = this.objects[node];
    if (!object) {
      return { local: new Matrix4(), parentWorld: new Matrix4() };
    }
    object.parent?.updateWorldMatrix(true, false);
    return { local: object.matrix.clone(), parentWorld: object.parent?.matrixWorld.clone() ?? new Matrix4() };
  }

  setPlacement(node: number, local: Matrix4): number[] {
    let object: Object3D | undefined;
    if (node === ModelFrame) {
      if (!this.frameObject) {
        return [];
      }
      this.frame.copy(local);
      object = this.frameObject;
      setObjectMatrix(object, local);
    } else {
      object = this.objects[node];
      if (!object) {
        return [];
      }
      setObjectMatrix(object, local);
    }
    object.updateMatrixWorld(true);
    this.boxes = undefined;
    const moved = new Set<Object3D>();
    object.traverse((child) => moved.add(child));
    return this.partNodes.filter((part) => moved.has(this.objects[part]!));
  }
}

/** A copy of a node's own object (M14): its geometry, materials and J3D's BREP edges, not its child nodes. */
function cloneNode(source: Object3D): Object3D {
  const copy = source.clone(false);
  copy.layers.set(0);
  for (const edges of source.children.filter(isJ3dEdges)) {
    const lines = edges.clone(false);
    lines.layers.set(0);
    copy.add(lines);
  }
  return copy;
}

function setObjectMatrix(object: Object3D, matrix: Matrix4): void {
  if (object.matrixAutoUpdate) {
    matrix.decompose(object.position, object.quaternion, object.scale);
  }
  object.matrix.copy(matrix);
}

/** A single dot at a world point. */
export function pointHighlight(point: Vector3Tuple, kind: HighlightKind, materials: HighlightMaterials): Highlight {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(point), 3));
  const dot = new Points(geometry, materials.point(kind));
  dot.renderOrder = materials.renderOrder(kind).edges + 10;
  dot.raycast = () => {};
  return {
    object: dot,
    dispose() {
      geometry.dispose();
    },
  };
}

/** An object's own geometry bounds in world space (not its children's). */
function objectBox(object: Object3D): Box3 {
  const mesh = object as Partial<InstancedMesh & { geometry: BufferGeometry }>;
  const box = new Box3();
  if (mesh.isInstancedMesh) {
    mesh.computeBoundingBox!();
    box.copy(mesh.boundingBox!);
  } else if (mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!);
  }
  return box.isEmpty() ? box : box.applyMatrix4(object.matrixWorld);
}
