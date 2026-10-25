import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import { BatchedMesh, Box3, Group, InstancedBufferGeometry, InstancedMesh, LineSegments, Matrix4, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { ModelStructure, NoEdits, type ModelEdits } from '../edit/structure';
import { buildBrepObject, InstancingThreshold, toUnorm8 } from './brep-object';
import { MaterialCache } from './materials';
import { ModelFrame } from './parts';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translated = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

/** Two triangles; the second is translucent when `translucentFrom` is 3. */
function prototype(options: { translucentFrom?: number; colours?: boolean; alpha?: number } = {}): PrototypeMesh {
  const { translucentFrom = 6, colours = false, alpha = 1 } = options;
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    opaqueIndexCount: translucentFrom,
    ...(colours ? { colors: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0.5, 0, 0, 1, 0.5]) } : {}),
    uniformColor: [0.5, 0.5, 0.5, alpha],
    edges: new Float32Array([0, 0, 0, 1, 0, 0]),
    // One face (both triangles), one edge (the segment), and that edge's two ends.
    faceRanges: new Uint32Array([0, 6]),
    edgeRanges: new Uint32Array([0, 2]),
    vertices: new Float32Array([0, 0, 0, 1, 0, 0]),
  };
}

function scene(prototypes: PrototypeMesh[], placements: number[]): ImportedScene {
  return {
    nodes: placements.map((p, i) => ({ name: `part ${i}`, parent: -1, prototype: p })),
    instances: placements.map((p, i) => ({ node: i, prototype: p, matrix: i === 0 ? identity : translated(i) })),
    prototypes,
  };
}

describe('buildBrepObject', () => {
  const batches = (object: Group) => object.children.filter((c): c is BatchedMesh => c instanceof BatchedMesh);
  const lines = (object: Group) => object.children.filter((c): c is LineSegments => c instanceof LineSegments);
  const translationAt = (batch: BatchedMesh, instance: number) => batch.getMatrixAt(instance, new Matrix4()).elements[12];

  it('batches the placements of a prototype, sharing its geometry, with their edges in model space', () => {
    const materials = new MaterialCache();
    const { object } = buildBrepObject('model.step', scene([prototype()], [0, 0]), materials);

    expect(object.name).toBe('model.step');
    const [batch] = batches(object) as [BatchedMesh];
    expect(batches(object)).toHaveLength(1);
    expect(batch.instanceCount).toBe(2);
    expect([batch.getGeometryIdAt(0), batch.getGeometryIdAt(1)]).toEqual([0, 0]);
    expect([translationAt(batch, 0), translationAt(batch, 1)]).toEqual([0, 1]);
    expect(batch.sortObjects).toBe(false);

    // One edge segment per placement, the second moved 1 along x.
    const [edges] = lines(object) as [LineSegments];
    expect(lines(object)).toHaveLength(1);
    expect([...edges.geometry.getAttribute('position').array]).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(materials.size).toBe(2); // one surface, one edge material
  });

  it('draws parts that share a material in one batch, and a part of another colour in its own', () => {
    const grey = prototype();
    const red: PrototypeMesh = { ...prototype(), uniformColor: [0.8, 0.05, 0.05, 1] };
    const { object } = buildBrepObject('m', scene([grey, prototype(), red], [0, 1, 2]), new MaterialCache());

    const [first, second] = batches(object) as [BatchedMesh, BatchedMesh];
    expect(batches(object)).toHaveLength(2);
    expect(first.instanceCount).toBe(2);
    expect([first.getGeometryIdAt(0), first.getGeometryIdAt(1)]).toEqual([0, 1]);
    expect(second.instanceCount).toBe(1);
    expect(lines(object)).toHaveLength(1);
  });

  it('draws the translucent index range in a second, transparent and sorted batch', () => {
    const materials = new MaterialCache();
    const { object } = buildBrepObject('m', scene([prototype({ translucentFrom: 3, colours: true })], [0]), materials);

    const [opaque, translucent] = batches(object) as [BatchedMesh, BatchedMesh];
    const [opaqueMaterial, translucentMaterial] = [opaque.material, translucent.material] as MeshStandardMaterial[];
    expect([opaqueMaterial!.transparent, translucentMaterial!.transparent]).toEqual([false, true]);
    expect([opaqueMaterial!.vertexColors, translucentMaterial!.depthWrite]).toEqual([true, false]);
    expect([opaque.sortObjects, translucent.sortObjects]).toEqual([false, true]);
    expect([opaque.getGeometryRangeAt(0)!.indexCount, translucent.getGeometryRangeAt(0)!.indexCount]).toEqual([3, 3]);
    const colour = opaque.geometry.getAttribute('color');
    expect([colour.itemSize, colour.normalized, colour.array.constructor]).toEqual([4, true, Uint8Array]);
  });

  it('uses the colour alpha as opacity for a single-colour translucent part', () => {
    const materials = new MaterialCache();
    const { object } = buildBrepObject('m', scene([prototype({ translucentFrom: 0, alpha: 0.25 })], [0]), materials);

    const [batch] = batches(object) as [BatchedMesh];
    expect(batches(object)).toHaveLength(1);
    const material = batch.material as MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.25);
  });

  it(`instances a prototype placed ${InstancingThreshold} times or more, including its edges`, () => {
    const materials = new MaterialCache();
    const placements = Array.from({ length: InstancingThreshold }, () => 0);
    const { object } = buildBrepObject('m', scene([prototype()], placements), materials);

    expect(object.children).toHaveLength(2);
    const mesh = object.children[0] as InstancedMesh;
    expect(mesh).toBeInstanceOf(InstancedMesh);
    expect(mesh.count).toBe(InstancingThreshold);
    const edges = object.children[1] as LineSegments;
    const geometry = edges.geometry as InstancedBufferGeometry;
    expect(geometry).toBeInstanceOf(InstancedBufferGeometry);
    expect(geometry.instanceCount).toBe(InstancingThreshold);
    expect(geometry.getAttribute('instanceMatrix').array[16 + 12]).toBe(1);
    expect((edges.material as { defines?: object }).defines).toEqual({ USE_INSTANCING: '' });
  });

  it('shares materials between models and frees them with the last one', () => {
    const materials = new MaterialCache();
    const a = buildBrepObject('a', scene([prototype()], [0]), materials);
    const b = buildBrepObject('b', scene([prototype()], [0]), materials);
    expect(materials.size).toBe(2);

    let disposed = 0;
    a.object.children.forEach((c) => (c as BatchedMesh | LineSegments).geometry.addEventListener('dispose', () => disposed++));
    a.dispose();
    expect(a.object.children).toHaveLength(0);
    expect(disposed).toBe(2);
    expect(materials.size).toBe(2);
    b.dispose();
    expect(materials.size).toBe(0);
  });

  it('skips prototypes nothing places', () => {
    const { object } = buildBrepObject('m', scene([prototype(), prototype()], [1]), new MaterialCache());
    expect(object.children).toHaveLength(2);
    expect((object.children[0] as BatchedMesh).instanceCount).toBe(1);
  });
});

