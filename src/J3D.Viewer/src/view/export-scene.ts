import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  type InstancedMesh,
  type Material,
  type Object3D,
} from 'three';
import { isJ3dEdges, J3dEdgesTag, J3dRangesTag } from '../import/mesh/j3d-gltf';
import type { TreeNode } from '../import/types';
import { EdgeColour, type LinearRgba } from './materials';
import { SurfaceMetalness, SurfaceRoughness } from './surface';

/** One model's share of an export (M9): its tree and geometry, and which of its parts are hidden or selected. */
export interface ExportSource {
  /** The model's file name. */
  name: string;
  /** Its nodes by id, with their parents as edited (M14). */
  tree: readonly TreeNode[];
  /**
   * The nodes in the model, each before its children (M14: an edited tree's ids aren't in that order,
   * and removed nodes are left out). The ids in order when absent.
   */
  order?: readonly number[];
  content:
    | { kind: 'brep'; scene: ImportedScene }
    /** `sceneRoot`: node 0 is a glTF file's scene, so its children are the model's top-level nodes. */
    | { kind: 'mesh'; nodes: readonly Object3D[]; sceneRoot: boolean };
  hidden: ReadonlySet<number>;
  selected: readonly number[];
  /** Model units to millimetres (D105): every export is in millimetres (D118). */
  unitScale: number;
}

/** Who reads the scene: GLB keeps instancing and BREP edges (D124); STL wants plain meshes only. */
export type ExportTarget = 'gltf' | 'stl';

export interface ExportScene {
  scene: Scene;
  /** The file names of the models with parts in it. */
  models: string[];
  /** Frees the geometry and materials made for the export (mesh models' own are shared, not copied). */
  dispose(): void;
}

/**
 * A temporary scene of what an export saves (D83, D86): every visible part, or only the selected ones,
 * of every model, in J3D's Z-up world (D122) and in millimetres (D118). Hidden parts are left out
 * (assumption 10). Each model keeps its tree as groups named like its nodes. A BREP part is a mesh of
 * its prototype's geometry, which every placement of it shares, so a GLB writes it once, with its
 * edges as a line object beside it; mesh models' parts are copies of their objects. With several
 * models, each goes into a group named after its file.
 */
export function buildExportScene(sources: readonly ExportSource[], selection: boolean, target: ExportTarget): ExportScene {
  const scene = new Scene();
  const owned = new Set<{ dispose(): void }>();
  const materials = new ExportMaterials(owned);
  const parts: { source: ExportSource; roots: Object3D[] }[] = [];

  for (const source of sources) {
    const order = source.order ?? source.tree.map((_, index) => index);
    const chosen = chosenParts(source, order, selection);
    if (!chosen.some(Boolean)) {
      continue;
    }
    const kept = withAncestors(source.tree, order, chosen);
    const roots =
      source.content.kind === 'brep'
        ? brepObjects(source.content.scene, source.tree, order, kept, target, materials, owned)
        : meshObjects(source.content.nodes, source.content.sceneRoot, source.tree, order, chosen, kept, target);
    if (source.unitScale !== 1) {
      const scale = new Matrix4().makeScale(source.unitScale, source.unitScale, source.unitScale);
      roots.forEach((root) => root.matrix.premultiply(scale));
    }
    parts.push({ source, roots });
  }

  const [only] = parts;
  if (parts.length === 1 && only) {
    scene.add(...only.roots);
    // A glTF model on its own keeps its scene's name, so it comes back as it was.
    if (only.source.content.kind === 'mesh' && only.source.content.sceneRoot) {
      scene.name = only.source.tree[0]?.name ?? '';
    }
  } else {
    for (const { source, roots } of parts) {
      const group = new Group();
      group.name = source.name;
      group.add(...roots);
      scene.add(group);
    }
  }
  scene.updateMatrixWorld(true);

  return {
    scene,
    models: parts.map(({ source }) => source.name),
    dispose() {
      scene.clear();
      owned.forEach((item) => item.dispose());
      owned.clear();
    },
  };
}

/** A file's name without its extension. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * A GLB or STL's name (D128): its model's, when everything in it comes from one model, else `scene`
 * or `selection`.
 */
export function exportFileName(models: readonly string[], selection: boolean, extension: string): string {
  const [only] = models;
  return `${models.length === 1 && only ? baseName(only) : selection ? 'selection' : 'scene'}.${extension}`;
}

/** The part nodes an export takes from a model: the visible ones, or the selected ones (never hidden, D98). */
function chosenParts({ tree, hidden, selected }: ExportSource, order: readonly number[], selection: boolean): boolean[] {
  const picked = selection ? new Set(selected) : undefined;
  const chosen = tree.map(() => false);
  for (const index of order) {
    chosen[index] = tree[index]!.prototype >= 0 && !hidden.has(index) && (picked?.has(index) ?? true);
  }
  return chosen;
}

