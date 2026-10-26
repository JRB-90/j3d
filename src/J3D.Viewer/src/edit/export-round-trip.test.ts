// @vitest-environment node
// R24 (M15): an edited BREP model, written by the facade from the viewer's plan, imported again and
// compared with what the viewer shows: each part's assembly path, name, colour and world bounds.

import { readFileSync } from 'node:fs';
import { ExportFormat, ImportFormat, OcctModel, type ImportedScene, type OcctModule } from '@j3d/occt/facade';
import init from '@j3d/occt/single';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBrepObject } from '../view/brep-object';
import { MaterialCache } from '../view/materials';
import { Matrix4 } from 'three';
import { exportPlan, writesAsImported } from './export-plan';
import { ModelStructure, NoEdits, TopLevel, type Expansions, type ModelEdits } from './structure';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url)));
const shift = (x: number, y = 0, z = 0) => new Matrix4().makeTranslation(x, y, z);

let oc: OcctModule;

beforeAll(async () => {
  oc = (await init()) as unknown as OcctModule;
});

/** Each drawn part as "path › name | colour | bounds", sorted: what a file has to give back. */
function parts(scene: Pick<ImportedScene, 'instances' | 'prototypes'>, names: (node: number) => string): string[] {
  return scene.instances
    .map(({ node, prototype, matrix }) => {
      const mesh = scene.prototypes[prototype]!;
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const [x, y, z] = [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
        [0, 1, 2].forEach((axis) => {
          const value = matrix[axis]! * x + matrix[4 + axis]! * y + matrix[8 + axis]! * z + matrix[12 + axis]!;
          box[axis] = Math.min(box[axis]!, value);
          box[axis + 3] = Math.max(box[axis + 3]!, value);
        });
      }
      const colour = mesh.uniformColor.map((channel) => channel.toFixed(3)).join(',');
      return `${names(node)} | ${colour}${mesh.colors ? ' +faces' : ''} | ${box.map((value) => (Math.abs(value) < 5e-4 ? 0 : value).toFixed(3)).join(',')}`;
    })
    .sort();
}

const pathOf = (nodes: readonly { name: string; parent: number }[]) => (node: number) => {
  const names: string[] = [];
  for (let current = node; current >= 0; current = nodes[current]!.parent) {
    names.unshift(nodes[current]!.name);
  }
  return names.join(' › ');
};

interface Edit {
  edits?: ModelEdits;
  expand?: number[];
  moves?: [number, Matrix4][];
  hidden?: number[];
  selection?: number[];
}

/** Imports a fixture, edits it in the viewer's BREP object, and writes it from the plan. */
async function edited(name: string, { edits = NoEdits, expand = [], moves = [], hidden = [], selection }: Edit, format: ExportFormat = ExportFormat.Step) {
  const model = await OcctModel.load(oc, fixture(name), ImportFormat.Step, name);
  const expansions: Expansions = new Map(expand.map((node) => [node, model.expand(node).pieces]));
  const { parts: brep } = buildBrepObject(name, model.scene, new MaterialCache());
  const structure = new ModelStructure(model.scene.nodes, edits, expansions);
  brep.setStructure(structure);
  moves.forEach(([node, matrix]) => brep.setPlacement(node, matrix));
  const source = brep.planSource(expansions, new Set(hidden));
  const plan = exportPlan(source, selection && new Set(selection));
  const bytes = model.exportTree(format, plan);
  // What the viewer shows: its live, visible (and selected) placements.
  const shown = brep.exportScene();
  shown.instances = shown.instances.filter(({ node }) => !hidden.includes(node) && (!selection || selection.includes(node)));
  const expected = parts(shown, pathOf(structure.nodes));
  const again = await OcctModel.load(oc, bytes, format === ExportFormat.Step ? ImportFormat.Step : ImportFormat.Brep, 'again');
  const result = { plan, bytes, expected, again, source, model };
  return result;
}

