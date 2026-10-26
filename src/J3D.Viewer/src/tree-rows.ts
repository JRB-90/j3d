/**
 * The model list's trees (M16, D198, D202): .NET draws only the rows on screen (Blazor's `Virtualize`),
 * all one height, so a row that isn't drawn yet is found by its index. These help with what .NET can't
 * do: scroll a row into view before it exists, focus it once it does, and stop the keys that move
 * between rows from also scrolling the list.
 */

/** Keys a tree row handles itself (D202), whose default would scroll the list. */
const NavigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ']);

/** Whether a focused tree row handles this key, so the browser shouldn't scroll for it. */
export function isTreeNavigationKey(key: string): boolean {
  return NavigationKeys.has(key);
}

/**
 * Where to scroll a list so that a row shows, as `scrollIntoView({ block: 'nearest' })` would: nowhere
 * (undefined) if it's in view already, else just far enough for its top or its bottom to show.
 * `rowTop` is the row's place in the list's scrolled content.
 */
export function scrollTopFor(rowTop: number, rowHeight: number, scrollTop: number, viewHeight: number): number | undefined {
  if (rowTop < scrollTop) {
    return rowTop;
  }
  if (rowTop + rowHeight > scrollTop + viewHeight) {
    return Math.max(0, rowTop + rowHeight - viewHeight);
  }
  return undefined;
}

/**
 * Scrolls a tree's row into view (D96) by its index, then focuses it once .NET has drawn it, if asked
 * (D202). `tree` and `row` are selectors.
 */
export function revealTreeRow(tree: string, index: number, rowHeight: number, row: string, focus: boolean): void {
  const element = document.querySelector<HTMLElement>(tree);
  const list = element && scrollParentOf(element);
  if (element && list) {
    const rowTop = element.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop + index * rowHeight;
    const top = scrollTopFor(rowTop, rowHeight, list.scrollTop, list.clientHeight);
    if (top !== undefined) {
      list.scrollTop = top;
    }
  }
  if (focus) {
    focusWhenDrawn(row, 30);
  }
}

/** Stops the browser scrolling the list for the keys a focused tree row handles; .NET still gets them. */
export function installTreeKeys(root: Document | HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.getAttribute('role') === 'treeitem' && isTreeNavigationKey(event.key)) {
      event.preventDefault();
    }
  };
  root.addEventListener('keydown', onKeyDown as EventListener);
  return () => root.removeEventListener('keydown', onKeyDown as EventListener);
}

/** Focuses an element as soon as it exists, trying for a few frames. */
function focusWhenDrawn(selector: string, frames: number): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) {
    element.focus({ preventScroll: true });
  } else if (frames > 0) {
    requestAnimationFrame(() => focusWhenDrawn(selector, frames - 1));
  }
}

/** The nearest ancestor that scrolls: the model list's drawer. */
function scrollParentOf(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : undefined;
}
