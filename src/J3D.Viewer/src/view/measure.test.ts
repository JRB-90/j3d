import type { EntityMeasure, EntityRef, PairMeasure } from '@j3d/occt/facade';
import { Box3, Group, Vector3, type Intersection } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BrepMeasurer } from '../import/types';
import { totals, FeatureSelection, type FeatureSelectionInfo } from './features';
import { MeasureTool, primaryValue, type MeasureHost, type MeasureModel } from './measure';
import { angle, area, entityRows, length, pairLabel, pairRows, partRows, point, size } from './measure-format';
import { HighlightMaterials, type ModelParts, type PickedEntity } from './parts';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const face = (index: number, x = 0): PickedEntity => ({
  kind: 'face',
  node: 1,
  ref: { kind: 0, prototype: 0, index, matrix: identity },
  point: [x, 0, 0],
});
const meshPoint = (x: number): PickedEntity => ({ kind: 'point', node: 2, point: [x, 0, 0] });
const edge = (index: number): PickedEntity => ({ kind: 'edge', node: 1, ref: { kind: 1, prototype: 0, index, matrix: identity }, point: [0, 0, 0] });

const boxFace: EntityMeasure = {
  kind: 'face',
  area: 200,
  surface: 'plane',
  normal: [0, 0, 1],
  anchor: [5, 10, 30],
  part: { volume: 6000, area: 2200, centroid: [5, 10, 15], min: [0, 0, 0], max: [10, 20, 30] },
};

describe('formatting (assumption 13)', () => {
  it('formats lengths, areas, angles and points', () => {
    expect(length(12.3456)).toBe('12.346 mm');
    expect(length(1, true)).toBe('≈ 1.000 mm');
    expect(area(200)).toBe('200.000 mm²');
    expect(angle(45)).toBe('45.00°');
    expect(point([1, 2.5, -3])).toBe('(1.000, 2.500, -3.000)');
    expect(point([-0.0000001, 0, -0])).toBe('(0.000, 0.000, 0.000)');
    expect(size([0, 0, 0], [10, 20, 30])).toBe('10.000 × 20.000 × 30.000 mm');
  });

  it('lists a face, its part, and a pair', () => {
    expect(entityRows(boxFace)).toEqual([
      { name: 'Area', value: '200.000 mm²' },
      { name: 'Normal', value: '(0.000, 0.000, 1.000)' },
    ]);
    expect(partRows('Box', boxFace.part).map((row) => row.name)).toEqual(['Volume', 'Area', 'Size', 'Bounds']);
    expect(partRows('Box', boxFace.part).every((row) => row.group === 'Box')).toBe(true);
    const pair: PairMeasure = { kind: 'pair', distance: 30, pointA: [0, 0, 30], pointB: [0, 0, 0], angleOf: 'planes', angle: 0 };
    expect(pairLabel(pair)).toBe('30.000 mm');
    expect(pairRows(pair).map((row) => row.name)).toEqual(['Distance', 'Angle (planes)', 'Δx, Δy, Δz', 'From', 'To']);
    expect(pairLabel({ kind: 'pair', angle: 90 })).toBe('90.00°');
  });

  it('labels a single pick with its headline value: Ø for circles and cylinders (D147)', () => {
    const part = boxFace.part;
    expect(primaryValue(boxFace)).toBe('200.000 mm²');
    expect(primaryValue({ kind: 'face', area: 1, surface: 'cylinder', radius: 2, anchor: [0, 0, 0], part })).toBe('Ø 4.000 mm');
    expect(primaryValue({ kind: 'edge', length: 12.566, curve: 'circle', radius: 2, anchor: [0, 0, 0], part })).toBe('Ø 4.000 mm');
    expect(primaryValue({ kind: 'edge', length: 30, curve: 'line', anchor: [0, 0, 0], part })).toBe('30.000 mm');
    expect(primaryValue({ kind: 'vertex', point: [1, 2, 3], anchor: [1, 2, 3], part })).toBe('(1.000, 2.000, 3.000)');
  });

  it('totals edges and faces only when there are two or more of them (D163)', () => {
    const part = boxFace.part;
    const line = (value: number): EntityMeasure => ({ kind: 'edge', length: value, curve: 'line', anchor: [0, 0, 0], part });
    expect(totals([line(10)])).toEqual([]);
    expect(totals([line(10), line(2.5), boxFace, boxFace, undefined])).toEqual([
      { name: 'Total length (2 edges)', value: '12.500 mm' },
      { name: 'Total area (2 faces)', value: '400.000 mm²' },
    ]);
  });
});

