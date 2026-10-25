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
import {
  angle,
  area,
  entityName,
  entityRows,
  length,
  pairLabel,
  pairRows,
  partRows,
  point,
  size,
  type MeasureInfo,
  type MeasureRow,
} from './measure-format';

/** What the Measure tool and feature selection need of a model. */
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

/** What the Measure tool and feature selection need of the viewer. */
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
  /** The reference's own values, or null when there's no reference (D147). */
  onReference?: (info: MeasureInfo | null) => void;
  /** The reference against the last click, or null when there's no result. */
  onResult?: (info: MeasureInfo | null) => void;
  onError?: (message: string) => void;
}

/** A face, edge or vertex (or a mesh point) of one model. */
export interface Picked {
  id: ModelId;
  entity: PickedEntity;
}

/** A picked entity's values: what the panel lists, with the worker's numbers for BREP entities. */
export interface Described {
  info: MeasureInfo;
  measure?: EntityMeasure | undefined;
}

/** Something drawn in 3D for a measurement: lines and dots in the overlays, and an HTML label (D103). */
interface Annotation {
  group: Group;
  label: HTMLElement;
  anchor: Vector3;
  dispose(): void;
}

/**
 * The Measure tool (D147, superseding M7's D101): while it's on, hovering pre-highlights the entity
 * under the pointer. The first click, or the feature it was started from, is the **reference**: its
 * own value is drawn on it (a length along an edge, Ø on a circle, an area on a face) and listed. Each
 * later click measures the reference against what it picked, replacing the previous result. Nothing
 * is kept: turning the tool off (Esc) clears it all.
 */
export class MeasureTool {
  private active = false;
  private hovered: (Picked & { highlight: Highlight | undefined }) | undefined;
  private reference: (Picked & { highlight: Highlight | undefined; annotation?: Annotation | undefined }) | undefined;
  private result: (Annotation & { info: MeasureInfo; target: Picked; highlight: Highlight | undefined }) | undefined;
  private readonly lineMaterial = new LineBasicMaterial({ color: AccentColour, depthTest: false, transparent: true, toneMapped: false });
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

  get referenceEntity(): Picked | undefined {
    return this.reference && { id: this.reference.id, entity: this.reference.entity };
  }

  /** The current result's label, for tests. */
  get resultLabel(): string | undefined {
    return this.result?.info.label;
  }

  /** Turns the tool on, from `reference` when one is given (a selected feature, or "Measure from here"), or off, clearing it. */
  setActive(active: boolean, reference?: Picked): void {
    if (active === this.active && !(active && reference)) {
      return;
    }
    const wasActive = this.active;
    this.active = active;
    if (active) {
      if (wasActive) {
        this.clear(); // "Measure from here" while measuring starts again from there
      }
      if (reference) {
        void this.pick(reference);
      }
    } else {
      this.setHovered(undefined);
      this.clear();
    }
    this.host.requestRender();
  }

  /** The entity the pointer would pick at a client point (D107). */
  entityAt(x: number, y: number): Picked | undefined {
    return entityAt(this.host, x, y);
  }

  hover(x: number | undefined, y: number | undefined): void {
    this.setHovered(x === undefined || y === undefined ? undefined : this.entityAt(x, y));
  }

  /** A click: the reference if there's none yet, else the reference against this. Clicks on nothing are ignored. */
  async click(x: number, y: number): Promise<void> {
    const picked = this.entityAt(x, y);
    if (picked) {
      await this.pick(picked);
    }
  }

  /** Drops the reference and the result. */
  clear(notify = true): void {
    const had = this.reference !== undefined || this.result !== undefined;
    this.clearResult(false);
    if (this.reference) {
      removeHighlight(this.host, this.reference.highlight);
      this.reference.annotation?.dispose();
      this.reference = undefined;
    }
    this.generation++;
    if (had && notify) {
      this.callbacks.onReference?.(null);
      this.callbacks.onResult?.(null);
    }
    this.host.requestRender();
  }

  /** A part was hidden: a reference on it goes, and with it the result; a result on it goes alone (D98). */
  dropHidden(id: ModelId, hidden: ReadonlySet<number>): void {
    if (this.reference?.id === id && hidden.has(this.reference.entity.node)) {
      this.clear();
    } else if (this.result?.target.id === id && hidden.has(this.result.target.entity.node)) {
      this.clearResult(true);
    }
    if (this.hovered?.id === id && hidden.has(this.hovered.entity.node)) {
      this.setHovered(undefined);
    }
  }

  /** A model has gone: whatever touches it goes too. */
  removeModel(id: ModelId): void {
    if (this.reference?.id === id) {
      this.clear();
    } else if (this.result?.target.id === id) {
      this.clearResult(true);
    }
    if (this.hovered?.id === id) {
      this.setHovered(undefined);
    }
  }

