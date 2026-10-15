import type { EntityMeasure, PairMeasure, Xyz } from '@j3d/occt/facade';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line3,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Points,
  Triangle,
  Vector3,
  type Intersection,
} from 'three';
import type { BrepMeasurer, ModelId, Vector3Tuple } from '../import/types';
import { AccentColour, type Highlight, type HighlightMaterials, type ModelParts, type PickedEntity, type ScreenSpace } from './parts';
import { angle, area, entityName, entityRows, length, pairLabel, pairRows, partRows, point, size, type MeasureInfo, type MeasureRow } from './measure-format';

/** What the Measure tool needs of a model. */
export interface MeasureModel {
  parts: ModelParts;
  /** BREP models: the worker that measures exactly. Mesh models have none and measure approximately (D81). */
  measure?: BrepMeasurer | undefined;
  /** A tree node's name, for titles. */
  nameOf(node: number): string;
  /** Model units to millimetres: 1000 for glTF, which is in metres (D105), otherwise 1. */
  unitScale: number;
  /** For a BREP placement's face triangles and edge segments, when a pair is measured approximately. */
  prototypes?: undefined | readonly { positions: Float32Array; indices: Uint32Array; edges: Float32Array; faceRanges: Uint32Array; edgeRanges: Uint32Array }[];
}

/** What the Measure tool needs of the viewer. */
export interface MeasureHost {
  /** The visible part surface under a client point. */
  hitAt(x: number, y: number): { id: ModelId; hit: Intersection } | undefined;
  screenAt(x: number, y: number, hitPoint: Vector3): ScreenSpace;
  model(id: ModelId): MeasureModel | undefined;
  /** Client coordinates of a world point, and whether it's in front of the camera. */
  toClient(world: Vector3): { x: number; y: number; visible: boolean };
  overlays: Group;
  highlights: HighlightMaterials;
  labels: HTMLElement;
  requestRender(): void;
}

export interface MeasureCallbacks {
  /** The first pick's properties, or null when there's no pending pick (D101). */
  onPending?: (info: MeasureInfo | null) => void;
  /** A finished pair, now kept and drawn. */
  onMeasured?: (info: MeasureInfo) => void;
  onError?: (message: string) => void;
}

interface Picked {
  id: ModelId;
  entity: PickedEntity;
}

interface Kept {
  info: MeasureInfo;
  group: Group;
  label: HTMLElement;
  anchor: Vector3;
  dispose(): void;
}

/**
 * The Measure tool (M7, D79, D101): while it's on, hovering pre-highlights the entity under the
 * pointer, the first click picks one and shows its properties, and the second picks another and
 * keeps the pair's measurement, drawn as a dimension with an HTML label (D103). Which kept
 * measurements are shown is .NET's call (D108).
 */
export class MeasureTool {
  private active = false;
  private hovered: (Picked & { highlight: Highlight | undefined }) | undefined;
  private pending: (Picked & { highlight: Highlight | undefined }) | undefined;
  private readonly kept = new Map<string, Kept>();
  private readonly lineMaterial = new LineBasicMaterial({ color: AccentColour, depthTest: false, transparent: true, toneMapped: false });
  private next = 0;
  /** Bumped by every new pick, so a slow answer for an abandoned one is ignored. */
  private generation = 0;
  busy = false;