/** A fake viewer with two BREP models, "a" and "b", and a mesh model "m"; each click picks the next of `picks`. */
function fakeHost(picks: (PickedEntity & { model?: string })[], options: { unitScale?: number; answer?: EntityMeasure } = {}) {
  const queue = [...picks];
  const parts = (): ModelParts =>
    ({
      partNodes: [1],
      nodeOf: () => 1,
      setHidden: () => {},
      addVisibleBounds: (box: Box3) => box,
      nodeBounds: () => new Box3(new Vector3(0, 0, 0), new Vector3(1, 2, 3)),
      highlight: () => undefined,
      entityAt: () => {
        const next = queue.shift();
        return next && { ...next, model: undefined };
      },
      entityHighlight: () => ({ object: new Group(), dispose: () => {} }),
    }) as unknown as ModelParts;
  const measurer = (name: string): BrepMeasurer & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      entity: vi.fn(async () => {
        calls.push('entity');
        return options.answer ?? boxFace;
      }),
      pair: vi.fn(async (_a: EntityRef, _b: EntityRef, shapeB?: string) => {
        calls.push(shapeB ? `pair with ${shapeB}` : 'pair');
        return { kind: 'pair', distance: 30, pointA: [0, 0, 30], pointB: [0, 0, 0], angleOf: 'planes', angle: 0 } satisfies PairMeasure;
      }),
      exportEntity: vi.fn(async () => {
        calls.push('export');
        return `shape of ${name}`;
      }),
    };
  };
  const workers = { a: measurer('a'), b: measurer('b') };
  const models: Record<string, MeasureModel> = {
    a: { parts: parts(), measure: workers.a, nameOf: () => 'Box', unitScale: 1 },
    b: { parts: parts(), measure: workers.b, nameOf: () => 'Plate', unitScale: 1 },
    m: { parts: parts(), nameOf: () => 'Post', unitScale: options.unitScale ?? 1 },
  };
  const labels = fakeElement() as unknown as HTMLElement;
  const overlays = new Group();
  const host: MeasureHost = {
    hitAt: () => {
      const id = queue[0]?.model ?? 'a';
      return { id, hit: { point: new Vector3() } as Intersection };
    },
    screenAt: (x, y) => ({ x, y, hitDepth: 0, project: () => ({ x: 0, y: 0, depth: 0 }) }),
    model: (id) => models[id],
    toClient: () => ({ x: 10, y: 20, visible: true }),
    overlays,
    highlights: new HighlightMaterials(),
    labels,
    requestRender: () => {},
  };
  return { host, workers, labels, overlays };
}

function setup(picks: (PickedEntity & { model?: string })[], options: { unitScale?: number; answer?: EntityMeasure } = {}) {
  const fake = fakeHost(picks, options);
  const references: (string | null)[] = [];
  const results: (string | null)[] = [];
  const tool = new MeasureTool(fake.host, {
    onReference: (info) => references.push(info?.title ?? null),
    onResult: (info) => results.push(info?.label ?? null),
  });
  tool.setActive(true);
  return { ...fake, tool, references, results };
}

/** Lets the fake workers' answers arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Just enough of an element for the tool's labels, since these tests run without a DOM. */
interface FakeElement {
  className: string;
  textContent: string;
  hidden: boolean;
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: FakeElement[];
}

function fakeElement(): FakeElement {
  const element: FakeElement & Record<string, unknown> = {
    className: '',
    textContent: '',
    hidden: false,
    dataset: {},
    style: {},
    children: [] as FakeElement[],
    append: (child: FakeElement) => element.children.push(child),
    remove: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    ownerDocument: {
      createElement: () => {
        const child = fakeElement() as FakeElement & Record<string, unknown>;
        child['remove'] = () => element.children.splice(element.children.indexOf(child), 1);
        return child;
      },
    },
  };
  return element;
}