describe('STEP of an edited model (M15, R24)', () => {
  it('gives back the parts it shows after copies, moves, renames, deletions and a new assembly', async () => {
    // Plant (0) › Line 1 (1) › Conveyor 1 (2), Station 1 (10) …; the Guard (27) is in Station 1.
    using plant = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    const plantNodes = plant.scene.nodes;
    const line = plantNodes[1]!;
    expect(line.name).toBe('Line 1');
    const total = plantNodes.length;
    // Copy Station 1 (10) with its subtree to the top level, delete the Guard, rename the Table (11).
    const subtree: number[] = [];
    const visit = (node: number) => {
      subtree.push(node);
      plantNodes.forEach((child, index) => child.parent === node && visit(index));
    };
    visit(10);
    const ids = new Map(subtree.map((node, i) => [node, total + i]));
    const children = new Map<number, number[]>();
    subtree.slice(1).forEach((node) => {
      const parent = ids.get(plantNodes[node]!.parent)!;
      children.set(parent, [...(children.get(parent) ?? []), ids.get(node)!]);
    });
    const tenChildren = plantNodes.flatMap((node, index) => (node.parent === 10 && index !== 27 ? [index] : []));
    const edits: ModelEdits = {
      added: subtree,
      children: [
        { parent: TopLevel, nodes: [0, total] },
        { parent: 10, nodes: tenChildren },
        ...[...children].map(([parent, nodes]) => ({ parent, nodes })),
      ],
      names: [{ node: 11, name: 'Bench' }],
    };
    const { expected, again, bytes, model } = await edited('plant.step', { edits, moves: [[total, shift(0, 2000)], [13, shift(0, 0, 25)]] });
    using _ = again;
    using __ = model;
    expect(parts(again.scene, pathOf(again.scene.nodes))).toEqual(expected);
    // The file's definitions stay shared: the parts' shapes are the file's twelve.
    expect(again.scene.prototypes).toHaveLength(12);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("puts a moved model's frame into its top level, and a single part's placement on the part", async () => {
    for (const name of ['assembly.step', 'coloured-part.step']) {
      const { expected, again, model, source } = await edited(name, { moves: [[-1, shift(100, 0, 10)]] });
      using _ = again;
      using __ = model;
      expect(writesAsImported(source)).toBe(false);
      expect(parts(again.scene, pathOf(again.scene.nodes))).toEqual(expected);
      expect(again.scene.nodes).toHaveLength(model.scene.nodes.length);
    }
  });

  it('writes a selection under its assembly path, and leaves out hidden parts (D155, D194)', async () => {
    // The first Gripper (20) and Joint (19) in Wrist (18); the Joint hidden.
    const { expected, again, model } = await edited('plant.step', { selection: [19, 20], hidden: [19] });
    using _ = again;
    using __ = model;
    expect(parts(again.scene, pathOf(again.scene.nodes))).toEqual(expected);
    expect(expected).toHaveLength(1);
    expect(expected[0]).toMatch(/^Plant › Line 1 › Station 1 › Robot › Arm › Wrist › Gripper \|/);
  });

  it("writes an expanded part's pieces, named as J3D numbers them (D154, D191)", async () => {
    // The first Gripper (20) gives way to its assembly (175) with two pieces (176, 177).
    const total = 175;
    const edits: ModelEdits = {
      added: [-1, -1, -1],
      children: [
        { parent: 18, nodes: [19, total] },
        { parent: total, nodes: [total + 1, total + 2] },
      ],
      names: [],
      pieces: [
        { node: total, expands: 20, piece: -1, name: 'Gripper', part: false },
        { node: total + 1, expands: 20, piece: 0, name: 'Gripper 1', part: true },
        { node: total + 2, expands: 20, piece: 1, name: 'Gripper 2', part: true },
      ],
    };
    const { expected, again, model } = await edited('plant.step', { edits, expand: [20] });
    using _ = again;
    using __ = model;
    const result = parts(again.scene, pathOf(again.scene.nodes));
    expect(result).toEqual(expected);
    expect(result.filter((line) => line.includes('Wrist › Gripper › Gripper '))).toHaveLength(2);
  });

  it('writes BREP as nested compounds of the parts it shows (D196)', async () => {
    const { again, model, expected } = await edited('plant.step', { hidden: [27] }, ExportFormat.Brep);
    using _ = again;
    using __ = model;
    // Every face shown, in one part: BREP has no assembly, names or colours to read back.
    const faces = (scene: ImportedScene, except = -1) =>
      scene.instances.reduce((sum, { node, prototype }) => sum + (node === except ? 0 : scene.prototypes[prototype]!.faceRanges.length / 2), 0);
    expect(again.scene.nodes).toHaveLength(1);
    expect(faces(again.scene)).toBe(faces(model.scene, 27));
    expect(expected).toHaveLength(model.scene.instances.length - 1);
  });
});
