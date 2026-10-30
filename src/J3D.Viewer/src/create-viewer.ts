import type { PlanNode } from '@j3d/occt/facade';
import { afterPaint, saveFile } from './download.js';
import { addArrival } from './edit/arrive.js';
import { expandFileParts } from './edit/expand.js';
import type { ModelEdits } from './edit/structure.js';
import { fileInputAccept, kindOf } from './formats.js';
import { filesFromDataTransfer, filesFromInput, filesFromList } from './import/batch-files.js';
import { ModelManager, type ModelEntry, type ModelManagerListener } from './import/model-manager.js';
import { createRunners } from './import/runners.js';
import type { BatchFile } from './import/sidecars.js';
import { ExportCancelledError, type BrepExportFormat, type ModelId, type ModelStats, type ModelSummary } from './import/types.js';
import { ModelStore } from './store/model-store.js';
import type { StoredModel, StoredScene } from './store/types.js';
import type { Projection } from './view/camera-math.js';
import { installDropTarget } from './view/drop-target.js';
import { baseName } from './view/export-scene.js';
import type { MeshExportFormat } from './view/mesh-export.js';
import type { MoveFrame, MoveMode, MoveTarget } from './view/move.js';
import { Viewer, type SelectionMode, type ViewerOptions } from './view/viewer.js';

/** How an export ended (M9): the file saved, cancelled, or why it failed. Mirrors J3D.Blazor/Interop/ExportOutcome.cs. */
export interface ExportOutcome {
  /** The file saved. */
  fileName?: string;
  /** The export was stopped. */
  cancelled?: boolean;
  /** Why it failed. */
  error?: string;
}

/**
 * Expanded file parts' pieces (M15), each after its piece parent (-1: the part's new assembly), with
 * the file's name or "", and whether it draws something. Since M16 (D199) each part asked for comes
 * with the index of its pieces in `pieceSets`, sent once for the parts placing one definition (as a list
 * per part, the large plant's 840 took 145 ms for .NET to read). Mirrors J3D.Blazor/Interop/ExpandOutcome.cs.
 */
export interface ExpandOutcome {
  nodes?: number[];
  sets?: number[];
  pieceSets?: { name: string; parent: number; part: boolean }[][];
  /** Why it failed. */
  error?: string;
}

/**
 * Objects moved or copied to another model (M18, D225, D227): the arrival the caller's edit takes in, or
 * why there's none. `nodes` are the arrival's nodes after its own assembly, in tree order: each one's
 * arrival parent (0 for the objects themselves), its name, whether it draws, whether Expand would split
 * it (D190) and whether it was hidden (D229). Mirrors J3D.Blazor/Interop/TransferOutcome.cs.
 */
export interface TransferOutcome {
  /** The arrival's file, kept with the target model. */
  file?: string;
  /** How many objects it brought. */
  count?: number;
  nodes?: { parent: number; name: string; part: boolean; expandable: boolean; hidden: boolean }[];
  /** The target model isn't kept, or its storage was full: it has the objects this visit only. */
  notKept?: 'full' | 'failed';
  /** Why it failed. */
  error?: string;
}

/** What the browser gives the viewer. Mirrors J3D.Blazor/Interop/ViewerCapabilities.cs. */
export interface ViewerCapabilities {
  /** The viewer can draw. Without it imports still run and nothing shows. */
  webGl2: boolean;
  /** The page is cross-origin isolated, which lets a STEP or BREP export stop part-way. Without it a stopped export finishes in its worker and its result is dropped. */
  crossOriginIsolated: boolean;
}

/** What {@link createViewer} takes: the view's options, with keeping models and dropping files. */
export interface CreateViewerOptions extends ViewerOptions {
  /**
   * Keeps models in the browser's private storage across visits (D82), in a folder named `name`, so that
   * viewers on one origin keep apart (D256). Off by default: without it nothing is written, and
   * `restoreScene` finds nothing.
   */
  keep?: { name: string };
  /** Files dropped on the viewer import (D267). On by default. */
  dropFiles?: boolean;
  /** A loaded model couldn't be copied into the store: `full`, or some other failure. */
  onModelNotKept?: (id: ModelId, full: boolean) => void;
}

