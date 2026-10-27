import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelStructure } from '../edit/structure';
import { readMeshArrival, writeMeshArrival } from './mesh-arrival';

/** A group (0) holding a box (1, translated) and a box of two materials (2), the second hidden in its model. */
function model(): { objects: Object3D[]; structure: ModelStructure } {
  const group = new Group();
  group.name = 'Frame';
  const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  box.name = 'Box';
  box.position.set(10, 0, 0);
  const geometry = new BoxGeometry(2, 2, 2);
  geometry.clearGroups();
  geometry.addGroup(0, 18, 0);
  geometry.addGroup(18, 18, 1);
  const twoTone = new Mesh(geometry, [new MeshStandardMaterial({ color: 0xff0000 }), new MeshStandardMaterial({ color: 0x0000ff })]);
  twoTone.name = 'Two-tone';
  twoTone.visible = false;
  group.add(box, twoTone);
  const structure = new ModelStructure([
    { name: 'Frame', parent: -1, prototype: -1 },
    { name: 'Box', parent: 0, prototype: 0 },
    { name: 'Two-tone', parent: 0, prototype: 1 },
  ]);
  return { objects: [group, box, twoTone], structure };
}

beforeAll(() => {
  // GLTFExporter reads its GLB back through FileReader, which Node doesn't have (as export-scene.test.ts).
  class NodeFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  }
  globalThis.FileReader ??= NodeFileReader as unknown as typeof FileReader;
});

describe('mesh arrivals (M18, D227)', () => {
  it('write the objects as a GLB and read them back node for node, at the placement given', async () => {
    const { objects, structure } = model();
    const placed = new Matrix4().makeTranslation(0, 0, 50);

    const { bytes, order } = await writeMeshArrival(structure, (node) => objects[node]!, [{ node: 0, matrix: placed }]);
    const arrival = await readMeshArrival(new Blob([bytes]));

    expect(order).toEqual([0, 1, 2]);
    expect(arrival.nodes.map(({ name, parent, prototype }) => [name, parent, prototype >= 0])).toEqual([
      [expect.any(String), -1, false], // J3D's own assembly
      ['Frame', 0, false],
      ['Box', 1, true],
      ['Two-tone', 1, true],
    ]);
    expect(new Matrix4().fromArray(arrival.nodes[1]!.matrix!).equals(placed)).toBe(true);
    expect(arrival.nodes[2]!.matrix![12]).toBeCloseTo(10);
    // Its two materials come back as one mesh, so it's still one node.
    const twoTone = arrival.objects![3] as Mesh;
    expect(Array.isArray(twoTone.material)).toBe(true);
    expect(twoTone.geometry.groups).toHaveLength(2);
  });
});