/** The chosen nodes and every node above them, which keep the hierarchy. */
function withAncestors(tree: readonly TreeNode[], order: readonly number[], chosen: readonly boolean[]): boolean[] {
  const kept = [...chosen];
  for (let position = order.length - 1; position >= 0; position--) {
    const index = order[position]!;
    const parent = tree[index]!.parent;
    if (kept[index] && parent >= 0) {
      kept[parent] = true;
    }
  }
  return kept;
}

/**
 * A BREP model's kept nodes: assemblies as groups, parts as meshes placed by their world matrices
 * (the groups above them have none).
 */
function brepObjects(
  scene: ImportedScene,
  tree: readonly TreeNode[],
  order: readonly number[],
  kept: readonly boolean[],
  target: ExportTarget,
  materials: ExportMaterials,
  owned: Set<{ dispose(): void }>,
): Object3D[] {
  const placementsOf = new Map<number, number[]>();
  scene.instances.forEach((instance, index) => placementsOf.set(instance.node, [...(placementsOf.get(instance.node) ?? []), index]));
  const surfaces = new Map<number, BufferGeometry>();
  const edges = new Map<number, BufferGeometry>();
  const shared = <T extends { dispose(): void }>(cache: Map<number, T>, prototype: number, create: () => T): T => {
    let value = cache.get(prototype);
    if (!value) {
      value = create();
      cache.set(prototype, value);
      owned.add(value);
    }
    return value;
  };

  const part = (name: string, prototype: number, matrix: readonly number[]): Object3D => {
    const mesh = scene.prototypes[prototype]!;
    const object =
      mesh.indices.length > 0
        ? new Mesh(
            shared(surfaces, prototype, () => surfaceGeometry(mesh)),
            materials.surfaces(mesh),
          )
        : new Group();
    object.name = name;
    tagRanges(object);
    place(object, new Matrix4().fromArray(matrix));
    if (target === 'gltf' && mesh.edges.length > 0) {
      const geometry = shared(edges, prototype, () => {
        const lines = new BufferGeometry();
        lines.setAttribute('position', new BufferAttribute(mesh.edges, 3));
        return lines;
      });
      const lines = new LineSegments(geometry, materials.edges());
      lines.name = `${name} edges`;
      lines.userData = { j3d: J3dEdgesTag };
      place(lines, new Matrix4());
      object.add(lines);
    }
    return object;
  };

  return buildTree(tree, order, kept, (node, index) => {
    const placements = node.prototype >= 0 ? (placementsOf.get(index) ?? []) : [];
    if (placements.length === 1) {
      return part(node.name, scene.instances[placements[0]!]!.prototype, scene.instances[placements[0]!]!.matrix);
    }
    const group = new Group();
    group.name = node.name;
    place(group, new Matrix4());
    for (const placement of placements) {
      group.add(part(node.name, scene.instances[placement]!.prototype, scene.instances[placement]!.matrix));
    }
    return group;
  });
}

/**
 * A mesh model's kept nodes: chosen parts are copies of their objects, sharing geometry and materials,
 * and the rest are groups. Top-level nodes take their world matrices, the rest their own.
 */
function meshObjects(
  nodes: readonly Object3D[],
  sceneRoot: boolean,
  tree: readonly TreeNode[],
  order: readonly number[],
  chosen: readonly boolean[],
  kept: readonly boolean[],
  target: ExportTarget,
): Object3D[] {
  const topLevel = (index: number) => {
    const parent = tree[index]!.parent;
    return parent < 0 || (sceneRoot && parent === 0);
  };
  const emitted = sceneRoot ? kept.map((keep, index) => keep && index !== 0) : kept;
  return buildTree(
    tree,
    order,
    emitted,
    (node, index) => {
      const original = nodes[index]!;
      const object = chosen[index] ? copyPart(original, target) : new Group();
      object.name = node.name;
      place(object, topLevel(index) ? original.matrixWorld : original.matrix);
      return object;
    },
    topLevel,
  );
}

