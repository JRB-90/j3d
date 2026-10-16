import { fileInputAccept } from './formats';
import { filesFromDataTransfer, filesFromInput } from './import/batch-files';
import { ModelManager } from './import/model-manager';
import { createRunners } from './import/runners';
import type { DotNetObjectReference } from './interop';
import { forwardModelEvents } from './model-events';
import { createTestHookControls, installTestHook, isTestHookEnabled } from './test-hook';
import type { Projection } from './view/camera-math';
import { installDropTarget } from './view/drop-target';
import { Viewer } from './view/viewer';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from './formats';
export type { ModelFormat, ModelKind } from './formats';
export type { Projection } from './view/camera-math';

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
  /** Cancels an import, deletes a loaded model or dismisses a failed one. */
  removeModel(id: string): void;
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
  const view = capabilities.webGl2
    ? new Viewer(host, {
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
  const unsubscribeView = view
    ? models.subscribe({ loaded: (model) => view.add(model), removed: (id) => view.remove(id) })
    : undefined;
  const unsubscribeDotnet = forwardModelEvents(models, dotnet);

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
  const removeTestHook = testControls ? installTestHook(models, testControls, attachFileInput, view) : undefined;

  host.dataset['viewerReady'] = 'true';
  void dotnet.invokeMethodAsync('OnViewerReady', capabilities);

  return {
    attachFileInput(input) {
      attachFileInput(input);
    },
    importDrop,
    removeModel(id) {
      models.remove(id);
    },
    fitAll() {
      view?.fitAll();
    },
    setProjection(projection) {
      view?.setProjection(projection);
    },
    setPartState(id, hidden, selected) {
      view?.setPartState(id, hidden, selected);
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
      unsubscribeDotnet();
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
