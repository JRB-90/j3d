// Export (M9, decisions D83, D125, D126) against the real OCCT build: each model is written as STEP or
// BREP, imported again, and compared with the original (structure, names, colours, counts, bounds).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import {
  EntityKind,
  ExportFormat,
  ExportPhase,
  ExportStatus,
  ImportFormat,
  OcctExportError,
  OcctModel,
  type ImportedScene,
  type OcctModule,
} from './facade.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url)));

let oc: OcctModule;

beforeAll(async () => {
  oc = await init();
});

/** World bounds of every placement: [minX, minY, minZ, maxX, maxY, maxZ]. */
function bounds(scene: ImportedScene): number[] {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const { prototype, matrix: m } of scene.instances) {
    const { positions } = scene.prototypes[prototype]!;
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
      const world = [0, 1, 2].map((r) => m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!);
      world.forEach((value, axis) => {
        box[axis] = Math.min(box[axis]!, value);
        box[axis + 3] = Math.max(box[axis + 3]!, value);
      });
    }
  }
  return box;
}

/** BREP faces over every placement. */
function faceCount(scene: ImportedScene): number {
  return scene.instances.reduce((sum, { prototype }) => sum + scene.prototypes[prototype]!.faceRanges.length / 2, 0);
}

/** Exports `name` and imports the result again. */
async function roundTrip(name: string, format: ImportFormat, to: ExportFormat) {
  using original = await OcctModel.load(oc, fixture(name), format, name);
  const bytes = original.exportFile(to);
  const exportedName = name.replace(/\.\w+$/, to === ExportFormat.Step ? '.step' : '.brep');
  const again = await OcctModel.load(oc, bytes, to === ExportFormat.Step ? ImportFormat.Step : ImportFormat.Brep, exportedName);
  return { before: original.scene, after: again, bytes };
}

function expectSameBounds(after: ImportedScene, before: ImportedScene) {
  bounds(after).forEach((value, i) => expect(value).toBeCloseTo(bounds(before)[i]!, 4));
}

describe('STEP export', () => {
  it('keeps the assembly, its names, placements and shared prototypes', async () => {
    const { before, after: model, bytes } = await roundTrip('assembly.step', ImportFormat.Step, ExportFormat.Step);
    using _ = model;
    const after = model.scene;

    expect(new TextDecoder().decode(bytes.subarray(0, 13))).toBe('ISO-10303-21;');
    expect(new TextDecoder().decode(bytes)).toContain('AUTOMOTIVE_DESIGN'); // AP214 (D126)
    expect(after.nodes.map((node) => node.name)).toEqual(before.nodes.map((node) => node.name));
    expect(after.nodes.map((node) => node.parent)).toEqual(before.nodes.map((node) => node.parent));
    expect(after.instances).toHaveLength(3);
    expect(after.prototypes).toHaveLength(2);
    after.instances.forEach((instance, i) => {
      instance.matrix.forEach((value, j) => expect(value).toBeCloseTo(before.instances[i]!.matrix[j]!, 6));
    });
    expect(faceCount(after)).toBe(faceCount(before));
    expectSameBounds(after, before);
  });

  it('keeps part and face colours', async () => {
    const { before, after: model } = await roundTrip('coloured-part.step', ImportFormat.Step, ExportFormat.Step);
    using _ = model;
    const [part] = model.scene.prototypes;
    const [original] = before.prototypes;

    expect(model.scene.nodes.map((node) => node.name)).toContain('Coloured block');
    expect(part!.colors).toBeDefined();
    expect(part!.positions.length).toBe(original!.positions.length);
    part!.colors!.forEach((value, i) => expect(value).toBeCloseTo(original!.colors![i]!, 3));
    expectSameBounds(model.scene, before);
  });

  it('keeps translucency', async () => {
    const { before, after: model } = await roundTrip('translucent.step', ImportFormat.Step, ExportFormat.Step);
    using _ = model;
    const alphas = (scene: ImportedScene) => scene.prototypes.map((p) => p.uniformColor[3]).sort();

    expect(alphas(model.scene)).toEqual(alphas(before).map((alpha) => expect.closeTo(alpha, 2)));
  });

  it('writes an IGES model as STEP', async () => {
    const { before, after: model } = await roundTrip('surfaces.iges', ImportFormat.Iges, ExportFormat.Step);
    using _ = model;

    expect(model.scene.prototypes.length).toBeGreaterThan(0);
    expect(faceCount(model.scene)).toBe(faceCount(before));
    expectSameBounds(model.scene, before);
  });

  it('reports transferring with progress, then writing', async () => {
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const reports: [number, number][] = [];
    model.exportFile(ExportFormat.Step, { onProgress: (phase, fraction) => reports.push([phase, fraction]) });

    expect([...new Set(reports.map(([phase]) => phase))]).toEqual([ExportPhase.Transferring, ExportPhase.Writing]);
    expect(reports.at(-1)).toEqual([ExportPhase.Writing, 1]);
  });
});

describe('BREP export', () => {
  it('writes a single part as it was imported', async () => {
    const { before, after: model, bytes } = await roundTrip('box.brep', ImportFormat.Brep, ExportFormat.Brep);
    using _ = model;

    expect(new TextDecoder().decode(bytes)).toContain('CASCADE Topology');
    expect(new TextDecoder().decode(bytes)).not.toMatch(/Triangulations [1-9]/); // no J3D mesh in the file
    expect(model.scene.prototypes).toHaveLength(1);
    expect(model.scene.prototypes[0]!.indices.length).toBe(before.prototypes[0]!.indices.length);
    expectSameBounds(model.scene, before);
  });

  it('writes an assembly as one compound of its placed parts', async () => {
    const { before, after: model } = await roundTrip('assembly.step', ImportFormat.Step, ExportFormat.Brep);
    using _ = model;

    expect(model.scene.instances).toHaveLength(1); // BREP has no assembly, names or colours
    expect(faceCount(model.scene)).toBe(faceCount(before));
    expectSameBounds(model.scene, before);
  });
});

describe('cancelling an export (D125)', () => {
  it('stops when asked, leaving the model usable', async () => {
    using model = await OcctModel.load(oc, fixture('curved-part.step'), ImportFormat.Step, 'curved-part.step');
    let polls = 0;
    const cancelLater = () => ++polls > 5;

    for (const format of [ExportFormat.Step, ExportFormat.Brep]) {
      polls = 0;
      let error: unknown;
      try {
        model.exportFile(format, { isCancelled: cancelLater });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(OcctExportError);
      expect(error).toMatchObject({ status: ExportStatus.Cancelled });
    }

    const face = model.measureEntity({ kind: EntityKind.Face, prototype: 0, index: 0, matrix: model.scene.instances[0]!.matrix });
    expect(face.kind).toBe('face');
    expect(model.exportFile(ExportFormat.Step, { isCancelled: () => false }).length).toBeGreaterThan(0);
  });

  it('fails a disposed model cleanly', async () => {
    const model = await OcctModel.load(oc, fixture('box.brep'), ImportFormat.Brep, 'box.brep');
    model.dispose();
    expect(() => model.exportFile(ExportFormat.Brep)).toThrow(OcctExportError);
  });
});