/** A part's object again, on the same geometry and materials, with its BREP edges if it has any (J3D's GLB). */
function copyPart(original: Object3D, target: ExportTarget): Object3D {
  const instanced = original as Partial<InstancedMesh>;
  if (instanced.isInstancedMesh && target === 'stl') {
    // Three's STL exporter ignores instancing: one mesh per copy.
    const group = new Group();
    for (let index = 0; index < instanced.count!; index++) {
      const copy = new Mesh(instanced.geometry, instanced.material);
      place(copy, new Matrix4());
      instanced.getMatrixAt!(index, copy.matrix);
      group.add(copy);
    }
    return group;
  }
  const copy = original.clone(false);
  copy.userData = {};
  tagRanges(copy);
  copy.layers.set(0);
  if (target === 'gltf') {
    for (const edges of original.children.filter(isJ3dEdges)) {
      const lines = edges.clone(false);
      place(lines, edges.matrix);
      copy.add(lines);
    }
  }
  return copy;
}

/**
 * The kept nodes as objects, each under its parent's: `create` makes a node's object; nodes with no
 * kept parent, or `topLevel` ones, are returned as roots.
 */
function buildTree(
  tree: readonly TreeNode[],
  order: readonly number[],
  kept: readonly boolean[],
  create: (node: TreeNode, index: number) => Object3D,
  topLevel: (index: number) => boolean = (index) => tree[index]!.parent < 0,
): Object3D[] {
  const objects: (Object3D | undefined)[] = [];
  const roots: Object3D[] = [];
  order.forEach((index) => {
    const node = tree[index]!;
    if (!kept[index]) {
      return;
    }
    const object = create(node, index);
    objects[index] = object;
    const parent = topLevel(index) ? undefined : objects[node.parent];
    if (parent) {
      parent.add(object);
    } else {
      roots.push(object);
    }
  });
  return roots;
}

/** Marks a mesh drawn in several ranges, which J3D's glTF import joins back into one part. */
function tagRanges(object: Object3D): void {
  if ((object as Partial<Mesh>).isMesh && Array.isArray((object as Mesh).material)) {
    object.userData = { j3d: J3dRangesTag };
  }
}

/** Fixes an object's matrix: the writers read `matrix` and `matrixWorld`, not position and rotation. */
function place(object: Object3D, matrix: Matrix4): void {
  object.matrixAutoUpdate = false;
  object.matrix.copy(matrix);
}

/** A prototype's faces: its opaque index range, then its translucent one, each drawn with its own material. */
function surfaceGeometry(mesh: PrototypeMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  if (mesh.colors) {
    geometry.setAttribute('color', new BufferAttribute(mesh.colors, 4)); // linear RGBA, as glTF's COLOR_0
  }
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const total = mesh.indices.length;
  if (mesh.opaqueIndexCount > 0 && mesh.opaqueIndexCount < total) {
    geometry.addGroup(0, mesh.opaqueIndexCount, 0);
    geometry.addGroup(mesh.opaqueIndexCount, total - mesh.opaqueIndexCount, 1);
  }
  return geometry;
}

/** BREP parts' materials, one per colour and opacity, so a GLB writes each once. */
class ExportMaterials {
  private readonly byKey = new Map<string, Material>();

  constructor(private readonly owned: Set<{ dispose(): void }>) {}

  /** One material for a prototype's faces, or [opaque, translucent] for its two index ranges. */
  surfaces(mesh: PrototypeMesh): Material | Material[] {
    const colour = mesh.colors ? null : mesh.uniformColor;
    const total = mesh.indices.length;
    if (mesh.opaqueIndexCount === total) {
      return this.surface(colour, false);
    }
    if (mesh.opaqueIndexCount === 0) {
      return this.surface(colour, true);
    }
    return [this.surface(colour, false), this.surface(colour, true)];
  }

  /** Unlit: GLTFExporter writes a basic material as KHR_materials_unlit, and three loads lines with a line material. */
  edges(): Material {
    return this.get('edges', () => new MeshBasicMaterial({ color: EdgeColour }));
  }

  /** As the viewer draws it (materials.ts), without what only the view needs. */
  private surface(colour: LinearRgba | null, translucent: boolean): Material {
    const key = `${colour ? colour.map((c) => c.toFixed(4)).join(',') : 'vertex'}:${translucent ? 't' : 'o'}`;
    return this.get(key, () => {
      const material = new MeshStandardMaterial({
        color: colour ? new Color().setRGB(colour[0], colour[1], colour[2], LinearSRGBColorSpace) : 0xffffff,
        vertexColors: colour === null,
        metalness: SurfaceMetalness,
        roughness: SurfaceRoughness,
        side: DoubleSide,
      });
      if (translucent) {
        material.transparent = true;
        material.opacity = colour ? colour[3] : 1;
      }
      return material;
    });
  }

  private get(key: string, create: () => Material): Material {
    let material = this.byKey.get(key);
    if (!material) {
      material = create();
      this.byKey.set(key, material);
      this.owned.add(material);
    }
    return material;
  }
}
