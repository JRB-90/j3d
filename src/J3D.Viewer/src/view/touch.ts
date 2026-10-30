/**
 * What the viewer and an app's own UI need to agree on for phones and tablets (M19, D234, D239, D242), so
 * a long press or a tap means the same over the view as over the app's lists.
 */

/** The compact layout (D234): a phone either way up, or a tablet held upright. */
export const CompactQuery = '(max-width: 899.98px), (max-height: 499.98px)';

/** A touch screen (D239): the main pointer is a finger. */
export const TouchQuery = '(pointer: coarse)';

/** A finger held still this long opens a context menu (D242). */
export const LongPressMilliseconds = 500;

/** A finger moves more in a tap than a mouse does in a click (D242), in pixels. */
export const TapTolerance = 10;

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
