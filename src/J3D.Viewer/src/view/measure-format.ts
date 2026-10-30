import type { EntityMeasure, PairMeasure, PartMeasure, Xyz } from '@j3d/occt/facade';

/**
 * One line of a measurement in the panel: what it is and its value, ready to show and copy. Rows with a
 * group (a part's name) are listed under it, so the name isn't repeated on every line.
 */
export interface MeasureRow {
  /** What it is. */
  name: string;
  /** Its value, ready to show. */
  value: string;
  /** The part it's listed under, if any. */
  group?: string;
}

/**
 * A measurement as .NET shows it (mirrors J3D.Blazor/Interop/MeasureInfo.cs): a title, the
 * label drawn in 3D, the rows for the panel, and the parts it measures, so it can follow them (D108).
 * The id is empty for the pending first pick.
 */
export interface MeasureInfo {
  /** Its id, empty for the pending first pick. */
  id: string;
  /** Its heading in a panel. */
  title: string;
  /** What's drawn in 3D. */
  label: string;
  /** A panel's lines. */
  rows: MeasureRow[];
  /** The parts it measures. */
  parts: { id: string; node: number }[];
  /** Its values are approximate, shown with ≈. */
  approximate: boolean;
}

/** A number to fixed decimals, without the "-0.000" that rounding a tiny negative gives. */
export function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/** Lengths in millimetres to 3 decimals, angles in degrees to 2 (assumption 13). */
export function length(value: number, approximate = false): string {
  return `${approximate ? '≈ ' : ''}${fixed(value, 3)} mm`;
}

export function area(value: number): string {
  return `${fixed(value, 3)} mm²`;
}

export function volume(value: number): string {
  return `${fixed(value, 3)} mm³`;
}

export function angle(value: number): string {
  return `${fixed(value, 2)}°`;
}

export function point(xyz: readonly number[], approximate = false): string {
  return `${approximate ? '≈ ' : ''}(${xyz.map((v) => fixed(v, 3)).join(', ')})`;
}

export function direction(xyz: readonly number[]): string {
  return `(${xyz.map((v) => fixed(v, 3)).join(', ')})`;
}

/** What a BREP entity is, for titles: "Face (cylinder)", "Edge (circle)", "Vertex". */
export function entityName(measure: EntityMeasure): string {
  switch (measure.kind) {
    case 'face':
      return measure.surface === 'other' ? 'Face' : `Face (${measure.surface})`;
    case 'edge':
      return measure.curve === 'other' ? 'Edge' : `Edge (${measure.curve})`;
    case 'vertex':
      return 'Vertex';
  }
}

/** One BREP entity's rows (D80). */
export function entityRows(measure: EntityMeasure): MeasureRow[] {
  const rows: MeasureRow[] = [];
  const add = (name: string, value: string | undefined) => value !== undefined && rows.push({ name, value });
  switch (measure.kind) {
    case 'face':
      add('Area', area(measure.area));
      add('Normal', measure.normal && direction(measure.normal));
      if (measure.radius !== undefined) {
        add('Radius', length(measure.radius));
        add('Diameter', length(measure.radius * 2));
      }
      add('Major radius', measure.majorRadius === undefined ? undefined : length(measure.majorRadius));
      add('Minor radius', measure.minorRadius === undefined ? undefined : length(measure.minorRadius));
      add('Half angle', measure.semiAngle === undefined ? undefined : angle(measure.semiAngle));
      add('Axis', measure.axis && direction(measure.axis));
      add('Axis through', measure.origin && point(measure.origin));
      add('Centre', measure.centre && point(measure.centre));
      break;
    case 'edge':
      add('Length', length(measure.length));
      if (measure.radius !== undefined) {
        add('Radius', length(measure.radius));
        add('Diameter', length(measure.radius * 2));
      }
      add('Major radius', measure.majorRadius === undefined ? undefined : length(measure.majorRadius));
      add('Minor radius', measure.minorRadius === undefined ? undefined : length(measure.minorRadius));
      add('Centre', measure.centre && point(measure.centre));
      add('Normal', measure.normal && direction(measure.normal));
      add('Direction', measure.direction && direction(measure.direction));
      add('Start', measure.start && point(measure.start));
      add('End', measure.end && point(measure.end));
      break;
    case 'vertex':
      add('Point', point(measure.point));
      break;
  }
  return rows;
}

/** A part's rows, grouped under its name (D104). */
export function partRows(name: string, part: PartMeasure): MeasureRow[] {
  const rows: MeasureRow[] = [];
  if (part.volume > 0) {
    rows.push({ name: 'Volume', value: volume(part.volume), group: name });
  }
  rows.push({ name: 'Area', value: area(part.area), group: name });
  if (part.min && part.max) {
    rows.push({ name: 'Size', value: size(part.min, part.max), group: name });
    rows.push({ name: 'Bounds', value: `${point(part.min)} to ${point(part.max)}`, group: name });
  }
  return rows;
}

/** A box's extent as "dx × dy × dz mm". */
export function size(min: readonly number[], max: readonly number[], approximate = false): string {
  return `${approximate ? '≈ ' : ''}${[0, 1, 2].map((axis) => fixed(max[axis]! - min[axis]!, 3)).join(' × ')} mm`;
}

/** The headline of a pair: its distance, else its angle. */
export function pairLabel(pair: PairMeasure, approximate = false): string {
  if (pair.distance !== undefined) {
    return length(pair.distance, approximate);
  }
  return pair.angle !== undefined ? angle(pair.angle) : 'No result';
}

/** A pair's rows (D80): distance and its closest points, angle, centre to centre. */
export function pairRows(pair: PairMeasure, approximate = false): MeasureRow[] {
  const rows: MeasureRow[] = [];
  if (pair.distance !== undefined) {
    rows.push({ name: 'Distance', value: length(pair.distance, approximate) });
  }
  if (pair.angle !== undefined) {
    rows.push({ name: `Angle (${pair.angleOf ?? 'between'})`, value: angle(pair.angle) });
  }
  if (pair.centreDistance !== undefined) {
    rows.push({ name: 'Centre to centre', value: length(pair.centreDistance) });
  }
  if (pair.pointA && pair.pointB) {
    const delta: Xyz = [0, 1, 2].map((axis) => pair.pointB![axis]! - pair.pointA![axis]!) as Xyz;
    rows.push({ name: 'Δx, Δy, Δz', value: `${approximate ? '≈ ' : ''}(${delta.map((v) => fixed(v, 3)).join(', ')})` });
    rows.push({ name: 'From', value: point(pair.pointA, approximate) });
    rows.push({ name: 'To', value: point(pair.pointB, approximate) });
  }
  return rows;
}
