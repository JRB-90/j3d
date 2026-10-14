import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import { InstancedBufferGeometry, InstancedMesh, LineSegments, Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { buildBrepObject, InstancingThreshold, toUnorm8 } from './brep-object';
import { MaterialCache } from './materials';

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
  it('places each instance of a prototype with its world matrix and shares the geometry', () => {
    const materials = new MaterialCache();
    const { object } = buildBrepObject('model.step', scene([prototype()], [0, 0]), materials);

    expect(object.name).toBe('model.step');
    const meshes = object.children.filter((c): c is Mesh => c instanceof Mesh);
    const lines = object.children.filter((c): c is LineSegments => c instanceof LineSegments);
    expect(meshes.map((m) => m.name)).toEqual(['part 0', 'part 1']);
    expect(lines).toHaveLength(2);
    expect(meshes[0]!.geometry).toBe(meshes[1]!.geometry);
    expect(meshes[1]!.matrix.elements[12]).toBe(1);
    expect(meshes[1]!.matrixAutoUpdate).toBe(false);
    expect(materials.size).toBe(2); // one surface, one edge material
  });

  it('draws the translucent index range with a second, transparent material', () => {
    const materials = new MaterialCache();
    const { object } = buildBrepObject('m', scene([prototype({ translucentFrom: 3, colours: true })], [0]), materials);

    const mesh = object.children.find((c): c is Mesh => c instanceof Mesh)!;
    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ]);
    const [opaque, translucent] = mesh.material as MeshStandardMaterial[];
    expect([opaque!.transparent, translucent!.transparent]).toEqual([false, true]);
    expect([opaque!.vertexColors, translucent!.depthWrite]).toEqual([true, false]);
    const colour = mesh.geometry.getAttribute('color');
    expect([colour.itemSize, colour.normalized, colour.array.constructor]).toEqual([4, true, Uint8Array]);
  });

  it('uses the colour alpha as opacity for a single-colour translucent part', () => {
    const materials = new MaterialCache();
    const { object } = buildBrepObject('m', scene([prototype({ translucentFrom: 0, alpha: 0.25 })], [0]), materials);

    const material = object.children.find((c): c is Mesh => c instanceof Mesh)!.material as MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.25);
    expect(object.children.find((c): c is Mesh => c instanceof Mesh)!.geometry.groups).toEqual([]);
  });

  it(`instances a prototype placed ${InstancingThreshold} times or more, including its edges`, () => {
    const materials = new MaterialCache();
    const placements = Array.from({ length: InstancingThreshold }, () => 0);
    const { object } = buildBrepObject('m', scene([prototype()], placements), materials);

    expect(object.children).toHaveLength(2);
    const mesh = object.children[0] as InstancedMesh;
    expect(mesh).toBeInstanceOf(InstancedMesh);
    expect(mesh.count).toBe(InstancingThreshold);
    const lines = object.children[1] as LineSegments;
    const geometry = lines.geometry as InstancedBufferGeometry;
    expect(geometry).toBeInstanceOf(InstancedBufferGeometry);
    expect(geometry.instanceCount).toBe(InstancingThreshold);
    expect(geometry.getAttribute('instanceMatrix').array[16 + 12]).toBe(1);
    expect((lines.material as { defines?: object }).defines).toEqual({ USE_INSTANCING: '' });
  });

  it('shares materials between models and frees them with the last one', () => {
    const materials = new MaterialCache();
    const a = buildBrepObject('a', scene([prototype()], [0]), materials);
    const b = buildBrepObject('b', scene([prototype()], [0]), materials);
    expect(materials.size).toBe(2);

    let disposed = 0;
    a.object.children.forEach((c) => (c as Mesh).geometry.addEventListener('dispose', () => disposed++));
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
  });
});

describe('toUnorm8', () => {
  it('rounds and clamps linear colours to bytes', () => {
    expect([...toUnorm8(new Float32Array([0, 1, 0.5, 2, -1]))]).toEqual([0, 255, 128, 255, 0]);
  });
});
