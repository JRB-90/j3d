// Expand and edited exports (M15, decisions D154, D188–D196) against the real OCCT build: plans of a
// model's tree are written as STEP or BREP, imported again and compared (names, structure, colours,
// world bounds); the viewer's own plans are round-tripped in src/J3D.Viewer (R24).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import {
  EntityKind,
  ExportFormat,
  ExportStatus,
  FileOrigin,
  ImportFormat,
  OcctExportError,
  OcctMeasureError,
  OcctModel,
  PlanKind,
  planText,
  type ImportedScene,
  type OcctModule,
  type PlanNode,
} from './facade';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url)));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shift = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

let oc: OcctModule;

beforeAll(async () => {
  oc = await init();
});

/** Each placement as "path | colour | world bounds", in the file's order. */
function parts(scene: ImportedScene): string[] {
  const path = (node: number): string => {
    const { name, parent } = scene.nodes[node]!;
    return parent >= 0 ? `${path(parent)} › ${name}` : name;
  };
  return scene.instances.map(({ node, prototype, matrix: m }) => {
    const mesh = scene.prototypes[prototype]!;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
      [0, 1, 2].forEach((axis) => {
        const value = m[axis]! * x + m[4 + axis]! * y + m[8 + axis]! * z + m[12 + axis]!;
        box[axis] = Math.min(box[axis]!, value);
        box[axis + 3] = Math.max(box[axis + 3]!, value);
      });
    }
    const colour = mesh.uniformColor.map((channel) => channel.toFixed(3)).join(',');
    return `${path(node)} | ${colour}${mesh.colors ? ' +faces' : ''} | ${box.map((value) => (Math.abs(value) < 5e-4 ? 0 : value).toFixed(2)).join(',')}`;
  });
}

/** Every assembly as a new one and every part reused, as the file has them. */
function rebuilt(scene: ImportedScene): PlanNode[] {
  return scene.nodes.map((node, i) => ({
    kind: node.prototype >= 0 ? PlanKind.Reuse : PlanKind.Assembly,
    parent: node.parent,
    ref: i,
    piece: FileOrigin,
    matrix: node.parent >= 0 ? node.matrix! : identity,
    name: node.name,
  }));
}

async function again(bytes: Uint8Array, format: ImportFormat = ImportFormat.Step) {
  return OcctModel.load(oc, bytes, format, format === ImportFormat.Step ? 'again.step' : 'again.brep');
}

describe('scene', () => {
  it("counts the parts Expand would make of each compound part (D190), and nothing else's", async () => {
    using model = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    const expandable = model.scene.nodes.filter((node) => node.pieces !== undefined);
    expect(new Set(expandable.map(({ name, pieces }) => `${name} ${pieces}`))).toEqual(new Set(['Gripper 2', 'Guard 3']));
    expect(expandable).toHaveLength(12);
  });
});

describe('expand (M15, D154, D189–D191)', () => {
  it("gives a compound part's pieces, drawing new prototypes, the same pieces for every occurrence", async () => {
    using model = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    const before = model.scene.prototypes.length;
    const gripper = model.scene.nodes.findIndex((node) => node.name === 'Gripper');
    const { pieces, prototypes } = model.expand(gripper);

    expect(pieces.map(({ name, parent }) => [name, parent])).toEqual([['', -1], ['', -1]]); // the fixture names none
    expect(prototypes).toHaveLength(2);
    expect(pieces.map(({ prototype }) => prototype)).toEqual([before, before + 1]);
    expect(model.scene.prototypes).toHaveLength(before + 2);
    // The pieces draw what the part drew: its faces, in its colour.
    const part = model.scene.prototypes[model.scene.nodes[gripper]!.prototype]!;
    expect(prototypes.reduce((sum, mesh) => sum + mesh.faceRanges.length / 2, 0)).toBe(part.faceRanges.length / 2);
    prototypes.forEach((mesh) => expect(mesh.uniformColor).toEqual(part.uniformColor));
    // Each piece measures as a part of its own.
    expect(model.measureEntity({ kind: EntityKind.Face, prototype: before, index: 0, matrix: identity }).part.volume).toBeCloseTo(20 * 60 * 80, 0);

    const other = model.scene.nodes.findIndex((node, i) => node.name === 'Gripper' && i !== gripper);
    const second = model.expand(other);
    expect(second.pieces).toEqual(pieces);
    expect(second.prototypes).toEqual([]);
  });

  it("refuses a part that isn't a compound, and an assembly", async () => {
    using model = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    expect(() => model.expand(0)).toThrow(OcctMeasureError);
    expect(() => model.expand(model.scene.nodes.findIndex((node) => node.name === 'Base'))).toThrow('That part has nothing to expand.');
  });
});

