import { describe, expect, it } from 'vitest';
import type { CameraSnapshot } from '../store/types';
import { sameView, ViewHistory } from './view-history';

const view = (x: number, projection: CameraSnapshot['projection'] = 'orthographic', zoom = 1): CameraSnapshot => ({
  projection,
  position: [x, -100, 100],
  target: [x, 0, 0],
  focalOffset: [0, 0, 0],
  zoom,
});

describe('ViewHistory (M17, D220)', () => {
  it('steps back and forward through the views the camera came to rest at', () => {
    const history = new ViewHistory();
    history.reset(view(0));
    expect(history.canGoBack).toBe(false);
    history.record(view(1));
    history.record(view(2));

    expect(history.back()).toEqual(view(1));
    expect(history.back()).toEqual(view(0));
    expect(history.back()).toBeUndefined();
    expect(history.canGoForward).toBe(true);
    expect(history.forward()).toEqual(view(1));
    expect(history.forward()).toEqual(view(2));
    expect(history.forward()).toBeUndefined();
  });

  it('drops what could be gone forward to when a new view is recorded', () => {
    const history = new ViewHistory();
    history.reset(view(0));
    history.record(view(1));
    history.record(view(2));
    history.back();
    history.back();

    expect(history.record(view(5))).toBe(true);
    expect(history.canGoForward).toBe(false);
    expect(history.count).toBe(2);
    expect(history.back()).toEqual(view(0));
  });

  it('skips a view that is where the camera already was', () => {
    const history = new ViewHistory();
    history.reset(view(0));
    expect(history.record({ ...view(0), position: [1e-7, -100, 100] })).toBe(false); // a hair short, as camera-controls rests
    expect(history.count).toBe(1);
  });

  it('keeps the last 50', () => {
    const history = new ViewHistory();
    history.reset(view(0));
    for (let i = 1; i <= 60; i++) {
      history.record(view(i));
    }
    expect(history.count).toBe(50);
    let steps = 0;
    while (history.back()) {
      steps++;
    }
    expect(steps).toBe(49);
    expect(history.current).toEqual(view(11));
  });

  it('tells views apart by projection, place and zoom', () => {
    expect(sameView(view(0), view(0))).toBe(true);
    expect(sameView(view(0), view(0, 'perspective'))).toBe(false);
    expect(sameView(view(0), view(0.01))).toBe(false);
    expect(sameView(view(0), view(0, 'orthographic', 1.01))).toBe(false);
  });
});
