import type { CameraSnapshot } from '../store/types.js';

/** The most views the history holds (D220), as the undo history holds 50 steps (assumption 11). */
export const ViewHistoryCapacity = 50;

/**
 * The camera's own history (M17, D209, D220): each view it came to rest at, with Previous view and Next
 * view stepping through them. Per tab and not kept, apart from the undo history, so undoing an edit
 * never moves the camera. A view equal to the current one isn't a step.
 */
export class ViewHistory {
  private views: CameraSnapshot[] = [];
  private index = -1;

  constructor(private readonly capacity = ViewHistoryCapacity) {}

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index < this.views.length - 1;
  }

  get current(): CameraSnapshot | undefined {
    return this.views[this.index];
  }

  get count(): number {
    return this.views.length;
  }

  /** The camera came to rest here: a new step, unless it's where it already was. What could be gone forward to goes. */
  record(view: CameraSnapshot): boolean {
    const current = this.current;
    if (current && sameView(current, view)) {
      return false;
    }
    this.views = [...this.views.slice(0, this.index + 1), view].slice(-this.capacity);
    this.index = this.views.length - 1;
    return true;
  }

  /** Starts again from one view: the page's first, or the kept camera put back (D111). */
  reset(view: CameraSnapshot): void {
    this.views = [view];
    this.index = 0;
  }

  /** The view before the current one, now current, or undefined. */
  back(): CameraSnapshot | undefined {
    if (!this.canGoBack) {
      return undefined;
    }
    this.index--;
    return this.views[this.index];
  }

  /** The view after the current one, now current, or undefined. */
  forward(): CameraSnapshot | undefined {
    if (!this.canGoForward) {
      return undefined;
    }
    this.index++;
    return this.views[this.index];
  }
}

/**
 * Whether two views are the same, allowing for camera-controls coming to rest a hair short of where it
 * was sent: positions within a millionth of the distance between camera and target, and zooms within a
 * millionth of themselves.
 */
export function sameView(a: CameraSnapshot, b: CameraSnapshot): boolean {
  if (a.projection !== b.projection) {
    return false;
  }
  const scale = Math.max(distance(a.position, a.target), 1e-9);
  const close = (x: readonly number[], y: readonly number[]) => x.every((value, i) => Math.abs(value - y[i]!) <= scale * 1e-6);
  return (
    close(a.position, b.position) &&
    close(a.target, b.target) &&
    close(a.focalOffset, b.focalOffset) &&
    Math.abs(a.zoom - b.zoom) <= Math.abs(a.zoom) * 1e-6
  );
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}
