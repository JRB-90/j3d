import type { DotNetObjectReference } from './interop.js';
import { installMenuEscape } from './menus.js';
import { installTreeDrag } from './tree-drag.js';
import { installTreeKeys } from './tree-rows.js';

export { revealTreeRow } from './tree-rows.js';
export { watchLayout } from './shell.js';

export interface PageWatch {
  dispose(): void;
}

/**
 * What the app's page does around the viewer (D273): nodes dragged in the model list's trees go to .NET,
 * which owns the tree and its edits (M14, D182), the trees take their keys, and Escape closes a menu.
 * `openMenu` is the selector the app gives the viewer as `PauseKeysWhile`.
 */
export function installPage(dotnet: DotNetObjectReference, openMenu: string): PageWatch {
  const removeTreeDrag = installTreeDrag(document, ({ source, model, target, copy }) => {
    dotnet.invokeMethodAsync('OnTreeDrop', source, model, target, copy).catch((error: unknown) => console.error(".NET's OnTreeDrop failed.", error));
  });
  const removeTreeKeys = installTreeKeys(document);
  const removeMenuEscape = installMenuEscape(document, openMenu);
  return {
    dispose() {
      removeTreeDrag();
      removeTreeKeys();
      removeMenuEscape();
    },
  };
}

/** Copies a measurement value to the clipboard (M7, D87). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