describe('placements (M13, D150)', () => {
  /**
   * An assembly placed 10 along x, holding a part at its origin and one 1 further along, and a part
   * on its own at 5: placed through their nodes' matrices, as the facade gives them.
   */
  function assembly(): ImportedScene {
    return {
      nodes: [
        { name: 'assembly', parent: -1, prototype: -1, matrix: translated(10) },
        { name: 'a', parent: 0, prototype: 0, matrix: identity },
        { name: 'b', parent: 0, prototype: 0, matrix: translated(1) },
        { name: 'alone', parent: -1, prototype: 0, matrix: translated(5) },
      ],
      instances: [
        { node: 1, prototype: 0, matrix: translated(10) },
        { node: 2, prototype: 0, matrix: translated(11) },
        { node: 3, prototype: 0, matrix: translated(5) },
      ],
      prototypes: [prototype()],
    };
  }

  const x = (matrix: Matrix4 | readonly number[]) => ('elements' in matrix ? matrix.elements : matrix)[12];

  it("gives each node its placement in its parent's frame and that frame in the world", () => {
    const { parts } = buildBrepObject('m', assembly(), new MaterialCache());

    expect(x(parts.placement(0).local)).toBe(10);
    expect(x(parts.placement(0).parentWorld)).toBe(0);
    expect(x(parts.placement(2).local)).toBe(1);
    expect(x(parts.placement(2).parentWorld)).toBe(10);
    expect(parts.placement(ModelFrame).local.equals(new Matrix4())).toBe(true);
  });

  it('moves everything under a node: instance matrices, batch matrices and merged edges', () => {
    const scene = assembly();
    const { object, parts } = buildBrepObject('m', scene, new MaterialCache());

    expect(parts.setPlacement(0, new Matrix4().makeTranslation(20, 0, 0))).toEqual([1, 2]);

    expect(scene.instances.map((instance) => x(instance.matrix))).toEqual([20, 21, 5]);
    const batch = object.children.find((c): c is BatchedMesh => c instanceof BatchedMesh)!;
    expect([0, 1, 2].map((id) => x(batch.getMatrixAt(id, new Matrix4())))).toEqual([20, 21, 5]);
    const edges = object.children.find((c): c is LineSegments => c instanceof LineSegments)!;
    expect([...edges.geometry.getAttribute('position').array]).toEqual([20, 0, 0, 21, 0, 0, 21, 0, 0, 22, 0, 0, 5, 0, 0, 6, 0, 0]);
    expect(parts.nodeBounds(2).min.x).toBe(21);
  });

  it("moves the whole model by its frame (D169): roots' parent frame is the model's", () => {
    const scene = assembly();
    const { parts } = buildBrepObject('m', scene, new MaterialCache());

    expect(parts.setPlacement(ModelFrame, new Matrix4().makeTranslation(100, 0, 0))).toEqual([1, 2, 3]);

    expect(scene.instances.map((instance) => x(instance.matrix))).toEqual([110, 111, 105]);
    expect(x(parts.placement(0).parentWorld)).toBe(100);
    expect(x(parts.placement(ModelFrame).local)).toBe(100);
  });

  it('moves instanced copies and their edges, and a hidden copy stays hidden until shown where it now is', () => {
    const count = InstancingThreshold;
    const scene: ImportedScene = {
      nodes: [
        { name: 'rack', parent: -1, prototype: -1, matrix: identity },
        ...Array.from({ length: count }, (_, i) => ({ name: `bolt ${i}`, parent: 0, prototype: 0, matrix: translated(i) })),
      ],
      instances: Array.from({ length: count }, (_, i) => ({ node: i + 1, prototype: 0, matrix: translated(i) })),
      prototypes: [prototype()],
    };
    const { object, parts } = buildBrepObject('m', scene, new MaterialCache());
    parts.setHidden(new Set([2]));

    parts.setPlacement(0, new Matrix4().makeTranslation(50, 0, 0));

    const mesh = object.children.find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    expect(x(mesh.getMatrixAt(0, new Matrix4()))).toBe(50);
    expect(mesh.getMatrixAt(1, new Matrix4()).elements[0]).toBe(0); // bolt 1 (node 2) is hidden: a zero matrix
    const lines = object.children.find((c): c is LineSegments => c instanceof LineSegments)!;
    expect((lines.geometry.getAttribute('instanceMatrix').array as Float32Array)[16 * 2 + 12]).toBe(52);

    parts.setHidden(new Set());
    expect(x(mesh.getMatrixAt(1, new Matrix4()))).toBe(51);
  });
});

