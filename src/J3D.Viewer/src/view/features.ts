import type { EntityMeasure } from '@j3d/occt/facade';
import type { ModelId } from '../import/types';
import { area, length, type MeasureInfo, type MeasureRow } from './measure-format';
import { describeEntity, entityAt, modelOf, removeHighlight, sameEntity, type MeasureHost, type Picked } from './measure';
import type { Highlight } from './parts';

/**
 * What Feature selection holds (D146, D163; mirrors J3D.Web.Client/Interop/FeatureSelection.cs): each
 * selected face, edge or vertex's values, in the order they were picked, and the totals that add up.
 */
export interface FeatureSelectionInfo {
  features: MeasureInfo[];
  totals: MeasureRow[];
}

interface Selected extends Picked {
  key: number;
  highlight: Highlight | undefined;
  info?: MeasureInfo;
  measure?: EntityMeasure | undefined;
}

/**
 * Feature selection (M12, D146): in Feature mode a click selects the BREP face, edge or vertex under
 * the pointer, picked as the Measure tool picks (D107); Ctrl adds or removes, and a click on nothing
 * clears. Mesh models have no features. Each feature's values come from its worker, as a Measure
 * pick's do, and the selection is reported once they have; the viewer owns it, since only it can
 * name an entity, and .NET shows what it reports.
 */
export class FeatureSelection {
  private selected: Selected[] = [];
  private hovered: (Picked & { highlight: Highlight | undefined }) | undefined;
  private next = 0;

  constructor(
    private readonly host: MeasureHost,
    private readonly onChange: (selection: FeatureSelectionInfo) => void,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  /** The selected features, oldest first. */
  get entities(): Picked[] {
    return this.selected.map(({ id, entity }) => ({ id, entity }));
  }

  get hoveredEntity(): Picked | undefined {
    return this.hovered && { id: this.hovered.id, entity: this.hovered.entity };
  }

  /** A BREP feature under a client point; mesh points don't count. */
  featureAt(x: number, y: number): Picked | undefined {
    const picked = entityAt(this.host, x, y);
    return picked && picked.entity.kind !== 'point' ? picked : undefined;
  }

  hover(x: number | undefined, y: number | undefined): void {
    const picked = x === undefined || y === undefined ? undefined : this.featureAt(x, y);
    if (sameEntity(picked, this.hovered)) {
      return;
    }
    removeHighlight(this.host, this.hovered?.highlight);
    this.hovered = picked && { ...picked, highlight: this.highlightOf(picked, 'hovered') };
    this.host.requestRender();
  }

  /** A click: selects the feature under the pointer, or with `additive` adds or removes it; nothing clears. */
  click(x: number, y: number, additive: boolean): void {
    this.select(this.featureAt(x, y), additive);
  }

  /** Selects a feature (or nothing), as a click would. */
  select(picked: Picked | undefined, additive: boolean): void {
    if (!picked) {
      if (!additive) {
        this.clear();
      }
      return;
    }
    const existing = this.selected.find((selected) => sameEntity(selected, picked));
    if (additive && existing) {
      this.remove([existing]);
      return;
    }
    if (!additive) {
      if (existing && this.selected.length === 1) {
        return;
      }
      this.remove(this.selected.filter((selected) => selected !== existing), false);
      if (existing) {
        this.report();
        return;
      }
    }
    const entry: Selected = { ...picked, key: ++this.next, highlight: this.highlightOf(picked, 'selected') };
    this.selected.push(entry);
    this.host.requestRender();
    this.report();
    void this.describe(entry);
  }

  /** Whether a feature is selected. */
  has(picked: Picked): boolean {
    return this.selected.some((selected) => sameEntity(selected, picked));
  }

  clear(notify = true): void {
    if (this.selected.length > 0) {
      this.remove(this.selected, notify);
    }
  }

  /** Features of parts just hidden leave the selection (D98). */
  dropHidden(id: ModelId, hidden: ReadonlySet<number>): void {
    this.remove(this.selected.filter((selected) => selected.id === id && hidden.has(selected.entity.node)));
    if (this.hovered?.id === id && hidden.has(this.hovered.entity.node)) {
      this.hover(undefined, undefined);
    }
  }

  removeModel(id: ModelId): void {
    this.remove(this.selected.filter((selected) => selected.id === id));
    if (this.hovered?.id === id) {
      this.hover(undefined, undefined);
    }
  }

  dispose(): void {
    this.hover(undefined, undefined);
    this.clear(false);
  }

  private async describe(entry: Selected): Promise<void> {
    try {
      const { info, measure } = await describeEntity(modelOf(this.host, entry.id), entry);
      if (this.selected.includes(entry)) {
        entry.info = { ...info, id: `f${entry.key}` };
        entry.measure = measure;
        this.report();
      }
    } catch (error) {
      if (this.selected.includes(entry)) {
        this.remove([entry]);
        this.onError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private remove(entries: readonly Selected[], notify = true): void {
    if (entries.length === 0) {
      return;
    }
    const gone = new Set(entries);
    for (const entry of gone) {
      removeHighlight(this.host, entry.highlight);
    }
    this.selected = this.selected.filter((selected) => !gone.has(selected));
    this.host.requestRender();
    if (notify) {
      this.report();
    }
  }

  private report(): void {
    const described = this.selected.filter((selected) => selected.info);
    this.onChange({ features: described.map((selected) => selected.info!), totals: totals(described.map((selected) => selected.measure)) });
  }

  private highlightOf(picked: Picked, kind: 'selected' | 'hovered'): Highlight | undefined {
    const highlight = this.host.model(picked.id)?.parts.entityHighlight(picked.entity, kind, this.host.highlights);
    if (highlight) {
      this.host.overlays.add(highlight.object);
    }
    return highlight;
  }
}

/** Totals where they add up (D163): the summed length of two or more edges, the summed area of two or more faces. */
export function totals(measures: readonly (EntityMeasure | undefined)[]): MeasureRow[] {
  const rows: MeasureRow[] = [];
  const edges = measures.filter((measure) => measure?.kind === 'edge');
  const faces = measures.filter((measure) => measure?.kind === 'face');
  if (edges.length > 1) {
    rows.push({ name: `Total length (${edges.length} edges)`, value: length(edges.reduce((sum, edge) => sum + edge.length, 0)) });
  }
  if (faces.length > 1) {
    rows.push({ name: `Total area (${faces.length} faces)`, value: area(faces.reduce((sum, face) => sum + face.area, 0)) });
  }
  return rows;
}