  constructor(
    private readonly host: MeasureHost,
    private readonly callbacks: MeasureCallbacks,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  get hoveredEntity(): Picked | undefined {
    return this.hovered && { id: this.hovered.id, entity: this.hovered.entity };
  }

  get pendingEntity(): Picked | undefined {
    return this.pending && { id: this.pending.id, entity: this.pending.entity };
  }

  setActive(active: boolean): void {
    if (active === this.active) {
      return;
    }
    this.active = active;
    if (!active) {
      this.setHovered(undefined);
      this.cancelPending();
    }
    this.host.requestRender();
  }

  /** The entity the pointer would pick at a client point (D107). */
  entityAt(x: number, y: number): Picked | undefined {
    const found = this.host.hitAt(x, y);
    const model = found && this.host.model(found.id);
    if (!found || !model) {
      return undefined;
    }
    const entity = model.parts.entityAt(found.hit, this.host.screenAt(x, y, found.hit.point));
    return entity && { id: found.id, entity };
  }

  hover(x: number | undefined, y: number | undefined): void {
    this.setHovered(x === undefined || y === undefined ? undefined : this.entityAt(x, y));
  }

  /** A click: the first pick, or the second, which finishes a measurement. Clicks on nothing are ignored. */
  async click(x: number, y: number): Promise<void> {
    const picked = this.entityAt(x, y);
    if (!picked) {
      return;
    }
    if (!this.pending) {
      const generation = ++this.generation;
      this.setPending(picked);
      try {
        this.busy = true;
        const info = await this.describe(picked);
        if (generation === this.generation && this.pending) {
          this.callbacks.onPending?.(info);
        }
      } catch (error) {
        this.fail(error, generation);
      } finally {
        this.busy = false;
      }
      return;
    }

    const first = this.pending;
    this.cancelPending(false);
    const generation = ++this.generation;
    try {
      this.busy = true;
      const { info, ends } = await this.measurePair(first, picked);
      if (generation === this.generation) {
        this.keep(info, ends);
        this.callbacks.onPending?.(null);
        this.callbacks.onMeasured?.(info);
      }
    } catch (error) {
      this.fail(error, generation);
    } finally {
      this.busy = false;
    }
  }

  /** Drops a half-done pick (Esc, or leaving the tool; D101). */
  cancelPending(notify = true): void {
    if (!this.pending) {
      return;
    }
    this.removeHighlight(this.pending.highlight);
    this.pending = undefined;
    this.generation++;
    if (notify) {
      this.callbacks.onPending?.(null);
    }
    this.host.requestRender();
  }

  /** Shows exactly these kept measurements: .NET hides those whose parts are hidden or cleared (D108). */
  setShown(ids: readonly string[]): void {
    const shown = new Set(ids);
    for (const [id, kept] of this.kept) {
      kept.group.visible = shown.has(id);
      kept.label.hidden = !shown.has(id);
    }
    this.host.requestRender();
  }

  /** A model has gone: its measurements and picks go with it. */
  removeModel(id: ModelId): void {
    if (this.pending?.id === id) {
      this.cancelPending();
    }
    if (this.hovered?.id === id) {
      this.setHovered(undefined);
    }
    for (const [key, kept] of this.kept) {
      if (kept.info.parts.some((part) => part.id === id)) {
        kept.dispose();
        this.kept.delete(key);
      }
    }
  }

  /** The kept measurements, for tests. */
  list(): { id: string; label: string; shown: boolean }[] {
    return [...this.kept.values()].map((kept) => ({ id: kept.info.id, label: kept.info.label, shown: kept.group.visible }));
  }

  /** Moves each shown label to its dimension's midpoint on screen; called after every frame. */
  updateLabels(): void {
    const rect = this.host.labels.getBoundingClientRect();
    for (const kept of this.kept.values()) {
      if (!kept.group.visible) {
        continue;
      }
      const at = this.host.toClient(kept.anchor);
      kept.label.style.visibility = at.visible ? '' : 'hidden';
      kept.label.style.transform = `translate(${(at.x - rect.left).toFixed(1)}px, ${(at.y - rect.top).toFixed(1)}px) translate(-50%, -130%)`;
    }
  }

  dispose(): void {
    this.setHovered(undefined);
    this.cancelPending(false);
    for (const kept of this.kept.values()) {
      kept.dispose();
    }
    this.kept.clear();
    this.lineMaterial.dispose();
  }

  private setHovered(picked: Picked | undefined): void {
    if (sameEntity(picked, this.hovered)) {
      return;
    }
    this.removeHighlight(this.hovered?.highlight);
    const highlight = picked && this.host.model(picked.id)?.parts.entityHighlight(picked.entity, 'hovered', this.host.highlights);
    if (highlight) {
      this.host.overlays.add(highlight.object);
    }
    this.hovered = picked && { ...picked, highlight };
    this.host.requestRender();
  }

  private setPending(picked: Picked): void {
    this.removeHighlight(this.pending?.highlight);
    const highlight = this.host.model(picked.id)?.parts.entityHighlight(picked.entity, 'selected', this.host.highlights);
    if (highlight) {
      this.host.overlays.add(highlight.object);
    }
    this.pending = { ...picked, highlight };
    this.host.requestRender();
  }

  private removeHighlight(highlight: Highlight | undefined): void {
    if (highlight) {
      this.host.overlays.remove(highlight.object);
      highlight.dispose();
    }
  }

  private fail(error: unknown, generation: number): void {
    if (generation === this.generation) {
      this.cancelPending();
      this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** One pick's properties and its part's (D104): exact from the worker, or approximate on a mesh. */
  private async describe(picked: Picked): Promise<MeasureInfo> {
    const model = this.model(picked.id);
    const name = model.nameOf(picked.entity.node);
    const parts = [{ id: picked.id, node: picked.entity.node }];
    if (picked.entity.kind !== 'point' && model.measure) {
      const measure = await model.measure.entity(picked.entity.ref);
      return {
        id: '',
        title: `${entityName(measure)} of ${name}`,
        label: primaryValue(measure),
        rows: [...entityRows(measure), ...partRows(name, measure.part)],
        parts,
        approximate: false,
      };
    }
    const scale = model.unitScale;
    const rows: MeasureRow[] = [{ name: 'Point', value: point(scaled(picked.entity.point, scale), true) }];
    const box = nodeBox(model.parts, picked.entity.node);
    if (box) {
      rows.push({ name: `${name}: size`, value: size(scaled(box.min.toArray(), scale), scaled(box.max.toArray(), scale), true) });
    }
    return { id: '', title: `Point on ${name}`, label: point(scaled(picked.entity.point, scale), true), rows, parts, approximate: true };
  }

  /**
   * Two picks: exactly in a worker when both are BREP entities, sending B's shape across when they're
   * in different models (D102); approximately, from the meshes, when either is on a mesh model (D81).
   */
  private async measurePair(a: Picked, b: Picked): Promise<{ info: MeasureInfo; ends: [Vector3, Vector3] }> {
    const modelA = this.model(a.id);
    const modelB = this.model(b.id);
    let pair: PairMeasure;
    let approximate = false;
    let ends: [Vector3, Vector3] = [new Vector3(...a.entity.point), new Vector3(...b.entity.point)];
    if (a.entity.kind !== 'point' && b.entity.kind !== 'point' && modelA.measure && modelB.measure) {
      pair =
        a.id === b.id
          ? await modelA.measure.pair(a.entity.ref, b.entity.ref)
          : await modelA.measure.pair(a.entity.ref, b.entity.ref, await modelB.measure.exportEntity(b.entity.ref));
    } else {
      approximate = true;
      const pointA = closestOn(modelA, a.entity, new Vector3(...b.entity.point));
      const pointB = closestOn(modelB, b.entity, pointA);
      // glTF is in metres; a pair within glTF models reads in millimetres (D105).
      const scale = modelA.unitScale === modelB.unitScale ? modelA.unitScale : 1;
      pair = {
        kind: 'pair',
        distance: pointA.distanceTo(pointB) * scale,
        pointA: scaled(pointA.toArray(), scale) as Xyz,
        pointB: scaled(pointB.toArray(), scale) as Xyz,
      };
      ends = [pointA, pointB];
    }
    if (!approximate && pair.pointA && pair.pointB) {
      ends = [new Vector3(...pair.pointA), new Vector3(...pair.pointB)];
    }
    const id = `m${++this.next}`;
    const label = pairLabel(pair, approximate) + (pair.distance !== undefined && pair.angle !== undefined ? ` · ${angle(pair.angle)}` : '');
    const nameA = `${describeKind(a.entity)} of ${modelA.nameOf(a.entity.node)}`;
    const nameB = `${describeKind(b.entity)} of ${modelB.nameOf(b.entity.node)}`;
    const info: MeasureInfo = {
      id,
      title: `${pair.distance !== undefined ? 'Distance' : 'Angle'} ${label}`,
      label,
      rows: [...pairRows(pair, approximate), { name: 'A', value: nameA }, { name: 'B', value: nameB }],
      parts: [
        { id: a.id, node: a.entity.node },
        { id: b.id, node: b.entity.node },
      ],
      approximate,
    };
    return { info, ends };
  }

  /** Draws a kept measurement: a line between its closest points, dots at both ends, and its label (D103). */
  private keep(info: MeasureInfo, [from, to]: [Vector3, Vector3]): void {
    const group = new Group();
    group.name = `measure ${info.id}`;
    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute('position', new BufferAttribute(new Float32Array([...from.toArray(), ...to.toArray()]), 3));
    const line = new LineSegments(lineGeometry, this.lineMaterial);
    line.renderOrder = 30;
    const dotGeometry = new BufferGeometry();
    dotGeometry.setAttribute('position', new BufferAttribute(new Float32Array([...from.toArray(), ...to.toArray()]), 3));
    const dots = new Points(dotGeometry, this.host.highlights.point('selected'));
    dots.renderOrder = 31;
    for (const object of [line, dots]) {
      object.raycast = () => {};
      group.add(object);
    }
    this.host.overlays.add(group);

    const label = this.host.labels.ownerDocument.createElement('div');
    label.className = 'j3d-measure-label';
    label.textContent = info.label;
    label.dataset['testid'] = 'measure-label';
    label.dataset['measureId'] = info.id;
    this.host.labels.append(label);

    const anchor = from.clone().add(to).multiplyScalar(0.5);
    this.kept.set(info.id, {
      info,
      group,
      label,
      anchor,
      dispose: () => {
        this.host.overlays.remove(group);
        lineGeometry.dispose();
        dotGeometry.dispose();
        label.remove();
      },
    });
    this.host.requestRender();
  }

  private model(id: ModelId): MeasureModel {
    const model = this.host.model(id);
    if (!model) {
      throw new Error('That model has been removed.');
    }
    return model;
  }
}

function sameEntity(a: Picked | undefined, b: Picked | undefined): boolean {
  if (!a || !b) {
    return a === b;
  }
  if (a.id !== b.id || a.entity.kind !== b.entity.kind || a.entity.node !== b.entity.node) {
    return false;
  }
  return a.entity.kind === 'point' || b.entity.kind === 'point'
    ? a.entity.point.every((v, i) => v === b.entity.point[i])
    : a.entity.ref.index === b.entity.ref.index && a.entity.ref.matrix === b.entity.ref.matrix;
}

function describeKind(entity: PickedEntity): string {
  return entity.kind === 'point' ? 'Point' : entity.kind[0]!.toUpperCase() + entity.kind.slice(1);
}

/** What a single pick's label would say: an edge's length, a face's area or a vertex's position. */
function primaryValue(measure: EntityMeasure): string {
  switch (measure.kind) {
    case 'face':
      return measure.radius !== undefined ? `R ${length(measure.radius)}` : area(measure.area);
    case 'edge':
      return measure.radius !== undefined ? `R ${length(measure.radius)}` : length(measure.length);
    case 'vertex':
      return point(measure.point);
  }
}

function scaled(xyz: readonly number[], scale: number): Vector3Tuple {
  return [xyz[0]! * scale, xyz[1]! * scale, xyz[2]! * scale];
}

/** A node's bounds, when the model can tell (mesh parts and BREP parts both can). */
function nodeBox(parts: ModelParts, node: number): { min: Vector3; max: Vector3 } | undefined {
  const box = parts.nodeBounds(node);
  return box && !box.isEmpty() ? box : undefined;
}

/** The point of a pick nearest `to`: a mesh point itself, or the nearest point of a BREP entity's tessellation. */
function closestOn(model: MeasureModel, entity: PickedEntity, to: Vector3): Vector3 {
  if (entity.kind === 'point' || entity.kind === 'vertex') {
    return new Vector3(...entity.point);
  }
  const mesh = model.prototypes?.[entity.ref.prototype];
  if (!mesh) {
    return new Vector3(...entity.point);
  }
  const matrix = new Matrix4().fromArray(entity.ref.matrix);
  const best = new Vector3(...entity.point);
  let bestDistance = best.distanceToSquared(to);
  const candidate = new Vector3();
  const consider = () => {
    const distance = candidate.distanceToSquared(to);
    if (distance < bestDistance) {
      bestDistance = distance;
      best.copy(candidate);
    }
  };
  if (entity.kind === 'face') {
    const start = mesh.faceRanges[entity.ref.index * 2]!;
    const count = mesh.faceRanges[entity.ref.index * 2 + 1]!;
    const triangle = new Triangle();
    for (let i = start; i < start + count; i += 3) {
      triangle.a.fromArray(mesh.positions, mesh.indices[i]! * 3).applyMatrix4(matrix);
      triangle.b.fromArray(mesh.positions, mesh.indices[i + 1]! * 3).applyMatrix4(matrix);
      triangle.c.fromArray(mesh.positions, mesh.indices[i + 2]! * 3).applyMatrix4(matrix);
      triangle.closestPointToPoint(to, candidate);
      consider();
    }
  } else {
    const first = mesh.edgeRanges[entity.ref.index * 2]!;
    const count = mesh.edgeRanges[entity.ref.index * 2 + 1]!;
    const segment = new Line3();
    for (let p = first; p < first + count; p += 2) {
      segment.start.fromArray(mesh.edges, p * 3).applyMatrix4(matrix);
      segment.end.fromArray(mesh.edges, p * 3 + 3).applyMatrix4(matrix);
      segment.closestPointToPoint(to, true, candidate);
      consider();
    }
  }
  return best;
}
