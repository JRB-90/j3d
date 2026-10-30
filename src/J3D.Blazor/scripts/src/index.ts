import { createViewer as createPackageViewer, type BrepExportFormat, type CreateViewerOptions, type ViewerHandle } from '@j3d/viewer';
import { createViewerWithTestHook, isTestHookEnabled } from '@j3d/viewer/testing';
import { decodeEdits } from './edits-codec.js';
import type { DotNetObjectReference } from './interop.js';
import { forwardModelEvents } from './model-events.js';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from '@j3d/viewer';

/** The handle as .NET's `ViewerInterop` calls it: edits arrive packed, and export progress comes to .NET. */
export interface BlazorViewerHandle extends Omit<ViewerHandle, 'setStructure' | 'exportModel'> {
  /** Since M16 the edits arrive packed (edits-codec.ts, D199). */
  setStructure(id: string, numbers: Uint8Array, text: string): ReturnType<ViewerHandle['setStructure']>;
  /** Reports progress to .NET's `OnExportProgress` (D83, D125). */
  exportModel(id: string, format: BrepExportFormat, selection?: boolean): ReturnType<ViewerHandle['exportModel']>;
}

/** `<J3DViewer>`'s parameters, named as .NET's `ViewerOptions` sends them. */
export interface BlazorViewerOptions {
  keys: 'off' | 'viewer' | 'page';
  /** A CSS selector: while it matches, the viewer leaves keys alone (D273). */
  pauseKeysWhile: string | null;
  /** The store's name, or null to keep nothing (D256). */
  keep: string | null;
  viewCube: boolean;
  homeButton: boolean;
  viewButtons: boolean;
  dropFiles: boolean;
}

/**
 * Entry point called by the `<J3DViewer>` component: `@j3d/viewer`, with its callbacks sent to .NET
 * (docs/plan.md §6.4), which owns selection, visibility and undo (D95). In the Development environment
 * a test hook (`window.__j3dTest`) drives and observes imports and the camera.
 */
export function createViewer(host: HTMLElement, dotnet: DotNetObjectReference, blazorOptions: BlazorViewerOptions): BlazorViewerHandle {
  const { keys, pauseKeysWhile, keep, viewCube, homeButton, viewButtons, dropFiles } = blazorOptions;
  const options: CreateViewerOptions = {
    keys: keys === 'page' ? 'page' : keys === 'viewer',
    ...(keep === null ? {} : { keep: { name: keep } }),
    ...(pauseKeysWhile === null ? {} : { keyFilter: () => document.querySelector(pauseKeysWhile) !== null }),
    viewCube,
    homeButton,
    viewButtons,
    dropFiles,
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
      unsubscribeDotnet();
      viewer.dispose();
      delete host.dataset['viewerReady'];
    },
  };
}

function call(dotnet: DotNetObjectReference, method: string, ...args: unknown[]): void {
  dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
}
