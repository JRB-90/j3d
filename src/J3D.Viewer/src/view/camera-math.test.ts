import { Box3, Sphere, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  anglesOf,
  clippingPlanes,
  fitBox,
  fitDistance,
  lookRotation,
  nearestAngle,
  orthoVisibleHeight,
  orthoZoom,
  perspectiveDistance,
  perspectiveVisibleHeight,
  PoleEpsilon,
  viewDirection,
} from './camera-math';

const close = (actual: number, expected: number, digits = 9) => expect(actual).toBeCloseTo(expected, digits);
const closeVector = (actual: Vector3, expected: [number, number, number], digits = 9) => {
  close(actual.x, expected[0], digits);
  close(actual.y, expected[1], digits);
  close(actual.z, expected[2], digits);
};

describe('projection toggle maths', () => {
  it('keeps the visible height between perspective and orthographic', () => {
    for (const height of [0.001, 1, 250, 1e6]) {
      close(perspectiveVisibleHeight(perspectiveDistance(height)), height / 1, 6);
      close(orthoVisibleHeight(orthoZoom(height)), height, 6);
    }
  });

  it('matches h = 2·d·tan(fov/2)', () => {
    close(perspectiveVisibleHeight(10, 90), 20);
    close(perspectiveDistance(20, 90), 10);
  });
});

describe('view angles', () => {
  it('maps azimuth and polar to Z-up directions', () => {
    closeVector(viewDirection(0, Math.PI / 2), [0, -1, 0]); // Front: the camera is at −Y
    closeVector(viewDirection(Math.PI / 2, Math.PI / 2), [1, 0, 0]); // Right: the camera is at +X
    closeVector(viewDirection(Math.PI, Math.PI / 2), [0, 1, 0]); // Back
    closeVector(viewDirection(0, 0), [0, 0, 1]); // Top
  });

  it('inverts viewDirection away from the poles', () => {
    for (const [azimuth, polar] of [
      [0.3, 1.2],
      [-2, 0.4],
      [3, 2.9],
    ] as const) {
      const angles = anglesOf(viewDirection(azimuth, polar));
      close(angles.azimuth, azimuth);
      close(angles.polar, polar);
    }
  });

  it('keeps straight up and down just off the pole with azimuth 0', () => {
    expect(anglesOf({ x: 0, y: 0, z: 5 })).toEqual({ azimuth: 0, polar: PoleEpsilon });
    expect(anglesOf({ x: 0, y: 0, z: -1 })).toEqual({ azimuth: 0, polar: Math.PI - PoleEpsilon });
  });

  it('turns the short way round', () => {
    close(nearestAngle(0, Math.PI / 2), Math.PI / 2);
    close(nearestAngle(6, 0), 2 * Math.PI);
    close(nearestAngle(-7, Math.PI), -3 * Math.PI);
    close(nearestAngle(1, -Math.PI / 2), -Math.PI / 2);
  });
});

describe('fitBox', () => {
  const box = new Box3(new Vector3(-20, -15, 0), new Vector3(20, 15, 60));

  it('frames a box seen from the front without moving the view direction', () => {
    const rotation = lookRotation(new Vector3(0, -100, 30), new Vector3(0, 0, 30));
    const fit = fitBox(box, rotation, 2, 0);
    closeVector(fit.target, [0, 0, 30]);
    close(fit.visibleHeight, 60); // the box is 60 high and 40 wide; 40 / aspect 2 = 20
    close(fit.depth, 30);
  });

  it('is limited by the width on a narrow view, and adds padding on both sides', () => {
    const rotation = lookRotation(new Vector3(0, -100, 30), new Vector3(0, 0, 30));
    close(fitBox(box, rotation, 0.5, 0).visibleHeight, 80);
    close(fitBox(box, rotation, 0.5, 0.1).visibleHeight, 96);
  });

  it('centres the projected extent, not the box centre, from an oblique view', () => {
    const target = new Vector3(5, 5, 5);
    const rotation = lookRotation(target.clone().add(viewDirection(Math.PI / 4, 0.9553166181245093)), target);
    const fit = fitBox(new Box3(new Vector3(0, 0, 0), new Vector3(10, 10, 10)), rotation, 1, 0);
    closeVector(fit.target, [5, 5, 5]);
    // The isometric silhouette of a cube is a hexagon 2·√(2/3)·10 high.
    close(fit.visibleHeight, 2 * Math.sqrt(2 / 3) * 10, 6);
  });

  it('backs a perspective camera off so the front of the box fits too', () => {
    const fit = { target: new Vector3(), visibleHeight: 20, depth: 10 };
    close(fitDistance(fit, 90), 15);
  });
});

describe('clippingPlanes', () => {
  const sphere = new Sphere(new Vector3(0, 0, 0), 10);
  const forward = new Vector3(0, 1, 0);

  it('encloses the scene with a margin in orthographic views, allowing a negative near plane', () => {
    const { near, far } = clippingPlanes('orthographic', new Vector3(0, -5, 0), forward, sphere);
    close(near, -6);
    close(far, 16);
  });

  it('keeps a positive near plane in perspective views', () => {
    const outside = clippingPlanes('perspective', new Vector3(0, -100, 0), forward, sphere);
    close(outside.near, 89);
    close(outside.far, 111);
    const inside = clippingPlanes('perspective', new Vector3(0, -5, 0), forward, sphere);
    close(inside.near, 16e-4);
  });

  it('has defaults for an empty scene', () => {
    expect(clippingPlanes('perspective', new Vector3(), forward, null)).toEqual({ near: 0.1, far: 1e5 });
    expect(clippingPlanes('orthographic', new Vector3(), forward, new Sphere())).toEqual({ near: -1e5, far: 1e5 });
  });
});
