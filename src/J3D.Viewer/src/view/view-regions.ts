import { anglesOf } from './camera-math';

/** Axis steps of a view cube region: −1, 0 or +1 along X (left/right), Y (front/back) and Z (bottom/top). */
export type RegionStep = -1 | 0 | 1;

/** One of the view cube's 26 regions: 6 faces, 12 edges and 8 corners (decision D31). */
export interface ViewRegion {
  /** For example `top`, `front-right` or `top-front-right`. */
  id: string;
  /** The direction from the cube's centre towards the region, which is where the camera goes. */
  direction: readonly [RegionStep, RegionStep, RegionStep];
  kind: 'face' | 'edge' | 'corner';
}

const steps: RegionStep[] = [-1, 0, 1];

function regionId(x: RegionStep, y: RegionStep, z: RegionStep): string {
  return [z > 0 ? 'top' : z < 0 ? 'bottom' : '', y < 0 ? 'front' : y > 0 ? 'back' : '', x > 0 ? 'right' : x < 0 ? 'left' : '']
    .filter(Boolean)
    .join('-');
}

/** All 26 regions. Z-up names: Top looks down −Z, Front looks along +Y and Right looks along −X. */
export const ViewRegions: readonly ViewRegion[] = steps.flatMap((x) =>
  steps.flatMap((y) =>
    steps.flatMap((z): ViewRegion[] => {
      const nonZero = Math.abs(x) + Math.abs(y) + Math.abs(z);
      return nonZero === 0
        ? []
        : [{ id: regionId(x, y, z), direction: [x, y, z], kind: nonZero === 1 ? 'face' : nonZero === 2 ? 'edge' : 'corner' }];
    }),
  ),
);

export function findRegion(id: string): ViewRegion | undefined {
  return ViewRegions.find((region) => region.id === id);
}

/** Isometric: the front-right-top corner, looking from (+X, −Y, +Z) (plan §12, item 3). */
export const HomeRegion = findRegion('top-front-right')!;

/** camera-controls angles for a region's view. Top and Bottom keep +Y and −Y up on screen. */
export function regionView(region: ViewRegion): { azimuth: number; polar: number } {
  const [x, y, z] = region.direction;
  return anglesOf({ x, y, z });
}
