import {
  Box3,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  type BufferGeometry,
  type Intersection,
  type Material,
  type Object3D,
} from 'three';
import type { TreeNode } from '../import/types';

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
  /** The overlay of these parts, or undefined when none of them draws anything. */
  highlight(nodes: readonly number[], kind: HighlightKind, materials: HighlightMaterials): Highlight | undefined;
}

/** The overlay materials, shared by every model's highlights. */
export class HighlightMaterials {
  private readonly surfaces = new Map<HighlightKind, MeshBasicMaterial>();
  private readonly lines = new Map<HighlightKind, LineBasicMaterial>();

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

  renderOrder(kind: HighlightKind): { surface: number; edges: number } {
    return RenderOrder[kind];
  }

  dispose(): void {
    const all: Material[] = [...this.surfaces.values(), ...this.lines.values()];
    all.forEach((material) => material.dispose());
    this.surfaces.clear();
    this.lines.clear();
  }
}

/**
 * The parts of a mesh model: each tree node whose object has geometry (a glTF node's mesh, an OBJ
 * object, an STL's single mesh; D81). Hiding moves the object to {@link HiddenLayer}, which hides it
 * but not its children; the highlight draws the same geometry again with the accent material.
 */
export class MeshParts implements ModelParts {
  readonly partNodes: readonly number[];
  private readonly nodeOfObject = new Map<Object3D, number>();
  private readonly hidden = new Set<number>();
  private boxes: Map<number, Box3> | undefined;

  constructor(
    private readonly objects: readonly Object3D[],
    tree: readonly TreeNode[],
  ) {
    const parts: number[] = [];
    tree.forEach((node, index) => {
      const object = objects[index];
      if (node.prototype >= 0 && object) {
        parts.push(index);
        this.nodeOfObject.set(object, index);
      }
    });
    this.partNodes = parts;
  }

  nodeOf(hit: Intersection): number {
    return this.nodeOfObject.get(hit.object) ?? -1;
  }

  setHidden(hidden: ReadonlySet<number>): void {
    for (const node of this.partNodes) {
      const hide = hidden.has(node);
      if (hide !== this.hidden.has(node)) {
        this.objects[node]!.layers.set(hide ? HiddenLayer : 0);
        if (hide) {
          this.hidden.add(node);
        } else {
          this.hidden.delete(node);
        }
      }
    }
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
