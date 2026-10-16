import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import {
  BatchedMesh,
  Box3,
  BoxGeometry,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../import/types';
import { buildBrepObject, InstancingThreshold } from './brep-object';
import { EdgeVisibilityAttribute, MaterialCache } from './materials';
import { HiddenLayer, HighlightMaterials, MeshParts } from './parts';
import { keyCommand } from './viewer';

const translated = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

/** A unit quad in z = 0 with one edge along x. */
function quad(): PrototypeMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    opaqueIndexCount: 6,
    uniformColor: [0.5, 0.5, 0.5, 1],
    edges: new Float32Array([0, 0, 0, 1, 0, 0]),
    // One face (both triangles), one edge (the segment), and that edge's two ends.
    faceRanges: new Uint32Array([0, 6]),
    edgeRanges: new Uint32Array([0, 2]),
    vertices: new Float32Array([0, 0, 0, 1, 0, 0]),
  };
}

/** An assembly (node 0) of `count` quads side by side along x, each its own node (1…count). */
function row(count: number): ImportedScene {
  return {
    nodes: [{ name: 'assembly', parent: -1, prototype: -1 }, ...Array.from({ length: count }, (_, i) => ({ name: `part ${i}`, parent: 0, prototype: 0 }))],
    instances: Array.from({ length: count }, (_, i) => ({ node: i + 1, prototype: 0, matrix: translated(i * 2) })),
    prototypes: [quad()],
  };
}

/** The node a ray straight down at (x, 0.5) picks, or -1. */
function pickDown(object: Object3D, nodeOf: (hit: Parameters<MeshParts['nodeOf']>[0]) => number, x: number): number {
  const raycaster = new Raycaster(new Vector3(x, 0.5, 5), new Vector3(0, 0, -1));
  object.updateMatrixWorld(true);
  const hit = raycaster.intersectObject(object, true)[0];
  return hit ? nodeOf(hit) : -1;
}

