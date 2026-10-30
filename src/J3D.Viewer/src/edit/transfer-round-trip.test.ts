// @vitest-environment node
// M18 (D225, D228, D229, R24, R28): objects of one BREP model written from the viewer's transfer plan,
// read into another as an arrival, drawn there where they were, and written into its STEP.

import { readFileSync } from 'node:fs';
import { ExportFormat, ImportFormat, OcctModel, type Arrival, type ImportedScene, type OcctModule } from '@j3d/occt/facade';
import init from '@j3d/occt/single';
import { Matrix4 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBrepObject } from '../view/brep-object.js';
import { MaterialCache } from '../view/materials.js';
import { exportPlan, transferPlan } from './export-plan.js';
import { ModelStructure, TopLevel, type Arrivals, type ModelEdits } from './structure.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url)));

let oc: OcctModule;

beforeAll(async () => {
  oc = (await init()) as unknown as OcctModule;
});

/** Each drawn part as "name | colour | world bounds", sorted. */
function parts(scene: Pick<ImportedScene, 'instances' | 'prototypes'>, name: (node: number) => string): string[] {
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
      return `${name(node)} | ${colour} | ${box.map((value) => (Math.abs(value) < 5e-4 ? 0 : value).toFixed(3)).join(',')}`;
    })
    .sort();
}

/** The edits .NET makes of an arrival (TreeEdit.Arrive): its nodes added, the objects at the model's top level after its own. */
function arrivalEdits(fileTree: readonly { parent: number }[], arrival: Arrival, file: string): ModelEdits {
  const fileCount = fileTree.length;
  const nodes = arrival.nodes.slice(1);
  const id = (index: number) => fileCount + index - 1;
  const top = [...fileTree.flatMap((node, index) => (node.parent < 0 ? [index] : [])), ...nodes.flatMap((node, i) => (node.parent === 0 ? [id(i + 1)] : []))];
  const children = nodes.flatMap((node, i) =>
    node.prototype >= 0 ? [] : [{ parent: id(i + 1), nodes: nodes.flatMap((child, j) => (child.parent === i + 1 ? [id(j + 1)] : [])) }],
  );
  return {
    added: nodes.map(() => -1),
    children: [{ parent: TopLevel, nodes: top }, ...children],
    names: [],
    arrivals: [{ file, nodes: arrival.nodes.length }],
    arrived: nodes.map((node, i) => ({ node: id(i + 1), arrival: 0, index: i + 1, name: node.name, part: node.prototype >= 0 })),
  };
}

describe('objects moving between BREP models (M18)', () => {
  it('arrive where they were, hidden parts and all, and are written into the target’s STEP', async () => {
    using plant = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
    using bracket = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const source = buildBrepObject('plant.step', plant.scene, new MaterialCache()).parts;
    const target = buildBrepObject('assembly.step', bracket.scene, new MaterialCache()).parts;
    // The target model moved: what arrives must still land where it was in the world (D228).
    target.setPlacement(-1, new Matrix4().makeTranslation(500, 0, 0));
    const robot = plant.scene.nodes.findIndex(({ name }) => name === 'Robot');
    const hidden = plant.scene.nodes.findIndex((node, index) => node.prototype >= 0 && sourceWithin(plant.scene, index, robot));

    const { local, parentWorld } = source.placement(robot);
    const matrix = target.topWorld().invert().multiply(parentWorld.multiply(local)).toArray();
    const { plan, order } = transferPlan(source.planSource(new Map(), new Set([hidden])), [{ node: robot, matrix }]);
    const { arrival } = await bracket.arrive(plant.exportTree(ExportFormat.Step, plan), bracket.scene.nodes.length);
    expect(arrival.nodes).toHaveLength(order.length + 1);
    expect(order).toContain(hidden); // hidden parts go too (D229)

    const arrivals: Arrivals = new Map([['robot.step', { nodes: arrival.nodes }]]);
    const edits = arrivalEdits(bracket.scene.nodes, arrival, 'robot.step');
    const structure = new ModelStructure(bracket.scene.nodes, edits, new Map(), arrivals);
    target.setStructure(structure);

    // Drawn in the target where they were in the plant, with their colours.
    const fileCount = bracket.scene.nodes.length;
    const robotParts = (scene: ImportedScene, names: (node: number) => string, keep: (node: number) => boolean) =>
      parts({ ...scene, instances: scene.instances.filter(({ node }) => keep(node)) }, names);
    const before = robotParts(source.exportScene(), (node) => plant.scene.nodes[node]!.name, (node) => sourceWithin(plant.scene, node, robot));
    const after = robotParts(target.exportScene(), (node) => structure.nodes[node]!.name, (node) => node >= fileCount);
    expectSameParts(after, before);

    // And written into the target's STEP, which names them by the facade's numbers after the file's.
    const written = await OcctModel.load(oc, bracket.exportTree(ExportFormat.Step, exportPlan(target.planSource(new Map(), new Set()))), ImportFormat.Step, 'again');
    const again = robotParts(written.scene, (node) => written.scene.nodes[node]!.name, (node) => sourceWithin(written.scene, node, written.scene.nodes.findIndex(({ name }) => name === 'Robot')));
    expectSameParts(again, before);
    written.dispose();
  });
});

/** Whether a node is `ancestor` or lies under it in an imported scene. */
function sourceWithin(scene: Pick<ImportedScene, 'nodes'>, node: number, ancestor: number): boolean {
  for (let current = node; current >= 0; current = scene.nodes[current]!.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

/**
 * The same parts, names and colours exactly and bounds within a millimetre: what arrives is meshed at the
 * target model's deflection, so a curved part's tessellation (and its bounds) differ slightly.
 */
function expectSameParts(actual: string[], expected: string[]): void {
  const split = (part: string) => {
    const [name = '', colour = '', bounds = ''] = part.split(' | ');
    return { name, colour, bounds: bounds.split(',').map(Number) };
  };
  expect(actual.map((part) => split(part).name + split(part).colour)).toEqual(expected.map((part) => split(part).name + split(part).colour));
  actual.forEach((part, index) => {
    split(part).bounds.forEach((value, axis) => expect(Math.abs(value - split(expected[index]!).bounds[axis]!)).toBeLessThan(1));
  });
}
