import type { DotNetObjectReference } from './interop';

export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from './formats';
export type { ModelFormat, ModelKind } from './formats';

/** Mirrors J3D.Web.Client/Interop/ViewerCapabilities.cs. */
export interface ViewerCapabilities {
  webGl2: boolean;
  crossOriginIsolated: boolean;
}

export interface ViewerHandle {
  dispose(): void;
}

/**
 * Entry point called by the Blazor <c>Viewport</c> component.
 *
 * Scaffold stage: proves the Blazor ⇄ module wiring and reports capabilities. The Three.js scene,
 * camera controls and OCCT worker pipeline arrive in milestones M2–M3 (docs/plan.md).
 */
export function createViewer(host: HTMLElement, dotnet: DotNetObjectReference): ViewerHandle {
  host.dataset['viewerReady'] = 'true';
  void dotnet.invokeMethodAsync('OnViewerReady', detectCapabilities());

  return {
    dispose() {
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
