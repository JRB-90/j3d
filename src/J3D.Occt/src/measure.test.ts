// Measurement queries (M7, decisions D80, D102, D104) against the real OCCT build, with fixtures whose
// answers are known: box.brep is a 10 × 20 × 30 box; assembly.step has two 50 × 50 × 5 plates at
// z = 0 and z = 35 (one prototype, two placements) and a pin, a cylinder of radius 4 and height 40 at (25, 25).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import {
  EntityKind,
  ImportFormat,
  OcctMeasureError,
  OcctModel,
  type EntityMeasure,
  type EntityRef,
  type OcctModule,
  type PrototypeMesh,
} from './facade';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url)));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let oc: OcctModule;

beforeAll(async () => {
  oc = await init();
});

/** Every face (or edge, or vertex) of a placement, with its measurement. */
function entities(model: OcctModel, kind: EntityKind, prototype: number, matrix: readonly number[]) {
  const mesh = model.scene.prototypes[prototype]!;
  const count = kind === EntityKind.Face ? mesh.faceRanges.length / 2 : kind === EntityKind.Edge ? mesh.edgeRanges.length / 2 : mesh.vertices.length / 3;
  return Array.from({ length: count }, (_, index) => {
    const ref: EntityRef = { kind, prototype, index, matrix };
    return { ref, measure: model.measureEntity(ref) };
  });
}

function expectXyz(actual: readonly number[] | undefined, expected: readonly number[]) {
  expect(actual).toBeDefined();
  expected.forEach((value, i) => expect(actual![i]).toBeCloseTo(value, 6));
}

describe('topology in the mesh data', () => {
  it('numbers each face, edge and vertex and covers every triangle and segment exactly once', async () => {
    using model = await OcctModel.load(oc, fixture('curved-part.step'), ImportFormat.Step, 'curved-part.step');
    const [part] = model.scene.prototypes as [PrototypeMesh];

    expect(part.faceRanges.length / 2).toBe(35);
    const covered = new Uint8Array(part.indices.length);
    for (let i = 0; i < part.faceRanges.length; i += 2) {
      covered.fill(covered[part.faceRanges[i]!]! + 1, part.faceRanges[i]!, part.faceRanges[i]! + part.faceRanges[i + 1]!);
      expect(part.faceRanges[i + 1]! % 3).toBe(0);
    }
    expect(covered.every((count) => count === 1)).toBe(true);

    const points = new Uint8Array(part.edges.length / 3);
    for (let i = 0; i < part.edgeRanges.length; i += 2) {
      points.fill(1, part.edgeRanges[i]!, part.edgeRanges[i]! + part.edgeRanges[i + 1]!);
      expect(part.edgeRanges[i + 1]! % 2).toBe(0);
    }
    expect(points.every((point) => point === 1)).toBe(true);
    expect(part.vertices.length % 3).toBe(0);
    expect(part.vertices.length).toBeGreaterThan(0);
  });
});

describe('measureEntity', () => {
  it('reports a box face, edge and vertex, with the whole part', async () => {
    using model = await OcctModel.load(oc, fixture('box.brep'), ImportFormat.Brep, 'box.brep');
    const faces = entities(model, EntityKind.Face, 0, identity);
    const edges = entities(model, EntityKind.Edge, 0, identity);
    const vertices = entities(model, EntityKind.Vertex, 0, identity);

    expect(faces).toHaveLength(6);
    expect(edges).toHaveLength(12);
    expect(vertices).toHaveLength(8);
    expect(faces.map(({ measure }) => (measure as { area: number }).area).sort((a, b) => a - b)).toEqual([200, 200, 300, 300, 600, 600].map((a) => expect.closeTo(a, 6)));
    expect(faces.every(({ measure }) => measure.kind === 'face' && measure.surface === 'plane')).toBe(true);
    expect(edges.map(({ measure }) => (measure as { length: number }).length).sort((a, b) => a - b)).toEqual(
      [10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30].map((l) => expect.closeTo(l, 6)),
    );

    const top = faces.find(({ measure }) => measure.anchor[2] > 29)!.measure as Extract<EntityMeasure, { kind: 'face' }>;
    expectXyz(top.normal, [0, 0, 1]);
    expectXyz(top.anchor, [5, 10, 30]);
    expect(top.part.volume).toBeCloseTo(6000, 6);
    expect(top.part.area).toBeCloseTo(2200, 6);
    expectXyz(top.part.centroid, [5, 10, 15]);
    expectXyz(top.part.min, [0, 0, 0]);
    expectXyz(top.part.max, [10, 20, 30]);

    const corner = vertices.find(({ measure }) => measure.anchor.every((value) => value === 0));
    expect(corner?.measure.kind).toBe('vertex');
  });

  it('places the results with the placement matrix', async () => {
    using model = await OcctModel.load(oc, fixture('box.brep'), ImportFormat.Brep, 'box.brep');
    const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1];
    const [face] = entities(model, EntityKind.Face, 0, moved);

    expect(face!.measure.anchor[0]).toBeGreaterThanOrEqual(100);
    expectXyz(face!.measure.part.min, [100, 0, 0]);
  });

  it('reports a cylinder face and circular edges of the pin', async () => {
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const pin = model.scene.instances.find((instance) => model.scene.nodes[instance.node]!.name === 'Pin')!;
    const faces = entities(model, EntityKind.Face, pin.prototype, pin.matrix);
    const edges = entities(model, EntityKind.Edge, pin.prototype, pin.matrix);

    const side = faces.find(({ measure }) => measure.kind === 'face' && measure.surface === 'cylinder')!.measure as Extract<EntityMeasure, { kind: 'face' }>;
    expect(side.radius).toBeCloseTo(4, 6);
    expectXyz(side.axis, [0, 0, 1]);
    expect(side.area).toBeCloseTo(2 * Math.PI * 4 * 40, 3);
    expect(side.part.volume).toBeCloseTo(Math.PI * 16 * 40, 3);

    const circles = edges.map(({ measure }) => measure).filter((measure) => measure.kind === 'edge' && measure.curve === 'circle');
    expect(circles).toHaveLength(2);
    for (const circle of circles as Extract<EntityMeasure, { kind: 'edge' }>[]) {
      expect(circle.radius).toBeCloseTo(4, 6);
      expect(circle.length).toBeCloseTo(8 * Math.PI, 4);
      expect(circle.centre![0]).toBeCloseTo(25, 6);
    }
  });

  it('reports a bad reference as an error rather than crashing', async () => {
    using model = await OcctModel.load(oc, fixture('box.brep'), ImportFormat.Brep, 'box.brep');
    expect(() => model.measureEntity({ kind: EntityKind.Face, prototype: 0, index: 99, matrix: identity })).toThrow(OcctMeasureError);
    expect(() => model.measureEntity({ kind: EntityKind.Face, prototype: 5, index: 0, matrix: identity })).toThrow(/No such part/);
  });
});