describe('edits (M14, D151, D152)', () => {
  /** As in the placements tests: an assembly at 10 holding a (at 10) and b (at 11), and alone at 5. */
  function assembly(): ImportedScene {
    return {
      nodes: [
        { name: 'assembly', parent: -1, prototype: -1, matrix: translated(10) },
        { name: 'a', parent: 0, prototype: 0, matrix: identity },
        { name: 'b', parent: 0, prototype: 0, matrix: translated(1) },
        { name: 'alone', parent: -1, prototype: 0, matrix: translated(5) },
      ],
      instances: [
        { node: 1, prototype: 0, matrix: translated(10) },
        { node: 2, prototype: 0, matrix: translated(11) },
        { node: 3, prototype: 0, matrix: translated(5) },
      ],
      prototypes: [prototype()],
    };
  }

  const x = (matrix: Matrix4 | readonly number[]) => ('elements' in matrix ? matrix.elements : matrix)[12];
  const edited = (scene: ImportedScene, edits: Partial<ModelEdits>) => new ModelStructure(scene.nodes, { ...NoEdits, ...edits });
  const copies = (object: Group) => object.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name.endsWith('copies'));

  it('moves a node to another parent where it is in the world, and says what to keep', () => {
    const scene = assembly();
    const { parts } = buildBrepObject('m', scene, new MaterialCache());

    const kept = parts.setStructure(edited(scene, { children: [{ parent: 0, nodes: [1] }, { parent: -1, nodes: [0, 3, 2] }] }));

    expect(kept.map(({ node, matrix }) => [node, x(matrix)])).toEqual([[2, 11]]);
    expect(x(parts.placement(2).local)).toBe(11);
    expect(x(parts.placement(2).parentWorld)).toBe(0);
    expect(scene.instances.map((instance) => x(instance.matrix))).toEqual([10, 11, 5]);
    // Moving the assembly no longer moves b.
    expect(parts.setPlacement(0, new Matrix4().makeTranslation(20, 0, 0))).toEqual([1]);
    expect(x(scene.instances[1]!.matrix)).toBe(11);
  });

  it('adds a copy where its source is, drawn in its own instanced mesh, which follows its parent and goes on undo', () => {
    const scene = assembly();
    const { object, parts } = buildBrepObject('m', scene, new MaterialCache());

    const kept = parts.setStructure(edited(scene, { added: [1], children: [{ parent: 0, nodes: [1, 4, 2] }] }));

    expect(kept.map(({ node, matrix }) => [node, x(matrix)])).toEqual([[4, 0]]);
    expect(parts.partNodes).toEqual([1, 2, 3, 4]);
    const mesh = copies(object)!;
    expect(mesh.count).toBe(1);
    expect(x(mesh.getMatrixAt(0, new Matrix4()))).toBe(10);
    expect(parts.nodeBounds(4).min.x).toBe(10);
    expect(parts.exportScene().instances.map((instance) => instance.node)).toEqual([1, 2, 3, 4]);

    parts.setPlacement(0, new Matrix4().makeTranslation(30, 0, 0));
    expect(x(mesh.getMatrixAt(0, new Matrix4()))).toBe(30);

    parts.setStructure(new ModelStructure(scene.nodes));
    expect(mesh.count).toBe(0);
    expect(parts.partNodes).toEqual([1, 2, 3]);
    expect(parts.exportScene().instances.map((instance) => instance.node)).toEqual([1, 2, 3]);
  });

  it('grows the copies in steps, keeping those already drawn, and hides a hidden copy', () => {
    const scene = assembly();
    const { object, parts } = buildBrepObject('m', scene, new MaterialCache());
    const added = Array.from({ length: 10 }, () => 3);
    const nodes = added.map((_, i) => 4 + i);

    parts.setStructure(edited(scene, { added, children: [{ parent: -1, nodes: [0, 3, ...nodes] }] }));

    const mesh = copies(object)!;
    expect(mesh.count).toBe(10);
    expect([0, 9].map((slot) => x(mesh.getMatrixAt(slot, new Matrix4())))).toEqual([5, 5]);
    parts.setHidden(new Set([13]));
    expect(mesh.getMatrixAt(9, new Matrix4()).determinant()).toBe(0);
    parts.setHidden(new Set());
    expect(x(mesh.getMatrixAt(9, new Matrix4()))).toBe(5);
  });

  it('hides a removed node with everything under it, and shows it again when it comes back', () => {
    const scene = assembly();
    const { object, parts } = buildBrepObject('m', scene, new MaterialCache());
    const batch = object.children.find((c): c is BatchedMesh => c instanceof BatchedMesh)!;

    parts.setStructure(edited(scene, { children: [{ parent: -1, nodes: [3] }] }));
    expect([0, 1, 2].map((id) => batch.getVisibleAt(id))).toEqual([false, false, true]);
    expect(parts.partNodes).toEqual([3]);
    expect(parts.addVisibleBounds(new Box3()).max.x).toBe(6);

    parts.setStructure(new ModelStructure(scene.nodes));
    expect([0, 1, 2].map((id) => batch.getVisibleAt(id))).toEqual([true, true, true]);
  });

  it('undoes a paste, a new assembly holding the copy, a rename and a drop, step by step, with nothing moving', () => {
    const scene = assembly();
    const { parts } = buildBrepObject('m', scene, new MaterialCache());
    const steps: Partial<ModelEdits>[] = [
      {},
      { added: [3], children: [{ parent: -1, nodes: [0, 3, 4] }] },
      { added: [3, -1], children: [{ parent: -1, nodes: [5, 4] }, { parent: 5, nodes: [0, 3] }], names: [{ node: 5, name: 'Assembly 1' }] },
      { added: [3, -1], children: [{ parent: -1, nodes: [5, 4] }, { parent: 5, nodes: [0, 3] }], names: [{ node: 5, name: 'Fixings' }] },
      { added: [3, -1], children: [{ parent: -1, nodes: [5] }, { parent: 5, nodes: [0, 3, 4] }], names: [{ node: 5, name: 'Fixings' }] },
    ];
    const worlds = () => scene.instances.filter((instance) => instance.node >= 0).map((instance) => [instance.node, x(instance.matrix)]);

    for (const step of [1, 2, 3, 4, 3, 2, 1, 0]) {
      parts.setStructure(edited(scene, steps[step]!));
      expect(worlds()).toEqual([[1, 10], [2, 11], [3, 5], ...(step > 0 ? [[4, 5]] : [])]);
    }
    expect(parts.partNodes).toEqual([1, 2, 3]);
    expect(x(parts.placement(0).local)).toBe(10);
  });

  it("puts a new assembly at its parent's origin (D184), and its children stay where they are", () => {
    const scene = assembly();
    const { parts } = buildBrepObject('m', scene, new MaterialCache());

    const kept = parts.setStructure(
      edited(scene, {
        added: [-1],
        children: [
          { parent: 0, nodes: [1, 4] },
          { parent: 4, nodes: [2] },
        ],
      }),
    );

    expect(kept.map(({ node, matrix }) => [node, x(matrix)])).toEqual([
      [4, 0],
      [2, 1],
    ]);
    expect(x(parts.placement(4).parentWorld)).toBe(10);
    expect(x(scene.instances[1]!.matrix)).toBe(11);
  });
});

describe('toUnorm8', () => {
  it('rounds and clamps linear colours to bytes', () => {
    expect([...toUnorm8(new Float32Array([0, 1, 0.5, 2, -1]))]).toEqual([0, 255, 128, 255, 0]);
  });
});
