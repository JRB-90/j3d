import type { EntityMeasure, EntityRef, PairMeasure } from '@j3d/occt/facade';
import { Box3, Group, Vector3, type Intersection } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BrepMeasurer } from '../import/types';
import { MeasureTool, type MeasureHost, type MeasureModel } from './measure';
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
    expect(partRows('Box', boxFace.part).map((row) => row.name)).toEqual(['Box: volume', 'Box: area', 'Box: size', 'Box: bounds']);
    const pair: PairMeasure = { kind: 'pair', distance: 30, pointA: [0, 0, 30], pointB: [0, 0, 0], angleOf: 'planes', angle: 0 };
    expect(pairLabel(pair)).toBe('30.000 mm');
    expect(pairRows(pair).map((row) => row.name)).toEqual(['Distance', 'Angle (planes)', 'Δx, Δy, Δz', 'From', 'To']);
    expect(pairLabel({ kind: 'pair', angle: 90 })).toBe('90.00°');
  });
});

/** A fake viewer with two models: a BREP model "a" (worker answers from `answers`) and, optionally, a BREP "b" and a mesh "m". */
function setup(picks: (PickedEntity & { model?: string })[], options: { unitScale?: number } = {}) {
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
        return boxFace;
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
  const pending: (string | null)[] = [];
  const measured: string[] = [];
  const tool = new MeasureTool(host, {
    onPending: (info) => pending.push(info?.title ?? null),
    onMeasured: (info) => measured.push(info.label),
  });
  tool.setActive(true);
  return { tool, workers, pending, measured, labels, overlays };
}

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
  const element = {
    className: '',
    textContent: '',
    hidden: false,
    dataset: {},
    style: {},
    children: [] as FakeElement[],
    append: (child: FakeElement) => element.children.push(child),
    remove: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    ownerDocument: { createElement: () => fakeElement() },
  };
  return element;
}

describe('MeasureTool (D101)', () => {
  it('shows the first pick, then keeps the pair as a labelled dimension', async () => {
    const { tool, workers, pending, measured, labels } = setup([face(0), face(1)]);

    await tool.click(0, 0);
    expect(pending).toEqual(['Face (plane) of Box']);
    expect(tool.pendingEntity?.entity.kind).toBe('face');

    await tool.click(0, 0);
    expect(workers.a.calls).toEqual(['entity', 'pair']);
    expect(measured).toEqual(['30.000 mm · 0.00°']);
    expect(pending.at(-1)).toBeNull();
    expect(tool.pendingEntity).toBeUndefined();
    expect(tool.list()).toEqual([{ id: 'm1', label: '30.000 mm · 0.00°', shown: true }]);
    const [label] = (labels as unknown as FakeElement).children;
    expect([label?.dataset['testid'], label?.textContent]).toEqual(['measure-label', '30.000 mm · 0.00°']);

    tool.updateLabels();
    expect(label?.style.transform).toContain('translate(10.0px, 20.0px)');
  });

  it("measures across models by sending B's shape into A's worker (D102)", async () => {
    const { tool, workers } = setup([{ ...face(0), model: 'a' }, { ...face(2), model: 'b' }]);

    await tool.click(0, 0);
    await tool.click(0, 0);

    expect(workers.b.calls).toEqual(['export']);
    expect(workers.a.calls).toEqual(['entity', 'pair with shape of b']);
  });

  it('measures mesh points approximately, in millimetres for glTF (D81, D105)', async () => {
    const { tool, pending, measured } = setup([{ ...meshPoint(0), model: 'm' }, { ...meshPoint(0.5), model: 'm' }], { unitScale: 1000 });

    await tool.click(0, 0);
    expect(pending).toEqual(['Point on Post']);
    await tool.click(0, 0);
    expect(measured).toEqual(['≈ 500.000 mm']);
  });

  it('drops a pending pick on Esc or when switched off, and shows only what .NET says (D108)', async () => {
    const { tool, pending } = setup([face(0), face(0), face(1)]);

    await tool.click(0, 0);
    tool.cancelPending();
    expect(pending).toEqual(['Face (plane) of Box', null]);

    await tool.click(0, 0);
    await tool.click(0, 0);
    tool.setShown([]);
    expect(tool.list()[0]?.shown).toBe(false);
    tool.setShown(['m1']);
    expect(tool.list()[0]?.shown).toBe(true);

    tool.removeModel('a');
    expect(tool.list()).toEqual([]);
  });

  it('ignores clicks on nothing', async () => {
    const { tool, pending } = setup([]);
    await tool.click(0, 0);
    expect(pending).toEqual([]);
  });
});