describe('MeasureTool (D147)', () => {
  it("draws the reference's value, then measures it against each click, one result at a time", async () => {
    const { tool, workers, references, results, labels } = setup([face(0), face(1), face(2)]);

    await tool.click(0, 0);
    expect(references).toEqual(['Face (plane) of Box']);
    expect(tool.referenceEntity?.entity.kind).toBe('face');
    expect(tool.labels()).toEqual([{ role: 'reference', label: '200.000 mm²' }]);

    await tool.click(0, 0);
    expect(workers.a.calls).toEqual(['entity', 'pair']);
    expect(results).toEqual(['30.000 mm · 0.00°']);

    await tool.click(0, 0);
    // The second result replaces the first; the reference stays.
    expect(results).toEqual(['30.000 mm · 0.00°', '30.000 mm · 0.00°']);
    expect(tool.labels().map((label) => label.role)).toEqual(['reference', 'result']);
    const children = (labels as unknown as FakeElement).children;
    expect(children.map((label) => [label.dataset['testid'], label.dataset['role'], label.textContent])).toEqual([
      ['measure-label', 'reference', '200.000 mm²'],
      ['measure-label', 'result', '30.000 mm · 0.00°'],
    ]);

    tool.updateLabels();
    expect(children[1]?.style.transform).toContain('translate(10.0px, 20.0px)');
  });

  it('draws a circle as its diameter (D147)', async () => {
    const circle: EntityMeasure = {
      kind: 'edge',
      length: 12.566,
      curve: 'circle',
      radius: 2,
      centre: [10, 0, 0],
      normal: [0, 0, 1],
      anchor: [12, 0, 0],
      part: boxFace.part,
    };
    const { tool, overlays } = setup([edge(3)], { answer: circle });

    await tool.click(0, 0);
    expect(tool.labels()).toEqual([{ role: 'reference', label: 'Ø 4.000 mm' }]);
    const across = overlays.getObjectByName('measure reference')!.children[0] as unknown as {
      geometry: { getAttribute(name: string): { array: Float32Array } };
    };
    expect([...across.geometry.getAttribute('position').array]).toEqual([8, 0, 0, 12, 0, 0]);
  });

  it("measures across models by sending B's shape into A's worker (D102)", async () => {
    const { tool, workers } = setup([{ ...face(0), model: 'a' }, { ...face(2), model: 'b' }]);

    await tool.click(0, 0);
    await tool.click(0, 0);

    expect(workers.b.calls).toEqual(['export']);
    expect(workers.a.calls).toEqual(['entity', 'pair with shape of b']);
  });

  it('measures mesh points approximately, in millimetres for glTF (D81, D105)', async () => {
    const { tool, references, results } = setup([{ ...meshPoint(0), model: 'm' }, { ...meshPoint(0.5), model: 'm' }], { unitScale: 1000 });

    await tool.click(0, 0);
    expect(references).toEqual(['Point on Post']);
    await tool.click(0, 0);
    expect(results).toEqual(['≈ 500.000 mm']);
  });

  it('starts from a given reference, and clears everything when turned off (Esc)', async () => {
    const { host } = fakeHost([face(1)]);
    const seen: (string | null)[] = [];
    const tool = new MeasureTool(host, {
      onReference: (info) => seen.push(info?.title ?? null),
      onResult: (info) => seen.push(info?.label ?? null),
    });

    tool.setActive(true, { id: 'a', entity: face(0) });
    await settle();
    expect(tool.referenceEntity?.entity).toEqual(face(0));
    await tool.click(0, 0);
    expect(tool.labels()).toHaveLength(2);

    tool.setActive(false);
    expect(tool.referenceEntity).toBeUndefined();
    expect(tool.labels()).toEqual([]);
    expect(seen).toEqual(['Face (plane) of Box', '30.000 mm · 0.00°', null, null]);
  });

  it("drops what's on a part that's hidden or a model that's removed (D98)", async () => {
    const { tool } = setup([face(0), { ...face(1), model: 'b' }]);
    await tool.click(0, 0);
    await tool.click(0, 0);

    tool.dropHidden('b', new Set([1]));
    expect(tool.labels().map((label) => label.role)).toEqual(['reference']);
    tool.removeModel('a');
    expect(tool.referenceEntity).toBeUndefined();
  });

  it('ignores clicks on nothing', async () => {
    const { tool, references } = setup([]);
    await tool.click(0, 0);
    expect(references).toEqual([]);
  });
});

describe('FeatureSelection (D146, D163)', () => {
  function features(picks: (PickedEntity & { model?: string })[]) {
    const fake = fakeHost(picks);
    const reports: FeatureSelectionInfo[] = [];
    const selection = new FeatureSelection(fake.host, (info) => reports.push(info));
    return { ...fake, selection, reports, ids: () => reports.at(-1)?.features.map((feature) => feature.id) };
  }

  it('selects one feature, adds and removes with Ctrl, and clears on nothing', async () => {
    const { selection, reports, ids } = features([face(0), face(1), face(0), face(1)]);

    selection.click(0, 0, false);
    await settle();
    expect(reports.at(-1)?.features.map((feature) => feature.title)).toEqual(['Face (plane) of Box']);
    selection.click(0, 0, true);
    await settle();
    expect(ids()).toEqual(['f1', 'f2']);
    expect(reports.at(-1)?.totals).toEqual([{ name: 'Total area (2 faces)', value: '400.000 mm²' }]);

    selection.click(0, 0, true); // face 0 again: removed
    expect(ids()).toEqual(['f2']);
    selection.click(0, 0, false); // face 1 again, alone: stays
    expect(selection.entities.map((picked) => picked.entity)).toEqual([face(1)]);

    selection.click(0, 0, false); // nothing
    expect(ids()).toEqual([]);
  });

  it('has no features on mesh models', () => {
    const { selection } = features([{ ...meshPoint(0), model: 'm' }]);
    selection.click(0, 0, false);
    expect(selection.entities).toEqual([]);
  });

  it('drops the features of hidden parts and removed models (D98)', async () => {
    const { selection, ids } = features([face(0), { ...face(1), model: 'b' }]);
    selection.click(0, 0, false);
    selection.click(0, 0, true);
    await settle();

    selection.dropHidden('b', new Set([1]));
    expect(ids()).toEqual(['f1']);
    selection.removeModel('a');
    expect(ids()).toEqual([]);
  });
});
