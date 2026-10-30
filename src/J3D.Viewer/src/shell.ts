/**
 * The app's layout on phones and tablets (M19, D234, D239): whether the window is compact (below 900 px
 * wide or 500 px tall) and whether its main pointer is a finger, reported to .NET as they change; app.css
 * lays the page out by the same media queries before .NET knows. Also what a finger needs outside the 3D
 * view, which handles its own (`Viewer`): a long press on a tree row opens its context menu, as a right
 * click does (D242), and a swipe to the left closes the drawer (D238).
 */
import type { DotNetObjectReference } from './interop.js';

/** The compact layout (D234): a phone either way up, or a tablet held upright. */
export const CompactQuery = '(max-width: 899.98px), (max-height: 499.98px)';

/** A touch screen (D239): the main pointer is a finger. */
export const TouchQuery = '(pointer: coarse)';

/** A finger held still this long opens a context menu (D242). */
export const LongPressMilliseconds = 500;

/** A finger moves more in a tap than a mouse does in a click (D242), in pixels. */
export const TapTolerance = 10;

/** A swipe this far to the left, more across than down, closes the drawer (D238), in pixels. */
const SwipeDistance = 60;

/** What a long press opens a menu on outside the 3D view: the tree's rows, which have a right-click menu (D164). */
const LongPressTargets = '[data-tree-node]';

/** The drawer while it's open over the view (D238). */
const OpenDrawer = '.j3d-drawer--compact-open';

/** The bottom sheet's handle (D236), which a drag opens or closes. */
const SheetHandle = '.j3d-sheet-handle';

/** Context menu events a long press dispatched, told apart from the browser's own. */
const dispatched = new WeakSet<Event>();

export interface LayoutWatch {
  dispose(): void;
}

/**
 * Reports the layout to .NET's `OnLayoutChanged(compact, touch)` now and whenever it changes, and a swipe
 * that closes the drawer to `OnDrawerSwiped()`; installs the long press on the tree's rows.
 */
export function watchLayout(dotnet: DotNetObjectReference): LayoutWatch {
  const compact = window.matchMedia(CompactQuery);
  const touch = window.matchMedia(TouchQuery);
  const call = (method: string, ...args: unknown[]) =>
    dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
  const report = () => void call('OnLayoutChanged', compact.matches, touch.matches);
  compact.addEventListener('change', report);
  touch.addEventListener('change', report);
  report();
  const removeLongPress = installLongPress(document);
  const removeSwipe = installDrawerSwipe(document, () => void call('OnDrawerSwiped'));
  // A drag on the sheet's handle ends on the handle wherever the pointer is let go, as a finger's does.
  const captureHandle = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.matches(SheetHandle)) {
      event.target.setPointerCapture(event.pointerId);
    }
  };
  document.addEventListener('pointerdown', captureHandle, true);
  return {
    dispose() {
      compact.removeEventListener('change', report);
      touch.removeEventListener('change', report);
      document.removeEventListener('pointerdown', captureHandle, true);
      removeLongPress();
      removeSwipe();
    },
  };
}

/**
 * A long press on a tree row (D242): after {@link LongPressMilliseconds} without moving, the row gets a
 * `contextmenu` event at the finger, as a right click gives it, and .NET opens its menu. The browser's
 * own event for a finger's long press (Android's, and touch Windows') is dropped, so the menu opens once.
 */
export function installLongPress(root: Document): () => void {
  let press: { id: number; x: number; y: number; target: Element; timer: number } | undefined;
  let fromFinger = false;
  const cancel = () => {
    if (press) {
      window.clearTimeout(press.timer);
      press = undefined;
    }
  };
  const onDown = (event: PointerEvent) => {
    cancel();
    fromFinger = event.pointerType === 'touch';
    const target = event.target instanceof Element ? event.target.closest(LongPressTargets) : null;
    if (!fromFinger || !event.isPrimary || !target) {
      return;
    }
    const start = { id: event.pointerId, x: event.clientX, y: event.clientY, target, timer: 0 };
    start.timer = window.setTimeout(() => {
      if (press !== start) {
        return;
      }
      press = undefined;
      swallowClickAfter(start.id);
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, button: 2, buttons: 0 });
      dispatched.add(menu);
      start.target.dispatchEvent(menu);
    }, LongPressMilliseconds);
    press = start;
  };
  const onMove = (event: PointerEvent) => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TapTolerance) {
      cancel();
    }
  };
  const onEnd = (event: PointerEvent) => {
    if (press?.id === event.pointerId) {
      cancel();
    }
  };
  const onContextMenu = (event: MouseEvent) => {
    if (fromFinger && !dispatched.has(event) && event.target instanceof Element && event.target.closest(LongPressTargets)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', onEnd, true);
  root.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  return () => {
    cancel();
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('pointermove', onMove, true);
    root.removeEventListener('pointerup', onEnd, true);
    root.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
  };
}

/**
 * Once a long press has opened a menu, the finger lifting may still make a click, which would land on the
 * menu's backdrop and close it: the next click before another press, or shortly after the finger lifts,
 * is dropped.
 */
export function swallowClickAfter(pointerId: number): void {
  let timer = 0;
  const done = () => {
    window.clearTimeout(timer);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('pointerdown', done, true);
    window.removeEventListener('pointerup', onUp, true);
  };
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    done();
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerId === pointerId) {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, 300);
    }
  };
  window.addEventListener('click', onClick, true);
  window.addEventListener('pointerdown', done, true);
  window.addEventListener('pointerup', onUp, true);
  timer = window.setTimeout(done, 5000);
}

/** A finger swiping left across the open drawer closes it (D238); the drawer lets the page pan only up and down. */
function installDrawerSwipe(root: Document, close: () => void): () => void {
  let start: { id: number; x: number; y: number } | undefined;
  const onDown = (event: PointerEvent) => {
    const inDrawer = event.target instanceof Element && event.target.closest(OpenDrawer) !== null;
    start = event.pointerType === 'touch' && event.isPrimary && inDrawer ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined;
  };
  const onUp = (event: PointerEvent) => {
    if (start?.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = undefined;
    if (dx < -SwipeDistance && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      close();
    }
  };
  const onCancel = () => (start = undefined);
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointerup', onUp, true);
  root.addEventListener('pointercancel', onCancel, true);
  return () => {
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('pointerup', onUp, true);
    root.removeEventListener('pointercancel', onCancel, true);
  };
}
