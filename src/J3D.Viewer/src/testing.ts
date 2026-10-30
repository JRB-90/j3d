// @j3d/viewer/testing: J3D's own test hook (docs/plan.md §6.3), not for applications. It reads the
// viewer's internals, which change without notice.

import { createViewerParts, type CreateViewerOptions, type ViewerHandle } from './create-viewer.js';
import { createTestHookControls, installTestHook, isTestHookEnabled } from './test-hook.js';

export { isTestHookEnabled };

/** A viewer with `window.__j3dTest` installed beside it. */
export function createViewerWithTestHook(host: HTMLElement, options: CreateViewerOptions = {}): ViewerHandle {
  const controls = createTestHookControls();
  const { handle, models, view, store } = createViewerParts(host, options, controls);
  const removeTestHook = installTestHook(models, controls, handle.attachFileInput, view, store);
  return {
    ...handle,
    dispose() {
      removeTestHook();
      handle.dispose();
    },
  };
}