describe('measurePair', () => {
  it('measures distance and angle between box faces', async () => {
    using model = await OcctModel.load(oc, fixture('box.brep'), ImportFormat.Brep, 'box.brep');
    const faces = entities(model, EntityKind.Face, 0, identity);
    const top = faces.find(({ measure }) => measure.anchor[2] > 29)!.ref;
    const bottom = faces.find(({ measure }) => measure.anchor[2] < 1)!.ref;
    const side = faces.find(({ measure }) => measure.anchor[0] < 1)!.ref;

    const opposite = model.measurePair(top, bottom);
    expect(opposite.distance).toBeCloseTo(30, 6);
    expect(opposite.angleOf).toBe('planes');
    expect(opposite.angle).toBeCloseTo(0, 6);
    expect(opposite.pointA![2]).toBeCloseTo(30, 6);
    expect(opposite.pointB![2]).toBeCloseTo(0, 6);

    const adjacent = model.measurePair(top, side);
    expect(adjacent.distance).toBeCloseTo(0, 6);
    expect(adjacent.angle).toBeCloseTo(90, 6);
  });

  it('measures between two placements of one prototype, and circle centres', async () => {
    using model = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const { instances, nodes } = model.scene;
    const byName = (name: string) => instances.find((instance) => nodes[instance.node]!.name === name)!;
    const bottom = byName('Plate (bottom)');
    const top = byName('Plate (top)');
    const pin = byName('Pin');

    const upper = entities(model, EntityKind.Face, bottom.prototype, bottom.matrix).find(({ measure }) => measure.anchor[2] > 4.9 && measure.anchor[2] < 5.1)!.ref;
    const lower = entities(model, EntityKind.Face, top.prototype, top.matrix).find(({ measure }) => measure.anchor[2] > 34.9 && measure.anchor[2] < 35.1)!.ref;
    const plates = model.measurePair(upper, lower);
    expect(plates.distance).toBeCloseTo(30, 6);
    expect(plates.angle).toBeCloseTo(0, 6);

    const [rimA, rimB] = entities(model, EntityKind.Edge, pin.prototype, pin.matrix)
      .filter(({ measure }) => measure.kind === 'edge' && measure.curve === 'circle')
      .map(({ ref }) => ref) as [EntityRef, EntityRef];
    const rims = model.measurePair(rimA, rimB);
    expect(rims.centreDistance).toBeCloseTo(40, 6);
    expect(rims.distance).toBeCloseTo(40, 6);
  });

  it('measures against an entity exported from another model (D102)', async () => {
    using box = await OcctModel.load(oc, fixture('box.brep'), ImportFormat.Brep, 'box.brep');
    using assembly = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step');
    const boxTop = entities(box, EntityKind.Face, 0, identity).find(({ measure }) => measure.anchor[2] > 29)!.ref;
    const plate = assembly.scene.instances[0]!;
    const plateTop = entities(assembly, EntityKind.Face, plate.prototype, plate.matrix).find(({ measure }) => {
      const z = measure.anchor[2];
      return z > 4.9 && z < 5.1;
    })!.ref;

    // The plate's top face (z = 5), sent into the box's model and measured against the box's top (z = 30).
    const shape = assembly.exportEntity(plateTop);
    expect(shape).toContain('CASCADE Topology');
    const result = box.measurePair(boxTop, { ...plateTop, prototype: -1, index: -1 }, shape);
    expect(result.distance).toBeCloseTo(25, 6);
    expect(result.angle).toBeCloseTo(0, 6);
  });
});