describe('BREP parts', () => {
  it('lists the placed nodes and picks the placement under a ray, batched or instanced', () => {
    for (const count of [3, InstancingThreshold]) {
      const { object, parts } = buildBrepObject('m', row(count), new MaterialCache());
      expect(parts.partNodes).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      expect(pickDown(object, (hit) => parts.nodeOf(hit), 0.5)).toBe(1);
      expect(pickDown(object, (hit) => parts.nodeOf(hit), 2.5)).toBe(2);
      expect(pickDown(object, (hit) => parts.nodeOf(hit), 1.5)).toBe(-1); // the gap between them
    }
  });

  it('hides batched placements and drops their merged edges, and shows them again', () => {
    const { object, parts } = buildBrepObject('m', row(3), new MaterialCache());
    const batch = object.children.find((c): c is BatchedMesh => c instanceof BatchedMesh)!;
    const edges = object.children.find((c): c is LineSegments => c instanceof LineSegments)!;
    const visibility = () => [...(edges.geometry.getAttribute(EdgeVisibilityAttribute).array as Uint8Array)];

    parts.setHidden(new Set([2]));
    expect([0, 1, 2].map((id) => batch.getVisibleAt(id))).toEqual([true, false, true]);
    expect(visibility()).toEqual([1, 1, 0, 0, 1, 1]);
    expect(pickDown(object, (hit) => parts.nodeOf(hit), 2.5)).toBe(-1);

    parts.setHidden(new Set());
    expect([0, 1, 2].map((id) => batch.getVisibleAt(id))).toEqual([true, true, true]);
    expect(visibility()).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('hides an instanced placement and its edges with a zero matrix, and restores its transform', () => {
    const { object, parts } = buildBrepObject('m', row(InstancingThreshold), new MaterialCache());
    const mesh = object.children.find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    const edges = object.children.find((c): c is LineSegments => c instanceof LineSegments)!;
    const edgeMatrix = (i: number) => [...edges.geometry.getAttribute('instanceMatrix').array.slice(i * 16, i * 16 + 16)];

    parts.setHidden(new Set([2]));
    expect(mesh.getMatrixAt(1, new Matrix4()).determinant()).toBe(0);
    expect(edgeMatrix(1).every((value) => value === 0 || value === 1)).toBe(true);
    expect(edgeMatrix(1)[0]).toBe(0);

    parts.setHidden(new Set());
    expect(mesh.getMatrixAt(1, new Matrix4()).elements[12]).toBe(2);
    expect(edgeMatrix(1)[12]).toBe(2);
  });

  it('bounds only the visible placements', () => {
    const { parts } = buildBrepObject('m', row(3), new MaterialCache());
    expect(parts.addVisibleBounds(new Box3()).max.x).toBe(5);
    parts.setHidden(new Set([3]));
    expect(parts.addVisibleBounds(new Box3()).max.x).toBe(3);
    parts.setHidden(new Set([1, 2, 3]));
    expect(parts.addVisibleBounds(new Box3()).isEmpty()).toBe(true);
  });

  it('highlights any number of parts as one batch and one line set, freed on dispose', () => {
    const { parts } = buildBrepObject('m', row(InstancingThreshold), new MaterialCache());
    const highlights = new HighlightMaterials();
    const highlight = parts.highlight([1, 3, 5], 'selected', highlights)!;
    const [surfaces, edges] = highlight.object.children as [BatchedMesh, LineSegments];

    expect(highlight.object.children).toHaveLength(2);
    expect(surfaces).toBeInstanceOf(BatchedMesh);
    expect(surfaces.instanceCount).toBe(3);
    expect(surfaces.material).toBe(highlights.surface('selected'));
    expect(surfaces.renderOrder).toBeGreaterThan(0);
    // Each part's edge, in model space.
    expect([...edges.geometry.getAttribute('position').array].filter((_, i) => i % 3 === 0)).toEqual([0, 1, 4, 5, 8, 9]);
    expect(parts.highlight([0], 'hovered', highlights)).toBeUndefined(); // the assembly itself draws nothing

    highlight.dispose();
    expect(highlight.object.children).toHaveLength(0);
  });
});

describe('mesh parts', () => {
  /** root → a (mesh) → b (mesh, child of a), and an empty group c. */
  function hierarchy(): { root: Group; nodes: Object3D[]; tree: TreeNode[] } {
    const root = new Group();
    const material = new MeshStandardMaterial();
    const a = new Mesh(new BoxGeometry(1, 1, 1), material);
    const b = new Mesh(new BoxGeometry(1, 1, 1), material);
    b.position.x = 3;
    const c = new Group();
    root.add(a, c);
    a.add(b);
    root.updateMatrixWorld(true);
    const tree: TreeNode[] = [
      { name: 'root', parent: -1, prototype: -1 },
      { name: 'a', parent: 0, prototype: 0 },
      { name: 'b', parent: 1, prototype: 1 },
      { name: 'c', parent: 0, prototype: -1 },
    ];
    return { root, nodes: [root, a, b, c], tree };
  }

  it('lists the nodes with geometry and picks them by object', () => {
    const { root, nodes, tree } = hierarchy();
    const parts = new MeshParts(nodes, tree);
    expect(parts.partNodes).toEqual([1, 2]);
    expect(pickDown(root, (hit) => parts.nodeOf(hit), 0)).toBe(1);
    expect(pickDown(root, (hit) => parts.nodeOf(hit), 3)).toBe(2);
  });

  it('hides a node without hiding its children, and bounds what is visible', () => {
    const { root, nodes, tree } = hierarchy();
    const parts = new MeshParts(nodes, tree);

    parts.setHidden(new Set([1]));
    expect(nodes[1]!.layers.isEnabled(HiddenLayer)).toBe(true);
    expect(nodes[1]!.layers.isEnabled(0)).toBe(false);
    expect(nodes[2]!.layers.isEnabled(0)).toBe(true);
    expect(pickDown(root, (hit) => parts.nodeOf(hit), 0)).toBe(-1);
    expect(pickDown(root, (hit) => parts.nodeOf(hit), 3)).toBe(2);
    expect(parts.addVisibleBounds(new Box3()).min.x).toBe(2.5);

    parts.setHidden(new Set());
    expect(nodes[1]!.layers.isEnabled(0)).toBe(true);
    expect(parts.addVisibleBounds(new Box3()).min.x).toBe(-0.5);
  });

  it('highlights a node by drawing its geometry again where it is', () => {
    const { nodes, tree } = hierarchy();
    const instanced = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 2);
    const parts = new MeshParts([...nodes, instanced], [...tree, { name: 'i', parent: 0, prototype: 2 }]);
    const highlight = parts.highlight([2, 4], 'selected', new HighlightMaterials())!;
    const [b, copies] = highlight.object.children as [Mesh, InstancedMesh];

    expect(b.geometry).toBe((nodes[2] as Mesh).geometry);
    expect(b.matrixWorld.elements[12]).toBe(3);
    expect(copies).toBeInstanceOf(InstancedMesh);
    expect(copies.instanceMatrix).toBe(instanced.instanceMatrix);
    expect(parts.highlight([3], 'selected', new HighlightMaterials())).toBeUndefined();
  });
});

describe('keyCommand (D99)', () => {
  it('maps the keys to fit and to .NET commands', () => {
    expect(keyCommand('f', false, false)).toBe('fit');
    expect(keyCommand('f', true, false)).toBe('fit');
    expect(keyCommand('escape', false, false)).toBe('clearSelection');
    expect(keyCommand('h', false, false)).toBe('hide');
    expect(keyCommand('h', true, false)).toBe('showAll');
    expect(keyCommand('i', false, false)).toBe('isolate');
    expect(keyCommand('z', false, true)).toBe('undo');
    expect(keyCommand('z', true, true)).toBe('redo');
    expect(keyCommand('y', false, true)).toBe('redo');
  });

  it('ignores everything else, including the letters with Ctrl', () => {
    expect(keyCommand('h', false, true)).toBeUndefined();
    expect(keyCommand('f', false, true)).toBeUndefined();
    expect(keyCommand('x', false, false)).toBeUndefined();
    expect(keyCommand('i', true, false)).toBeUndefined();
  });
});
