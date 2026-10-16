import { fileInputAccept, kindOf } from './formats';
import { filesFromDataTransfer, filesFromInput } from './import/batch-files';
import { ModelManager } from './import/model-manager';
import { createRunners } from './import/runners';
import type { BatchFile } from './import/sidecars';
import type { ModelId } from './import/types';
import type { DotNetObjectReference } from './interop';
import { forwardModelEvents } from './model-events';
import { ModelStore } from './store/model-store';
import type { StoredModel, StoredScene } from './store/types';
import { createTestHookControls, installTestHook, isTestHookEnabled } from './test-hook';
import type { Projection } from './view/camera-math';
import { installDropTarget } from './view/drop-target';
import { Viewer } from './view/viewer';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from './formats';
export type { ModelFormat, ModelKind } from './formats';
export type { Projection } from './view/camera-math';
export type { StoredModel, StoredScene } from './store/types';

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
   * or, `undoable`, deletes a model an undo can bring back, keeping its files and measurements (D84).
   */
  removeModel(id: string, undoable?: boolean): void;
  /** What was kept when the page opened, once the stored camera is applied (D82, D111). */
  restoreScene(): Promise<StoredScene>;
  /** Imports models again from their kept files, under their old ids: a reload or an undone delete (D117). */
  restoreModels(models: StoredModel[]): void;
  /** Drops a deleted model's kept files and measurements: no undo can bring it back now. */
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
  /** Turns the Measure tool on or off (M7, D79). */
  setMeasureMode(active: boolean): void;
  /** Shows exactly these kept measurements (D108). */
  setMeasurements(shown: string[]): void;
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
        // The Measure tool's results go to .NET, which lists them and owns their undo (M7).
        onMeasurePending: (info) => call(dotnet, 'OnMeasurePending', info),
        onMeasured: (info) => call(dotnet, 'OnMeasured', info),
        onMeasureError: (message) => call(dotnet, 'OnMeasureFailed', message),
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
    ? models.subscribe({ loaded: (model) => view.add(model), removed: (id) => view.remove(id, undoable.has(id)) })
    : undefined;
  const unsubscribeStore = models.subscribe({
    loaded: ({ summary, restored }) => {
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
  const flushStore = () => store.flush();
  window.addEventListener('pagehide', flushStore);

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
  const removeTestHook = testControls ? installTestHook(models, testControls, attachFileInput, view, store) : undefined;

  host.dataset['viewerReady'] = 'true';
  void dotnet.invokeMethodAsync('OnViewerReady', capabilities);

  return {
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
        view?.remove(id, isUndoable);
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
        models.importStored(summary, files, hidden);
      }
    },
    forgetModel(id) {
      keptSources.delete(id);
      store.delete(id);
      view?.forgetModel(id);
    },
    clearAll() {
      for (const { summary } of models.models) {
        models.remove(summary.id);
      }
      keptSources.clear();
      store.clear();
      view?.forgetMeasurements();
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
    setMeasureMode(active) {
      view?.setMeasureMode(active);
    },
    setMeasurements(shown) {
      view?.setMeasurements(shown);
    },
    dispose() {
      removeTestHook?.();
      removeDropTarget();
      for (const detach of [...inputs.values()]) {
        detach();
      }
      unsubscribeView?.();
      unsubscribeStore();
      unsubscribeDotnet();
      window.removeEventListener('pagehide', flushStore);
      store.dispose();
      models.dispose();
      view?.dispose();
      delete host.dataset['viewerReady'];
    },
  };
}

/** Copies a measurement value to the clipboard (M7, D87). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Scrolls an element into view if it isn't, e.g. a tree node a 3D pick revealed (D96). */
export function scrollIntoView(selector: string): void {
  document.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
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