/** What {@link createViewer} gives: how a page drives the viewer. */
export interface ViewerHandle {
  /** Imports files, each by its name, with any sidecars among them (D269). */
  importFiles(files: Iterable<File>): ModelSummary[];
  /** Imports the files picked in `input`, whose `accept` list it sets. Returns how to stop. */
  attachFileInput(input: HTMLInputElement): () => void;
  /** Imports the files of a drop, expanding folders. Call it synchronously from the `drop` handler. */
  importDrop(dataTransfer: DataTransfer): Promise<void>;
  /** Watches models being queued, imported, loaded, failed and removed, and files turned away. Returns how to stop. */
  subscribe(listener: ModelManagerListener): () => void;
  /** Every model and how it stands. */
  models(): ModelEntry[];
  /** What the browser gives the viewer. */
  capabilities(): ViewerCapabilities;
  /**
   * Cancels an import, deletes a loaded model or dismisses a failed one, and with it its kept files;
   * or, `undoable`, deletes a model an undo can bring back, keeping its files (D84).
   */
  removeModel(id: string, undoable?: boolean): void;
  /** What was kept when the page opened, once the stored camera is applied (D82, D111). */
  restoreScene(): Promise<StoredScene>;
  /** Imports models again from their kept files, under their old ids: a reload or an undone delete (D117). */
  restoreModels(models: StoredModel[]): void;
  /** Drops a deleted model's kept files: no undo can bring it back now. */
  forgetModel(id: string): void;
  /** Removes every model and everything kept (D110). */
  clearAll(): void;
  /** The models in list order, for the manifest (D117). */
  setModelOrder(ids: string[]): void;
  /** Frames every model, keeping the view direction (the Fit all button; `F` is handled by the viewer). */
  fitAll(): void;
  /** The isometric view, framing everything. */
  home(): void;
  /** One step back through the camera's views (D209). */
  previousView(): void;
  /** One step forward through the camera's views (D209). */
  nextView(): void;
  /** Switches the camera, keeping the framing. */
  setProjection(projection: Projection): void;
  /** Applies a model's hidden and selected part nodes, which the caller owns (D95, D250). */
  setPartState(id: string, hidden: number[], selected: number[]): void;
  /** Turns the Measure tool on or off (M7, D79), from the entity under the last right click when `fromContext` (D147, D164). */
  setMeasureMode(active: boolean, fromContext?: boolean): void;
  /** What a click selects: models, objects or features (M12, D146). */
  setSelectionMode(mode: SelectionMode): void;
  /** Whether taps and clicks add to the selection or take from it, as Ctrl+click does: the Add toggle (M19, D237). */
  setAddMode(on: boolean): void;
  /** Drops the selected features (Esc, D146). */
  clearFeatures(): void;
  /** Selects the features a report's keys name (M17, D219): an undone or redone selection. */
  restoreFeatures(keys: string): void;
  /**
   * The Move tool (M13, D149): its mode (null: off), the one object it moves (node -1: a whole model,
   * D169) and the frame its triad and fields use (D148).
   */
  setMoveTool(mode: MoveMode | null, target: MoveTarget | null, frame: MoveFrame): void;
  /** Gives a node (or a model, node -1) a placement in its parent's frame, column-major: a typed move, an undo or a redo (D145). */
  setPlacement(id: string, node: number, matrix: number[]): void;
  /** Draws origin frames at these objects (D150), or none. */
  setOriginFrames(targets: MoveTarget[]): void;
  /** A model's tree as edited (M14): applies all its edits, which are kept with it, and returns what it now draws, or null when nothing changed. */
  setStructure(id: string, edits: ModelEdits): ModelStats | null;
  /** Saves the visible scene, or the selection, as GLB or STL: a download (M9, D119, D120). */
  exportMesh(format: MeshExportFormat, selection: boolean): Promise<ExportOutcome>;
  /** Expands file parts of a BREP model in its worker (M15, D154): each one's pieces, for the caller's edit, which then arrives through `setStructure`. */
  expandParts(id: string, fileNodes: number[]): Promise<ExpandOutcome>;
  /** Saves a BREP model as STEP or BREP (D83, D125): as edited, or just its selection (M15, D145, D155). */
  exportModel(id: string, format: BrepExportFormat, options?: { selection?: boolean; onProgress?: (fraction: number | null) => void }): Promise<ExportOutcome>;
  /** Stops a model's STEP or BREP export, whose `exportModel` then ends cancelled. */
  cancelExport(id: string): void;
  /**
   * Writes objects of one model and reads them into another of the same kind (M18, D210, D225, D227),
   * keeping the file with it: the caller then makes the edit, which arrives through `setStructure`.
   */
  transfer(sourceId: string, nodes: number[], targetId: string): Promise<TransferOutcome>;
  /** Stops the viewer and its workers, and takes back what it added to the page. */
  dispose(): void;
}

/** What J3D's own tests hold imports and exports with. */
export interface ViewerTestControls {
  holdImports: () => boolean;
  onHeld: (fileName: string) => void;
  holdExports: () => boolean;
}

