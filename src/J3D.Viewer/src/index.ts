import { fileInputAccept } from './formats';
import { filesFromDataTransfer, filesFromInput } from './import/batch-files';
import { ModelManager } from './import/model-manager';
import { createRunners } from './import/runners';
import type { DotNetObjectReference } from './interop';
import { createTestHookControls, installTestHook, isTestHookEnabled } from './test-hook';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from './formats';
export type { ModelFormat, ModelKind } from './formats';

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
  dispose(): void;
}

/**
 * Entry point called by the Blazor <c>Viewport</c> component.
 *
 * M2 stage: the import pipeline runs headless (decision D39). Imported models are kept by the
 * {@link ModelManager}; the Three.js scene arrives in M3 and the .NET model list in M4. In the
 * Development environment a test hook (`window.__j3dTest`) drives and observes imports.
 */
export function createViewer(host: HTMLElement, dotnet: DotNetObjectReference): ViewerHandle {
  const testControls = isTestHookEnabled() ? createTestHookControls() : undefined;
  const models = new ModelManager(
    createRunners(testControls ? { occt: { holdBeforeImport: testControls.holdImports, onHeld: testControls.onHeld } } : {}),
  );

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

  const removeTestHook = testControls ? installTestHook(models, testControls, attachFileInput) : undefined;

  host.dataset['viewerReady'] = 'true';
  void dotnet.invokeMethodAsync('OnViewerReady', detectCapabilities());

  return {
    attachFileInput(input) {
      attachFileInput(input);
    },
    async importDrop(dataTransfer) {
      models.importFiles(await filesFromDataTransfer(dataTransfer));
    },
    removeModel(id) {
      models.remove(id);
    },
    dispose() {
      removeTestHook?.();
      for (const detach of [...inputs.values()]) {
        detach();
      }
      models.dispose();
      delete host.dataset['viewerReady'];
    },
  };
}

export function detectCapabilities(): ViewerCapabilities {
  const gl = document.createElement('canvas').getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return {
    webGl2: gl !== null,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  };
}