  /** The labels drawn, for tests: the reference's and the result's. */
  labels(): { role: 'reference' | 'result'; label: string }[] {
    const labels: { role: 'reference' | 'result'; label: string }[] = [];
    if (this.reference?.annotation) {
      labels.push({ role: 'reference', label: this.reference.annotation.label.textContent ?? '' });
    }
    if (this.result) {
      labels.push({ role: 'result', label: this.result.info.label });
    }
    return labels;
  }

  /** Moves each label to its anchor on screen; called after every frame. */
  updateLabels(): void {
    const rect = this.host.labels.getBoundingClientRect();
    for (const annotation of [this.reference?.annotation, this.result]) {
      if (annotation) {
        const at = this.host.toClient(annotation.anchor);
        annotation.label.style.visibility = at.visible ? '' : 'hidden';
        annotation.label.style.transform = `translate(${(at.x - rect.left).toFixed(1)}px, ${(at.y - rect.top).toFixed(1)}px) translate(-50%, -130%)`;
      }
    }
  }

  dispose(): void {
    this.setHovered(undefined);
    this.clear(false);
    this.lineMaterial.dispose();
  }

  private async pick(picked: Picked): Promise<void> {
    if (!this.reference) {
      await this.pickReference(picked);
      return;
    }
    const reference = this.reference;
    const generation = ++this.generation;
    try {
      this.busy = true;
      const { info, ends } = await measurePair(this.model(reference.id), reference, this.model(picked.id), picked);
      if (generation === this.generation) {
        this.clearResult(false);
        const highlight = this.highlightOf(picked, 'selected');
        this.result = { ...this.annotate(info.label, ends[0].clone().add(ends[1]).multiplyScalar(0.5), 'result', ends, ends), info, target: picked, highlight };
        this.callbacks.onResult?.(info);
      }
    } catch (error) {
      this.fail(error, generation);
    } finally {
      this.busy = false;
    }
  }