describe('exportTree (M15, D145, D188, D196)', () => {
  it.each(['assembly.step', 'plant.step', 'coloured-part.step', 'translucent.step'])(
    'writes %s back as the file has it, its assemblies new or reused whole',
    async (name) => {
      using model = await OcctModel.load(oc, fixture(name), ImportFormat.Step, name);
      using written = await again(model.exportTree(ExportFormat.Step, rebuilt(model.scene)));
      expect(parts(written.scene)).toEqual(parts(model.scene));
      using reused = await again(model.exportTree(ExportFormat.Step, [{ kind: PlanKind.Reuse, parent: -1, ref: 0, piece: FileOrigin, matrix: identity, name: model.scene.nodes[0]!.name }]));
      expect(parts(reused.scene)).toEqual(parts(model.scene));
      expect(reused.scene.prototypes).toHaveLength(model.scene.prototypes.length);
    },
  );

  it('keeps shared definitions shared when it reuses them (D188)', async () => {
    using model = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    const whole = model.exportTree(ExportFormat.Step, [{ kind: PlanKind.Reuse, parent: -1, ref: 0, piece: FileOrigin, matrix: identity, name: 'Plant' }]);
    const unique = model.exportTree(ExportFormat.Step, rebuilt(model.scene));
    // The plant's six robots are one definition placed six times, not six definitions.
    expect(new TextDecoder().decode(whole).match(/'Robot'/g)?.length).toBeLessThan(new TextDecoder().decode(unique).match(/'Robot'/g)!.length);
  });

  it('places a moved top-level part, with its faces in their colours', async () => {
    using model = await OcctModel.load(oc, fixture('coloured-part.step'), ImportFormat.Step, 'coloured-part.step');
    using written = await again(model.exportTree(ExportFormat.Step, [{ kind: PlanKind.Reuse, parent: -1, ref: 0, piece: FileOrigin, matrix: shift(100), name: 'Moved' }]));
    expect(written.scene.nodes).toHaveLength(1);
    expect(parts(written.scene)).toEqual(['Moved | 0.050,0.200,0.800,1.000 +faces | 100.00,0.00,0.00,140.00,30.00,20.00']);
  });

  it("writes an expanded part's pieces, rebuilt or reused, beside other occurrences in their colours", async () => {
    using model = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    const gripper = model.scene.nodes.findIndex((node) => node.name === 'Gripper');
    const { pieces } = model.expand(gripper);
    // The plant as it is, but the first Gripper as its assembly with the two pieces after everything.
    const plan = rebuilt(model.scene);
    plan[gripper] = { ...plan[gripper]!, kind: PlanKind.Assembly, piece: -1 };
    plan.push(...pieces.map((piece, k) => ({ kind: PlanKind.Reuse, parent: gripper, ref: gripper, piece: k, matrix: piece.matrix, name: `Gripper ${k + 1}` })));
    using written = await again(model.exportTree(ExportFormat.Step, plan));

    const expected = parts(model.scene).flatMap((line) => {
      if (!line.startsWith('Plant › Line 1 › Station 1 › Robot › Arm › Wrist › Gripper |')) {
        return [line];
      }
      return []; // replaced by its pieces, checked below
    });
    const result = parts(written.scene);
    expect(result.filter((line) => !/Wrist › Gripper › /.test(line))).toEqual(expected);
    expect(result.filter((line) => /Wrist › Gripper › Gripper \d \| 0.150,0.150,0.170/.test(line))).toHaveLength(2);

    // Reused whole, the expansion is written as Expand made it.
    const reusedPlan = rebuilt(model.scene);
    reusedPlan[gripper] = { ...reusedPlan[gripper]!, piece: -1 };
    using reused = await again(model.exportTree(ExportFormat.Step, reusedPlan));
    expect(parts(reused.scene).filter((line) => /Wrist › Gripper › /.test(line))).toHaveLength(2);
  });

  it('writes BREP as nested compounds of the parts placed (D196)', async () => {
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    using written = await again(model.exportTree(ExportFormat.Brep, rebuilt(model.scene)), ImportFormat.Brep);
    const faces = (scene: ImportedScene) => scene.instances.reduce((sum, { prototype }) => sum + scene.prototypes[prototype]!.faceRanges.length / 2, 0);
    expect(written.scene.nodes).toHaveLength(1);
    expect(faces(written.scene)).toBe(faces(model.scene));
  });

  it('reads the plan the viewer writes, names with tabs and line breaks flattened', () => {
    expect(planText([{ kind: PlanKind.Assembly, parent: -1, ref: 2, piece: FileOrigin, matrix: identity, name: 'A\tb\nc' }])).toBe(
      `1 -1 2 -2 ${identity.join(',')}\tA b c\n`,
    );
  });

  it.each([
    ['nothing', []],
    ['a parent after its child', [{ kind: PlanKind.Reuse, parent: 1, ref: 1, piece: FileOrigin, matrix: identity, name: 'x' }]],
    ['a node the model lacks', [{ kind: PlanKind.Reuse, parent: -1, ref: 99, piece: FileOrigin, matrix: identity, name: 'x' }]],
    ['a placed assembly at the top level', [{ kind: PlanKind.Assembly, parent: -1, ref: 0, piece: FileOrigin, matrix: shift(1), name: 'x' }]],
  ] satisfies [string, PlanNode[]][])('fails for a plan with %s', async (_, plan) => {
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    expect(() => model.exportTree(ExportFormat.Step, plan)).toThrow(OcctExportError);
    try {
      model.exportTree(ExportFormat.Step, plan);
    } catch (error) {
      expect((error as OcctExportError).status).toBe(plan.length === 0 ? ExportStatus.Empty : ExportStatus.Internal);
    }
    // The model still exports.
    expect(model.exportTree(ExportFormat.Step, rebuilt(model.scene)).length).toBeGreaterThan(0);
  });
});
