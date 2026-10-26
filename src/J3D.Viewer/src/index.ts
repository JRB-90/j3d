import type { PlanNode } from '@j3d/occt/facade';
import { afterPaint, saveFile } from './download';
import { decodeEdits } from './edit/edits-codec';
import { expandFileParts } from './edit/expand';
import type { ModelEdits } from './edit/structure';
import { fileInputAccept, kindOf } from './formats';
import { filesFromDataTransfer, filesFromInput } from './import/batch-files';
import { ModelManager } from './import/model-manager';
import type { BrepExportFormat } from './import/protocol';
import { createRunners } from './import/runners';
import type { BatchFile } from './import/sidecars';
import { ExportCancelledError, type ModelId, type ModelStats } from './import/types';
import type { DotNetObjectReference } from './interop';
import { forwardModelEvents } from './model-events';
import { ModelStore } from './store/model-store';
import type { StoredModel, StoredScene } from './store/types';
import { createTestHookControls, installTestHook, isTestHookEnabled } from './test-hook';
import { installTreeDrag } from './tree-drag';
import { installTreeKeys } from './tree-rows';
import type { Projection } from './view/camera-math';
import { installDropTarget } from './view/drop-target';
import { baseName } from './view/export-scene';
import type { MeshExportFormat } from './view/mesh-export';
import type { MoveFrame, MoveMode, MoveTarget } from './view/move';
import { Viewer, type SelectionMode } from './view/viewer';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from './formats';
export type { ModelFormat, ModelKind } from './formats';
export type { Projection } from './view/camera-math';
export type { StoredModel, StoredScene } from './store/types';
export type { BrepExportFormat } from './import/protocol';
export type { MeshExportFormat } from './view/mesh-export';
export type { SelectionMode } from './view/viewer';
export type { ModelEdits } from './edit/structure';

/** How an export ended (M9): the file saved, cancelled, or why it failed. Mirrors J3D.Web.Client/Interop/ExportOutcome.cs. */
export interface ExportOutcome {
  fileName?: string;
  cancelled?: boolean;
  error?: string;
}

/**
 * Expanded file parts' pieces (M15), each after its piece parent (-1: the part's new assembly), with
 * the file's name or "", and whether it draws something. Since M16 (D199) each part asked for comes
 * with the index of its pieces in `pieceSets`, sent once for the parts placing one definition (as a list
 * per part, the large plant's 840 took 145 ms for .NET to read). Mirrors J3D.Web.Client/Interop/ExpandOutcome.cs.
 */
export interface ExpandOutcome {
  nodes?: number[];
  sets?: number[];
  pieceSets?: { name: string; parent: number; part: boolean }[][];
  error?: string;
}

/** Mirrors J3D.Web.Client/Interop/ViewerCapabilities.cs. */
export interface ViewerCapabilities {
  webGl2: boolean;
  crossOriginIsolated: boolean;
}