  /** Later clicks don't wait for the reference's values: they're measured against it at once. */
  private async pickReference(picked: Picked): Promise<void> {
    const reference: NonNullable<MeasureTool['reference']> = { ...picked, highlight: this.highlightOf(picked, 'selected') };
    this.reference = reference;
    this.host.requestRender();
    try {
      this.busy = true;
      const described = await describeEntity(this.model(picked.id), picked);
      if (this.reference === reference) {
        reference.annotation = this.annotateReference(picked, described);
        this.callbacks.onReference?.({ ...described.info, id: 'reference' });
      }
    } catch (error) {
      if (this.reference === reference) {
        this.clear();
        this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.busy = false;
    }
  }

  /** The reference's own value drawn on it: Ø across a circle, otherwise a label at its anchor. */
  private annotateReference(picked: Picked, { info, measure }: Described): Annotation {
    if (measure?.kind === 'edge' && measure.curve === 'circle' && measure.centre && measure.radius !== undefined) {
      const centre = new Vector3(...measure.centre);
      const across = new Vector3(...measure.anchor).sub(centre);
      if (across.lengthSq() > 0) {
        across.setLength(measure.radius);
        const ends: [Vector3, Vector3] = [centre.clone().sub(across), centre.clone().add(across)];
        return this.annotate(info.label, centre, 'reference', ends, []);
      }
    }
    const anchor = measure ? new Vector3(...measure.anchor) : new Vector3(...picked.entity.point);
    return this.annotate(info.label, anchor, 'reference', undefined, []);
  }

  /** A label at `anchor`, with a line between `line`'s ends and dots at `dots`, all drawn over everything. */
  private annotate(text: string, anchor: Vector3, role: 'reference' | 'result', line: [Vector3, Vector3] | undefined, dots: Vector3[]): Annotation {
    const group = new Group();
    group.name = `measure ${role}`;
    const geometries: BufferGeometry[] = [];
    if (line) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array([...line[0].toArray(), ...line[1].toArray()]), 3));
      const segments = new LineSegments(geometry, this.lineMaterial);
      segments.renderOrder = 30;
      segments.raycast = () => {};
      group.add(segments);
      geometries.push(geometry);
    }
    if (dots.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(dots.flatMap((dot) => dot.toArray())), 3));
      const points = new Points(geometry, this.host.highlights.point('selected'));
      points.renderOrder = 31;
      points.raycast = () => {};
      group.add(points);
      geometries.push(geometry);
    }
    this.host.overlays.add(group);

    const label = this.host.labels.ownerDocument.createElement('div');
    label.className = `j3d-measure-label j3d-measure-label--${role}`;
    label.textContent = text;
    label.dataset['testid'] = 'measure-label';
    label.dataset['role'] = role;
    this.host.labels.append(label);
    this.host.requestRender();
    return {
      group,
      label,
      anchor,
      dispose: () => {
        this.host.overlays.remove(group);
        geometries.forEach((geometry) => geometry.dispose());
        label.remove();
      },
    };
  }

  private clearResult(notify: boolean): void {
    if (this.result) {
      removeHighlight(this.host, this.result.highlight);
      this.result.dispose();
      this.result = undefined;
      if (notify) {
        this.callbacks.onResult?.(null);
      }
      this.host.requestRender();
    }
  }

  private setHovered(picked: Picked | undefined): void {
    if (sameEntity(picked, this.hovered)) {
      return;
    }
    removeHighlight(this.host, this.hovered?.highlight);
    this.hovered = picked && { ...picked, highlight: this.highlightOf(picked, 'hovered') };
    this.host.requestRender();
  }

  private highlightOf(picked: Picked, kind: 'selected' | 'hovered'): Highlight | undefined {
    const highlight = this.host.model(picked.id)?.parts.entityHighlight(picked.entity, kind, this.host.highlights);
    if (highlight) {
      this.host.overlays.add(highlight.object);
    }
    return highlight;
  }

  /** A pair that couldn't be measured: the reference stays, ready for another click. */
  private fail(error: unknown, generation: number): void {
    if (generation === this.generation) {
      this.clearResult(true);
      this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private model(id: ModelId): MeasureModel {
    return modelOf(this.host, id);
  }
}

/** The entity under a client point (D107): a BREP face, edge or vertex, or a point on a mesh. */
export function entityAt(host: MeasureHost, x: number, y: number): Picked | undefined {
  const found = host.hitAt(x, y);
  const model = found && host.model(found.id);
  if (!found || !model) {
    return undefined;
  }
  const entity = model.parts.entityAt(found.hit, host.screenAt(x, y, found.hit.point));
  return entity && { id: found.id, entity };
}

export function sameEntity(a: Picked | undefined, b: Picked | undefined): boolean {
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

export function removeHighlight(host: MeasureHost, highlight: Highlight | undefined): void {
  if (highlight) {
    host.overlays.remove(highlight.object);
    highlight.dispose();
  }
}

export function modelOf(host: MeasureHost, id: ModelId): MeasureModel {
  const model = host.model(id);
  if (!model) {
    throw new Error('That model has been removed.');
  }
  return model;
}

/** One pick's values and its part's (D104): exact from the worker, or approximate on a mesh. */
export async function describeEntity(model: MeasureModel, picked: Picked): Promise<Described> {
  const name = model.nameOf(picked.entity.node);
  const parts = [{ id: picked.id, node: picked.entity.node }];
  if (picked.entity.kind !== 'point' && model.measure) {
    const measure = await model.measure.entity(picked.entity.ref);
    return {
      measure,
      info: {
        id: '',
        title: `${entityName(measure)} of ${name}`,
        label: primaryValue(measure),
        rows: [...entityRows(measure), ...partRows(name, measure.part)],
        parts,
        approximate: false,
      },
    };
  }
  const scale = model.unitScale;
  const rows: MeasureRow[] = [{ name: 'Point', value: point(scaled(picked.entity.point, scale), true) }];
  const box = model.parts.nodeBounds(picked.entity.node);
  if (!box.isEmpty()) {
    rows.push({ name: 'Size', value: size(scaled(box.min.toArray(), scale), scaled(box.max.toArray(), scale), true), group: name });
  }
  return { info: { id: '', title: `Point on ${name}`, label: point(scaled(picked.entity.point, scale), true), rows, parts, approximate: true } };
}

/**
 * Two picks: exactly in a worker when both are BREP entities, sending B's shape across when they're
 * in different models (D102); approximately, from the meshes, when either is on a mesh model (D81).
 */
async function measurePair(modelA: MeasureModel, a: Picked, modelB: MeasureModel, b: Picked): Promise<{ info: MeasureInfo; ends: [Vector3, Vector3] }> {
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
  const label = pairLabel(pair, approximate) + (pair.distance !== undefined && pair.angle !== undefined ? ` · ${angle(pair.angle)}` : '');
  const nameA = `${describeKind(a.entity)} of ${modelA.nameOf(a.entity.node)}`;
  const nameB = `${describeKind(b.entity)} of ${modelB.nameOf(b.entity.node)}`;
  const info: MeasureInfo = {
    id: 'result',
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

function describeKind(entity: PickedEntity): string {
  return entity.kind === 'point' ? 'Point' : entity.kind[0]!.toUpperCase() + entity.kind.slice(1);
}

/** What a single pick's label says (D147): Ø of a circle or a cylinder, an edge's length, a face's area, a vertex's position. */
export function primaryValue(measure: EntityMeasure): string {
  switch (measure.kind) {
    case 'face':
      return measure.radius !== undefined && (measure.surface === 'cylinder' || measure.surface === 'sphere')
        ? `Ø ${length(measure.radius * 2)}`
        : area(measure.area);
    case 'edge':
      return measure.radius !== undefined && measure.curve === 'circle' ? `Ø ${length(measure.radius * 2)}` : length(measure.length);
    case 'vertex':
      return point(measure.point);
  }
}

function scaled(xyz: readonly number[], scale: number): Vector3Tuple {
  return [xyz[0]! * scale, xyz[1]! * scale, xyz[2]! * scale];
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