/** A viewer's handle, and what J3D's own test hook reads behind it. */
export interface ViewerParts {
  handle: ViewerHandle;
  models: ModelManager;
  view: Viewer | undefined;
  store: ModelStore;
}

/**
 * The Three.js view of every loaded model (docs/plan.md §6.3) over the import pipeline (§6.2), in `host`,
 * which it fills. The caller owns selection, visibility, undo and the edited tree (D250): picks and
 * commands come to its callbacks, and what they lead to goes back through the handle. Without WebGL2 the
 * pipeline still runs but nothing is drawn, which `capabilities()` tells it.
 */
export function createViewer(host: HTMLElement, options: CreateViewerOptions = {}): ViewerHandle {
  return createViewerParts(host, options).handle;
}

export function createViewerParts(host: HTMLElement, options: CreateViewerOptions, testing?: ViewerTestControls): ViewerParts {
  const capabilities = detectCapabilities();
  const store = new ModelStore({ locks: navigator.locks, ...(options.keep ? { name: options.keep.name } : { off: true }) });
  // Camera changes are kept once the stored camera is back, so the default view doesn't replace it.
  let keepCamera = false;
  const view = capabilities.webGl2
    ? new Viewer(host, {
        ...options,
        onCameraChange: () => {
          if (keepCamera) {
            store.setCamera(view!.cameraSnapshot());
          }
          options.onCameraChange?.();
        },
        // Drags are kept (M13, D145).
        onMoved: (target, before, after) => {
          store.setPlacement(target.id, target.node, after);
          options.onMoved?.(target, before, after);
        },
      })
    : undefined;
  const models = new ModelManager(
    createRunners({
      // KTX2 textures are transcoded to a format this renderer's GPU supports.
      ...(view ? { getRenderer: () => view.renderer } : {}),
      ...(testing ? { occt: { holdBeforeImport: testing.holdImports, onHeld: testing.onHeld } } : {}),
    }),
  );
  const opened = store.opened.then((scene) => {
    if (scene.camera) {
      view?.restoreCamera(scene.camera);
    }
    keepCamera = true;
    return scene;
  });

  // A deleted model's files, kept for an undo (D84): the store's copy is preferred, and these serve
  // where there is none (another tab holds the store, or it was full). Dropped when it's forgotten.
  const keptSources = new Map<ModelId, BatchFile[]>();
  // A restored model's arrivals (M18) are read from its folder; a mesh model's are read into objects.
  models.arrivalReaders = {
    read: (id, file) => store.readArrival(id, file),
    readMesh: async (file) => (await import('./view/mesh-arrival.js')).readMeshArrival(file),
  };
  const undoable = new Set<ModelId>();
  const unsubscribeView = view
    ? models.subscribe({ loaded: (model) => view.add(model), removed: (id) => view.remove(id) })
    : undefined;
  const unsubscribeStore = models.subscribe({
    loaded: ({ summary, restored }) => {
      if (restored && !restored.edits && store.editsOf(summary.id)) {
        store.forgetEdits(summary.id); // they no longer fit it (R25): it's kept as imported
      }
      if (restored) {
        store.pruneArrivals(summary.id, restored.edits?.arrivals?.map(({ file }) => file) ?? []); // D246
      }
      const sources = restored ? undefined : models.sourcesOf(summary.id);
      if (sources) {
        void store.save(summary, sources).then((outcome) => {
          if (outcome === 'full' || outcome === 'failed') {
            options.onModelNotKept?.(summary.id, outcome === 'full');
          }
        });
      }
    },
    removed: (id) => {
      if (!undoable.delete(id)) {
        keptSources.delete(id);
        store.delete(id);
      }
    },
  });
  // STEP and BREP exports in progress, by model (M9).
  const exports = new Map<ModelId, AbortController>();
  // A page kept for going back only writes what's waiting; one going for good also gives back its
  // WebGL context and workers at once. Firefox kept each reloaded page's viewer, context and all,
  // until 25 reloads of the expanded plant ran out of memory (M16).
  let disposed = false;
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) {
      store.flush();
    } else {
      handle.dispose();
    }
  };
  window.addEventListener('pagehide', onPageHide);

  const inputs = new Map<HTMLInputElement, () => void>();
  const attachFileInput = (input: HTMLInputElement): (() => void) => {
    inputs.get(input)?.();
    input.accept = fileInputAccept;
    const onChange = () => {
      models.importFiles(filesFromInput(input));
      input.value = ''; // so picking the same file again still raises `change`
    };
    input.addEventListener('change', onChange);
    const detach = () => {
      input.removeEventListener('change', onChange);
      inputs.delete(input);
    };
    inputs.set(input, detach);
    return detach;
  };

  const importDrop = async (dataTransfer: DataTransfer) => {
    models.importFiles(await filesFromDataTransfer(dataTransfer));
  };
  const removeDropTarget =
    (options.dropFiles ?? true)
      ? installDropTarget(host, (dataTransfer) => {
          importDrop(dataTransfer).catch((error: unknown) => console.error('J3D: the dropped files could not be read.', error));
        })
      : undefined;

  const handle: ViewerHandle = {
    importFiles(files) {
      return models.importFiles(filesFromList(files));
    },
    attachFileInput,
    importDrop,
    subscribe(listener) {
      return models.subscribe(listener);
    },
    models() {
      return models.models;
    },
    capabilities() {
      return capabilities;
    },
    removeModel(id, isUndoable = false) {
      if (isUndoable) {
        const sources = models.sourcesOf(id);
        if (sources) {
          keptSources.set(id, sources);
        }
        undoable.add(id);
      }
      if (!models.remove(id)) {
        undoable.delete(id);
        view?.remove(id);
      }
    },
    restoreScene() {
      return opened;
    },
    restoreModels(stored) {
      for (const { summary: listed, hidden } of stored) {
        const summary = { ...listed, kind: kindOf(listed.format) }; // a stored list needn't carry the kind
        const kept = keptSources.get(summary.id);
        const files = store.has(summary.id)
          ? store.load(summary.id).catch((error: unknown) => kept ?? Promise.reject(error))
          : kept
            ? Promise.resolve(kept)
            : Promise.reject(new Error(`${summary.fileName} wasn't kept.`));
        models.importStored(summary, files, hidden, store.placementsOf(summary.id), store.editsOf(summary.id));
      }
    },
    forgetModel(id) {
      keptSources.delete(id);
      store.delete(id);
    },
    clearAll() {
      for (const { summary } of models.models) {
        models.remove(summary.id);
      }
      keptSources.clear();
      store.clear();
    },
    setModelOrder(ids) {
      store.setOrder(ids);
    },
    fitAll() {
      view?.fitAll();
    },
    home() {
      view?.home();
    },
    previousView() {
      view?.previousView();
    },
    nextView() {
      view?.nextView();
    },
    setProjection(projection) {
      view?.setProjection(projection);
    },
    setPartState(id, hidden, selected) {
      view?.setPartState(id, hidden, selected);
      store.setHidden(id, hidden);
    },
    setMeasureMode(active, fromContext = false) {
      view?.setMeasureMode(active, fromContext);
    },
    setSelectionMode(mode) {
      view?.setSelectionMode(mode);
    },
    setAddMode(on) {
      view?.setAddMode(on);
    },
    clearFeatures() {
      view?.clearFeatures();
    },
    restoreFeatures(keys) {
      view?.restoreFeatures(keys);
    },
    setMoveTool(mode, target, frame) {
      view?.setMoveTool(mode, target ?? undefined, frame);
    },
    setPlacement(id, node, matrix) {
      view?.setPlacement(id, node, matrix);
      store.setPlacement(id, node, matrix);
    },
    setOriginFrames(targets) {
      view?.setOriginFrames(targets);
    },
    setStructure(id, edits) {
      store.setEdits(id, edits);
      const applied = view?.setStructure(id, edits);
      // Nodes that changed parents, and copies, are kept where they now are, in their parents' frames.
      applied?.placements.forEach(({ node, matrix }) => store.setPlacement(id, node, matrix));
      return applied?.stats ?? null;
    },
    async exportMesh(format, selection) {
      if (!view) {
        return { error: "This browser can't show models, so there's nothing to export." };
      }
      try {
        await afterPaint();
        const { fileName, bytes } = await view.exportMesh(format, selection);
        saveFile(bytes, fileName);
        return { fileName };
      } catch (error) {
        console.error('J3D: the export failed.', error);
        return { error: messageOf(error) };
      }
    },
    async expandParts(id, fileNodes) {
      const model = models.models.find(({ summary }) => summary.id === id)?.model;
      if (!model) {
        return { error: "The model isn't loaded." };
      }
      try {
        const expansions = await expandFileParts(model.content, fileNodes);
        // The caller makes the edit as this returns: its item's "Expanding…" (D199) is painted first.
        await afterPaint();
        const pieceSets: { name: string; parent: number; part: boolean }[][] = [];
        const setOf = new Map<string, number>();
        const sets = fileNodes.map((node) => {
          const pieces = (expansions.get(node) ?? []).map(({ name, parent, prototype }) => ({ name, parent, part: prototype >= 0 }));
          const key = JSON.stringify(pieces);
          let set = setOf.get(key);
          if (set === undefined) {
            set = pieceSets.push(pieces) - 1;
            setOf.set(key, set);
          }
          return set;
        });
        return { nodes: fileNodes, sets, pieceSets };
      } catch (error) {
        console.error(`J3D: expanding parts of ${model.summary.fileName} failed.`, error);
        return { error: messageOf(error) };
      }
    },
    async transfer(sourceId, nodes, targetId) {
      const source = models.models.find(({ summary }) => summary.id === sourceId)?.model;
      const target = models.models.find(({ summary }) => summary.id === targetId)?.model;
      if (!view || !source || !target) {
        return { error: "The model isn't loaded." };
      }
      if (source.content.kind !== target.content.kind) {
        return { error: 'Objects move only between CAD models, or between mesh models.' };
      }
      try {
        const out = await view.transferOut(sourceId, nodes, targetId);
        let bytes: Blob;
        if (out.plan) {
          const exporter = source.content.kind === 'brep' ? source.content.exporter : undefined;
          if (!exporter) {
            return { error: "The model can't be written." };
          }
          bytes = new Blob([await exporter.export('step', { plan: out.plan })]);
        } else {
          bytes = new Blob([out.glb!]);
        }
        const file = `arrival-${crypto.randomUUID()}.${out.plan ? 'step' : 'glb'}`;
        const kept = view.editsOf(targetId)?.arrivals ?? [];
        const arrival = await addArrival(target.content, target.tree.length, kept, file, bytes, async (blob) =>
          (await import('./view/mesh-arrival.js')).readMeshArrival(blob),
        );
        if (arrival.nodes.length !== out.order.length + 1) {
          return { error: "The objects didn't arrive whole." };
        }
        const stored = await store.keepArrival(targetId, file, bytes);
        // The caller makes the edit as this returns: its item's "Bringing…" (D233) is painted first.
        await afterPaint();
        return {
          file,
          count: arrival.nodes.length,
          nodes: arrival.nodes.slice(1).map((node, index) => ({
            parent: node.parent,
            name: node.name,
            part: node.prototype >= 0,
            expandable: (node.pieces ?? 0) >= 2,
            hidden: out.hidden.has(out.order[index]!),
          })),
          ...(stored === 'full' || stored === 'failed' ? { notKept: stored } : {}),
        };
      } catch (error) {
        console.error('J3D: objects couldn’t be moved between models.', error);
        return { error: messageOf(error) };
      }
    },
    async exportModel(id, format, { selection = false, onProgress } = {}) {
      const model = models.models.find(({ summary }) => summary.id === id)?.model;
      const exporter = model?.content.kind === 'brep' ? model.content.exporter : undefined;
      if (!model || !exporter) {
        return { error: "The model isn't loaded." };
      }
      let plan: PlanNode[] | undefined;
      try {
        plan = view?.exportPlan(id, selection);
      } catch (error) {
        return { error: messageOf(error) };
      }
      exports.get(id)?.abort();
      const controller = new AbortController();
      exports.set(id, controller);
      try {
        if (testing?.holdExports()) {
          await new Promise((resolve) => controller.signal.addEventListener('abort', resolve, { once: true }));
        }
        const bytes = await exporter.export(format, {
          ...(plan ? { plan } : {}),
          signal: controller.signal,
          ...(onProgress ? { onProgress } : {}),
        });
        const fileName = `${baseName(model.summary.fileName)}.${format}`;
        saveFile(bytes, fileName);
        return { fileName };
      } catch (error) {
        if (error instanceof ExportCancelledError) {
          return { cancelled: true };
        }
        console.error(`J3D: exporting ${model.summary.fileName} failed.`, error);
        return { error: messageOf(error) };
      } finally {
        if (exports.get(id) === controller) {
          exports.delete(id);
        }
      }
    },
    cancelExport(id) {
      exports.get(id)?.abort();
    },
    dispose() {
      // Once only: a page going for good disposes it before its owner might.
      if (disposed) {
        return;
      }
      disposed = true;
      exports.forEach((controller) => controller.abort());
      removeDropTarget?.();
      for (const detach of [...inputs.values()]) {
        detach();
      }
      unsubscribeView?.();
      unsubscribeStore();
      window.removeEventListener('pagehide', onPageHide);
      store.dispose();
      models.dispose();
      view?.dispose();
    },
  };
  return { handle, models, view, store };
}

/** What this browser gives a viewer, with none created. */
export function detectCapabilities(): ViewerCapabilities {
  const gl = document.createElement('canvas').getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return {
    webGl2: gl !== null,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