export interface ViewerHandle {
  /** Imports the files picked in `input` (whose `accept` list is set from formats.ts). */
  attachFileInput(input: HTMLInputElement): void;
  /** Imports the files of a drop, expanding folders. Call it synchronously from the `drop` handler. */
  importDrop(dataTransfer: DataTransfer): Promise<void>;
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
  /** The models .NET lists, in order, for the manifest (D117). */
  setModelOrder(ids: string[]): void;
  /** Frames every model, keeping the view direction (the Fit all button; `F` is handled by the viewer). */
  fitAll(): void;
  /** Switches the camera, keeping the framing. */
  setProjection(projection: Projection): void;
  /** Applies a model's hidden and selected part nodes, which .NET owns (D95). */
  setPartState(id: string, hidden: number[], selected: number[]): void;
  /** Turns the Measure tool on or off (M7, D79), from the entity under the last right click when `fromContext` (D147, D164). */
  setMeasureMode(active: boolean, fromContext?: boolean): void;
  /** What a click selects: models, objects or features (M12, D146). */
  setSelectionMode(mode: SelectionMode): void;
  /** Drops the selected features (Esc, D146). */
  clearFeatures(): void;
  /**
   * The Move tool (M13, D149): its mode (null: off), the one object it moves (node -1: a whole model,
   * D169) and the frame its triad and fields use (D148).
   */
  setMoveTool(mode: MoveMode | null, target: MoveTarget | null, frame: MoveFrame): void;
  /** Gives a node (or a model, node -1) a placement in its parent's frame, column-major: a typed move, an undo or a redo (D145). */
  setPlacement(id: string, node: number, matrix: number[]): void;
  /** Draws origin frames at these objects (D150), or none. */
  setOriginFrames(targets: MoveTarget[]): void;
  /**
   * A model's tree as edited (M14): applies all its edits, which are kept with it, and returns what it
   * now draws, or null when nothing changed. Since M16 the edits arrive packed (edits-codec.ts, D199).
   */
  setStructure(id: string, numbers: Uint8Array, text: string): ModelStats | null;
  /** Saves the visible scene, or the selection, as GLB or STL: a download (M9, D119, D120). */
  exportMesh(format: MeshExportFormat, selection: boolean): Promise<ExportOutcome>;
  /**
   * Expands file parts of a BREP model in its worker (M15, D154): each one's pieces, for .NET's edit,
   * which then arrives as any other through `setStructure`.
   */
  expandParts(id: string, fileNodes: number[]): Promise<ExpandOutcome>;
  /**
   * Saves a BREP model as STEP or BREP, reporting progress to .NET's `OnExportProgress` (D83, D125):
   * as edited, or just its selection (M15, D145, D155).
   */
  exportModel(id: string, format: BrepExportFormat, selection?: boolean): Promise<ExportOutcome>;
  /** Stops a model's STEP or BREP export, whose `exportModel` then ends cancelled. */
  cancelExport(id: string): void;
  dispose(): void;
}

/**
 * Entry point called by the Blazor <c>Viewport</c> component: the Three.js view of every loaded
 * model (docs/plan.md §6.3) over the import pipeline (§6.2), whose model events go to .NET
 * (§6.4). Without WebGL2 the pipeline still runs but nothing is drawn; the component tells the
 * user. In the Development environment a test hook (`window.__j3dTest`) drives and observes
 * imports and the camera.
 */
