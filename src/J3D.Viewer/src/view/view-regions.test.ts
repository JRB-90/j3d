import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PoleEpsilon, viewDirection } from './camera-math.js';
import { findRegion, HomeRegion, regionView, ViewRegions } from './view-regions.js';

describe('view cube regions', () => {
  it('has 6 faces, 12 edges and 8 corners with unique ids', () => {
    const count = (kind: string) => ViewRegions.filter((region) => region.kind === kind).length;
    expect(ViewRegions).toHaveLength(26);
    expect([count('face'), count('edge'), count('corner')]).toEqual([6, 12, 8]);
    expect(new Set(ViewRegions.map((region) => region.id)).size).toBe(26);
  });

  it.each([
    ['front', 0, Math.PI / 2],
    ['right', Math.PI / 2, Math.PI / 2],
    ['back', Math.PI, Math.PI / 2],
    ['left', -Math.PI / 2, Math.PI / 2],
    ['top', 0, PoleEpsilon],
    ['bottom', 0, Math.PI - PoleEpsilon],
    ['top-front', 0, Math.PI / 4],
    ['front-right', Math.PI / 4, Math.PI / 2],
    ['bottom-back-left', (-3 * Math.PI) / 4, Math.PI - Math.acos(1 / Math.sqrt(3))],
  ])('%s → azimuth %f, polar %f', (id, azimuth, polar) => {
    const view = regionView(findRegion(id)!);
    expect(view.azimuth).toBeCloseTo(azimuth, 12);
    expect(view.polar).toBeCloseTo(polar, 12);
  });

  it('puts the camera on the region side of the model for all 26 regions', () => {
    for (const region of ViewRegions) {
      const { azimuth, polar } = regionView(region);
      const expected = new Vector3(...region.direction).normalize();
      expect(viewDirection(azimuth, polar).dot(expected), region.id).toBeCloseTo(1, 6);
    }
  });

  it('uses the front-right-top corner as Home (isometric)', () => {
    expect(HomeRegion.id).toBe('top-front-right');
    const { azimuth, polar } = regionView(HomeRegion);
    expect(azimuth).toBeCloseTo(Math.PI / 4, 12);
    expect(polar).toBeCloseTo(Math.acos(1 / Math.sqrt(3)), 12);
  });
});
