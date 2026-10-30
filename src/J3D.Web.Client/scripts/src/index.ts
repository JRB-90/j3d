import { createViewer as createPackageViewer, type BrepExportFormat, type CreateViewerOptions, type ViewerHandle } from '@j3d/viewer';
import { createViewerWithTestHook, isTestHookEnabled } from '@j3d/viewer/testing';
import { decodeEdits } from './edits-codec.js';
import type { DotNetObjectReference } from './interop.js';
import { forwardModelEvents } from './model-events.js';
import { installTreeDrag } from './tree-drag.js';
import { installTreeKeys } from './tree-rows.js';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from '@j3d/viewer';

/** The handle as .NET's `ViewerInterop` calls it: edits arrive packed, and export progress comes to .NET. */
export interface BlazorViewerHandle extends Omit<ViewerHandle, 'setStructure' | 'exportModel'> {
  /** Since M16 the edits arrive packed (edits-codec.ts, D199). */
  setStructure(id: string, numbers: Uint8Array, text: string): ReturnType<ViewerHandle['setStructure']>;
  /** Reports progress to .NET's `OnExportProgress` (D83, D125). */
  exportModel(id: string, format: BrepExportFormat, selection?: boolean): ReturnType<ViewerHandle['exportModel']>;
}

/**
 * Entry point called by the Blazor <c>Viewport</c> component: `@j3d/viewer`, with its callbacks sent to
 * .NET (docs/plan.md §6.4), which owns selection, visibility and undo (D95). In the Development
 * environment a test hook (`window.__j3dTest`) drives and observes imports and the camera.
 */
export function createViewer(host: HTMLElement, dotnet: DotNetObjectReference): BlazorViewerHandle {
  const options: CreateViewerOptions = {
    // J3D is the page: its keys work wherever they're pressed, and its models are kept (D256).
    keys: 'page',
    keep: { name: 'j3d' },
    keyFilter,
    onProjectionChange: (projection) => call(dotnet, 'OnProjectionChanged', projection),
    onPick: (part, additive) => call(dotnet, 'OnPartPicked', part?.id ?? null, part?.node ?? -1, additive),
    onCommand: (command) => call(dotnet, 'OnViewerCommand', command),
    // The Measure tool's reference and result, and the selected features, go to .NET's panel (D146, D147).
    // The Move tool's target and its drags go to .NET's fields and undo history (M13, D145).
    onMoveTarget: (info) => call(dotnet, 'OnMoveTarget', info),
    onMoved: (target, before, after) => call(dotnet, 'OnMoved', target.id, target.node, before, after),
    onMeasureReference: (info) => call(dotnet, 'OnMeasureReference', info),
    onMeasureResult: (info) => call(dotnet, 'OnMeasureResult', info),
    onMeasureError: (message) => call(dotnet, 'OnMeasureFailed', message),
    onFeatures: (selection) => call(dotnet, 'OnFeaturesSelected', selection),
    onContextMenu: ({ x, y, part, canMeasure }) => call(dotnet, 'OnContextMenu', part?.id ?? null, part?.node ?? -1, x, y, canMeasure),
    onModelNotKept: (id, full) => call(dotnet, 'OnModelNotKept', id, full),
  };
  const viewer = isTestHookEnabled() ? createViewerWithTestHook(host, options) : createPackageViewer(host, options);
  const unsubscribeDotnet = forwardModelEvents(viewer, dotnet);
  // Nodes dragged in the model list's trees go to .NET, which owns the tree and its edits (M14, D182).
  const removeTreeDrag = installTreeDrag(document, ({ source, model, target, copy }) => call(dotnet, 'OnTreeDrop', source, model, target, copy));
  const removeTreeKeys = installTreeKeys(document);

  host.dataset['viewerReady'] = 'true';
  void dotnet.invokeMethodAsync('OnViewerReady', viewer.capabilities());

  return {
    ...viewer,
    setStructure(id, numbers, text) {
      return viewer.setStructure(id, decodeEdits(numbers, text));
    },
    exportModel(id, format, selection = false) {
      return viewer.exportModel(id, format, { selection, onProgress: (fraction) => call(dotnet, 'OnExportProgress', id, fraction) });
    },
    dispose() {
      removeTreeDrag();
      removeTreeKeys();
      unsubscribeDotnet();
      viewer.dispose();
      delete host.dataset['viewerReady'];
    },
  };
}

/** Copies a measurement value to the clipboard (M7, D87). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export { revealTreeRow } from './tree-rows.js';
export { watchLayout } from './shell.js';

/**
 * A menu is open over the page: its keys are the menu's, and Escape closes it rather than clearing the
 * selection or ending a tool behind it.
 */
function keyFilter(event: KeyboardEvent): boolean {
  if (!openMenu()) {
    return false;
  }
  if (event.key === 'Escape') {
    closeMenu();
  }
  return true;
}

/**
 * A menu open in MudBlazor's popover layer, which it draws with an overlay that closes it when clicked.
 * Tooltips use the same layer, so only a list counts.
 */
function openMenu(): Element | null {
  return document.querySelector('.mud-popover-open .mud-list');
}

/** Closes the open menu as a click beside it would. */
function closeMenu(): void {
  const overlay = document.querySelector('.mud-overlay');
  if (overlay instanceof HTMLElement) {
    overlay.click();
  }
}

function call(dotnet: DotNetObjectReference, method: string, ...args: unknown[]): void {
  dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
}
