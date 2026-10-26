import { describe, expect, it } from 'vitest';
import { isTreeNavigationKey, scrollTopFor } from './tree-rows';

describe('scrollTopFor', () => {
  // A list 260 px high (ten 26 px rows) scrolled down by 520 px: rows 20 to 29 show.
  const [height, view, scrolled] = [26, 260, 520];

  it('leaves a row in view where it is', () => {
    expect(scrollTopFor(20 * height, height, scrolled, view)).toBeUndefined();
    expect(scrollTopFor(29 * height, height, scrolled, view)).toBeUndefined();
  });

  it('brings a row above the view to its top', () => {
    expect(scrollTopFor(19 * height, height, scrolled, view)).toBe(19 * height);
  });

  it('brings a row below the view to its bottom', () => {
    expect(scrollTopFor(30 * height, height, scrolled, view)).toBe(31 * height - view);
  });

  it('never scrolls above the top', () => {
    expect(scrollTopFor(0, height, 10, 5)).toBe(0);
  });
});

describe('isTreeNavigationKey', () => {
  it('takes the keys that move between rows, and not the shortcuts', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].every(isTreeNavigationKey)).toBe(true);
    expect(['Enter', 'Tab', 'Delete', 'F2', 'h', 'c'].some(isTreeNavigationKey)).toBe(false);
  });
});
