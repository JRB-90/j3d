/**
 * Escape closes a menu open in MudBlazor's popover layer, as a click beside it would: it draws the menu
 * with an overlay that closes it when clicked. The viewer leaves keys alone meanwhile (`PauseKeysWhile`,
 * D273). The click waits until the event is over, for the viewer must still find the menu open.
 */
export function installMenuEscape(root: Document, openMenu: string): () => void {
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && root.querySelector(openMenu)) {
      setTimeout(() => {
        const overlay = root.querySelector('.mud-overlay');
        if (overlay instanceof HTMLElement) {
          overlay.click();
        }
      });
    }
  };
  root.addEventListener('keydown', closeOnEscape);
  return () => root.removeEventListener('keydown', closeOnEscape);
}
