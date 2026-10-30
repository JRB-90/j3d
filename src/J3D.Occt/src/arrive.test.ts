// Arrivals (M18, decisions D225, D229, D230) against the real OCCT build: objects written as STEP by one
// model are read into another, where they're measured, expanded and exported like the file's own.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import { EntityKind, ExportFormat, FileOrigin, ImportFormat, OcctMeasureError, OcctModel, PlanKind, type OcctModule, type PlanNode } from './facade.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url)));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shift = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

let oc: OcctModule;

beforeAll(async () => {
  oc = await init();
});

/** One node of a model, written as an arrival is: under an assembly of J3D's, at `matrix`. */
function transferPlan(ref: number, name: string, matrix: number[]): PlanNode[] {
  return [
    { kind: PlanKind.Assembly, parent: -1, ref: -1, piece: FileOrigin, matrix: identity, name: '' },
    { kind: PlanKind.Reuse, parent: 0, ref, piece: FileOrigin, matrix, name },
  ];
}

/** The plant's first Gripper (a compound part of two solids, D190) as STEP. */
async function gripper(): Promise<{ bytes: Uint8Array; colour: number[] }> {
  using plant = await OcctModel.load(oc, fixture('plant.step'), ImportFormat.Step, 'plant.step');
  const node = plant.scene.nodes.findIndex(({ name, pieces }) => name === 'Gripper' && pieces === 2);
  const instance = plant.scene.instances.find((candidate) => candidate.node === node)!;
  const bytes = plant.exportTree(ExportFormat.Step, transferPlan(node, 'Gripper', shift(100)));
  return { bytes, colour: [...plant.scene.prototypes[instance.prototype]!.uniformColor] };
}

describe('arrive (M18, D225)', () => {
  it('reads another model’s objects in, numbered after the file’s nodes, with prototypes of their own', async () => {
    const { bytes, colour } = await gripper();
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const fileCount = model.scene.nodes.length;
    const prototypeCount = model.scene.prototypes.length;

    const { arrival, prototypes } = await model.arrive(bytes, fileCount);

    expect(arrival.base).toBe(fileCount);
    // Node 0 is J3D's own assembly, which never joins the tree (STEP names it after the writer).
    expect(arrival.nodes.map(({ parent, prototype }) => [parent, prototype >= 0])).toEqual([
      [-1, false],
      [0, true],
    ]);
    expect(arrival.nodes[1]!.name).toBe('Gripper');
    expect(arrival.nodes[1]!.matrix).toEqual(shift(100));
    expect(arrival.nodes[1]!.pieces).toBe(2);
    expect(prototypes.length).toBeGreaterThan(0);
    expect(model.scene.prototypes).toHaveLength(prototypeCount + prototypes.length);
    const prototype = arrival.nodes[1]!.prototype;
    expect([...model.scene.prototypes[prototype]!.uniformColor]).toEqual(colour);

    // Measured, expanded and exported like the file's own.
    const measured = model.measureEntity({ kind: EntityKind.Face, prototype, index: 0, matrix: identity });
    expect(measured.kind).toBe('face');
    expect(model.expand(fileCount + 1).pieces).toHaveLength(2);
    const plan: PlanNode[] = [{ kind: PlanKind.Reuse, parent: -1, ref: fileCount + 1, piece: FileOrigin, matrix: shift(100), name: 'Gripper' }];
    using written = await OcctModel.load(oc, model.exportTree(ExportFormat.Step, plan), ImportFormat.Step, 'written.step');
    expect(written.scene.nodes.map(({ name }) => name)).toEqual(['Gripper']);
    expect([...written.scene.prototypes[0]!.uniformColor]).toEqual(colour);
  });

  it('replaces an arrival at the same base, and refuses one that would overwrite the file’s nodes', async () => {
    const { bytes } = await gripper();
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const fileCount = model.scene.nodes.length;

    await model.arrive(bytes, fileCount);
    const second = await model.arrive(bytes, fileCount + 2); // after the first
    expect(second.arrival.base).toBe(fileCount + 2);
    const again = await model.arrive(bytes, fileCount); // the first replaced, the second dropped
    expect(again.arrival.base).toBe(fileCount);
    await expect(model.arrive(bytes, fileCount + 3)).rejects.toThrow(OcctMeasureError); // past the end now
    await expect(model.arrive(bytes, fileCount - 1)).rejects.toThrow(OcctMeasureError);
    await expect(model.arrive(new TextEncoder().encode('not a step file'), fileCount)).rejects.toThrow(OcctMeasureError);
  });
});