export function createViewer(host: HTMLElement, dotnet: DotNetObjectReference): ViewerHandle {
  const capabilities = detectCapabilities();
  if (!capabilities.crossOriginIsolated) {
    // Only the multi-threaded OCCT build (not yet wired in, D40) needs it; imports still work.
    console.info("J3D: the page isn't cross-origin isolated, so OCCT can only run single-threaded.");
  }
  const store = new ModelStore({ locks: navigator.locks });
  // Camera changes are kept once the stored camera is back, so the default view doesn't replace it.
  let keepCamera = false;
  const view = capabilities.webGl2
    ? new Viewer(host, {
        onCameraChange: () => {
          if (keepCamera) {
            store.setCamera(view!.cameraSnapshot());
          }
        },
        // Picks and key commands go to .NET, which owns selection, visibility and undo (D95).
        onPick: (part, additive) => call(dotnet, 'OnPartPicked', part?.id ?? null, part?.node ?? -1, additive),
        onCommand: (command) => call(dotnet, 'OnViewerCommand', command),
        // The Measure tool's reference and result, and the selected features, go to .NET's panel (D146, D147).
        // The Move tool's target and its drags go to .NET's fields and undo history; drags are kept (M13, D145).
        onMoveTarget: (info) => call(dotnet, 'OnMoveTarget', info),
        onMoved: (target, before, after) => {
          store.setPlacement(target.id, target.node, after);
          call(dotnet, 'OnMoved', target.id, target.node, before, after);
        },
        onMeasureReference: (info) => call(dotnet, 'OnMeasureReference', info),
        onMeasureResult: (info) => call(dotnet, 'OnMeasureResult', info),
        onMeasureError: (message) => call(dotnet, 'OnMeasureFailed', message),
        onFeatures: (selection) => call(dotnet, 'OnFeaturesSelected', selection),
        onContextMenu: ({ x, y, part, canMeasure }) => call(dotnet, 'OnContextMenu', part?.id ?? null, part?.node ?? -1, x, y, canMeasure),
      })
    : undefined;
  const testControls = isTestHookEnabled() ? createTestHookControls() : undefined;
  const models = new ModelManager(
    createRunners({
      // KTX2 textures are transcoded to a format this renderer's GPU supports.
      ...(view ? { getRenderer: () => view.renderer } : {}),
      ...(testControls ? { occt: { holdBeforeImport: testControls.holdImports, onHeld: testControls.onHeld } } : {}),
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
  const undoable = new Set<ModelId>();
  const unsubscribeView = view
    ? models.subscribe({ loaded: (model) => view.add(model), removed: (id) => view.remove(id) })
    : undefined;
  const unsubscribeStore = models.subscribe({
    loaded: ({ summary, restored }) => {
      if (restored && !restored.edits && store.editsOf(summary.id)) {
        store.forgetEdits(summary.id); // they no longer fit it (R25): it's kept as imported
      }
      const sources = restored ? undefined : models.sourcesOf(summary.id);
      if (sources) {
        void store.save(summary, sources).then((outcome) => {
          if (outcome === 'full' || outcome === 'failed') {
            call(dotnet, 'OnModelNotKept', summary.id, outcome === 'full');
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
  const unsubscribeDotnet = forwardModelEvents(models, dotnet);
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
  const removeDropTarget = installDropTarget(host, (dataTransfer) => {
    importDrop(dataTransfer).catch((error: unknown) => console.error('J3D: the dropped files could not be read.', error));
  });
  // Nodes dragged in the model list's trees go to .NET, which owns the tree and its edits (M14, D182).
  const removeTreeDrag = installTreeDrag(document, ({ source, model, target, copy }) => call(dotnet, 'OnTreeDrop', source, model, target, copy));
  const removeTreeKeys = installTreeKeys(document);
  const removeTestHook = testControls ? installTestHook(models, testControls, attachFileInput, view, store) : undefined;

  host.dataset['viewerReady'] = 'true';
  void dotnet.invokeMethodAsync('OnViewerReady', capabilities);

  const handle: ViewerHandle = {
    attachFileInput(input) {
      attachFileInput(input);
    },
    importDrop,
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
        const summary = { ...listed, kind: kindOf(listed.format) }; // .NET doesn't send the kind
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
    clearFeatures() {
      view?.clearFeatures();
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
    setStructure(id, numbers, text) {
      const edits = decodeEdits(numbers, text);
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
        // .NET makes the edit as this returns: its item's "Expanding…" (D199) is painted first.
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
    async exportModel(id, format, selection = false) {
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
        if (testControls?.holdExports()) {
          await new Promise((resolve) => controller.signal.addEventListener('abort', resolve, { once: true }));
        }
        const bytes = await exporter.export(format, {
          ...(plan ? { plan } : {}),
          signal: controller.signal,
          onProgress: (fraction) => call(dotnet, 'OnExportProgress', id, fraction),
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
      // Once only: a page going for good disposes it before .NET's component might.
      if (disposed) {
        return;
      }
      disposed = true;
      exports.forEach((controller) => controller.abort());
      removeTestHook?.();
      removeTreeDrag();
      removeTreeKeys();
      removeDropTarget();
      for (const detach of [...inputs.values()]) {
        detach();
      }
      unsubscribeView?.();
      unsubscribeStore();
      unsubscribeDotnet();
      window.removeEventListener('pagehide', onPageHide);
      store.dispose();
      models.dispose();
      view?.dispose();
      delete host.dataset['viewerReady'];
    },
  };
  return handle;
}

/** Copies a measurement value to the clipboard (M7, D87). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export { revealTreeRow } from './tree-rows';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function call(dotnet: DotNetObjectReference, method: string, ...args: unknown[]): void {
  dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
}

export function detectCapabilities(): ViewerCapabilities {
  const gl = document.createElement('canvas').getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return {
    webGl2: gl !== null,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  };
}
