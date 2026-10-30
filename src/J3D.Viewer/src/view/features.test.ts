import { describe, expect, it } from 'vitest';
import { featureKeys } from './features.js';
import type { Picked } from './measure.js';

const ref = (kind: 0 | 1 | 2, index: number) => ({ kind, prototype: 0, index, matrix: [] });

describe('featureKeys (M17, D219)', () => {
  it('names each selected feature by its model, part, kind and number, in pick order', () => {
    const picked: Picked[] = [
      { id: 'm', entity: { kind: 'face', node: 3, ref: ref(0, 2), point: [1, 2, 3] } },
      { id: 'm', entity: { kind: 'vertex', node: 4, ref: ref(2, 0), point: [0, 0, 0] } },
    ];
    expect(JSON.parse(featureKeys(picked))).toEqual([
      { id: 'm', node: 3, kind: 'face', index: 2, point: [1, 2, 3] },
      { id: 'm', node: 4, kind: 'vertex', index: 0, point: [0, 0, 0] },
    ]);
  });

  it('is empty for no features, and leaves out mesh points', () => {
    expect(featureKeys([])).toBe('');
    expect(featureKeys([{ id: 'm', entity: { kind: 'point', node: 1, point: [0, 0, 0] } }])).toBe('');
  });
});
