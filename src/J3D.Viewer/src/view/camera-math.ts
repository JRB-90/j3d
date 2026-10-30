import { Box3, Matrix4, Quaternion, Vector3, type Sphere } from 'three';

/** The camera's projection: orthographic unless changed. */
export type Projection = 'orthographic' | 'perspective';

/** World up (decision D18). */
export const Up = Object.freeze(new Vector3(0, 0, 1));

/** Vertical field of view of the perspective camera, in degrees (docs/plan.md §6.3). */
export const PerspectiveFov = 35;

/**
 * Height of the orthographic camera's frustum at zoom 1. The visible height is
 * `OrthoFrustumHeight / zoom`, so zoom is the inverse of the visible height in world units.
 */
export const OrthoFrustumHeight = 1;

/** Space left around a fitted model, as a fraction of its size on screen. */
export const FitPadding = 0.1;

/**
 * Turntable controls can't sit exactly on a pole, so Top and Bottom views stop this far from it
 * (risk R11).
 */
export const PoleEpsilon = 1e-4;

const halfFov = (fovDegrees: number) => (fovDegrees * Math.PI) / 360;

/** Distance at which a perspective camera sees `visibleHeight` world units at its target. */
export function perspectiveDistance(visibleHeight: number, fovDegrees = PerspectiveFov): number {
  return visibleHeight / (2 * Math.tan(halfFov(fovDegrees)));
}

/** World height a perspective camera sees at its target, `distance` away. */
export function perspectiveVisibleHeight(distance: number, fovDegrees = PerspectiveFov): number {
  return 2 * distance * Math.tan(halfFov(fovDegrees));
}

export function orthoZoom(visibleHeight: number): number {
  return OrthoFrustumHeight / visibleHeight;
}

export function orthoVisibleHeight(zoom: number): number {
  return OrthoFrustumHeight / zoom;
}

/**
 * Direction from the target to the camera for camera-controls' azimuth and polar angles with Z up:
 * polar 0 looks straight down, azimuth 0 looks along +Y (Front) and azimuth π/2 along −X (Right).
 */
export function viewDirection(azimuth: number, polar: number, out = new Vector3()): Vector3 {
  const s = Math.sin(polar);
  return out.set(s * Math.sin(azimuth), -s * Math.cos(azimuth), Math.cos(polar));
}

/** Azimuth and polar angles of a direction from the target to the camera (the inverse of {@link viewDirection}). */
export function anglesOf(direction: { x: number; y: number; z: number }): { azimuth: number; polar: number } {
  const { x, y, z } = direction;
  const length = Math.hypot(x, y, z);
  const polar = Math.min(Math.max(Math.acos(z / length), PoleEpsilon), Math.PI - PoleEpsilon);
  // Straight up or down: azimuth 0, so +Y is up on screen in the Top view.
  const azimuth = Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12 ? 0 : Math.atan2(x, -y);
  return { azimuth, polar };
}

/** The angle equal to `target` (mod 2π) closest to `current`, so a transition takes the short way round. */
export function nearestAngle(current: number, target: number): number {
  return target + 2 * Math.PI * Math.round((current - target) / (2 * Math.PI));
}

/** Rotation of a camera at `position` looking at `target` with Z up. */
export function lookRotation(position: Vector3, target: Vector3, out = new Quaternion()): Quaternion {
  return out.setFromRotationMatrix(new Matrix4().lookAt(position, target, Up));
}

export interface BoxFit {
  /** Where the camera should look: the centre of the box's extent on screen, at the depth of its centre. */
  target: Vector3;
  /** World height the view must show, including padding. */
  visibleHeight: number;
  /** The box's extent along the view direction. */
  depth: number;
}

/**
 * Frames a box without changing the view direction: projects its corners onto the view plane of a
 * camera rotated by `rotation`, centres their extent and sizes the view to cover it with padding.
 * (camera-controls' own `fitToBox` snaps the view to the nearest axis first, which would turn Home's
 * isometric view into a front view.)
 */
export function fitBox(box: Box3, rotation: Quaternion, aspect: number, padding = FitPadding): BoxFit {
  const inverse = rotation.clone().invert();
  const extent = new Box3();
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    extent.expandByPoint(corner.applyQuaternion(inverse));
  }
  const size = extent.getSize(new Vector3());
  const visibleHeight = Math.max(size.y, size.x / aspect, 1e-9) * (1 + 2 * padding);
  return {
    target: extent.getCenter(new Vector3()).applyQuaternion(rotation),
    visibleHeight,
    depth: size.z,
  };
}

/** Camera distance from the target for a fit: the front of the box must fit in a perspective view too. */
export function fitDistance(fit: BoxFit, fovDegrees = PerspectiveFov): number {
  return perspectiveDistance(fit.visibleHeight, fovDegrees) + fit.depth / 2;
}

/** Near and far planes with no models loaded. */
export const EmptyClipping = { near: 0.1, far: 1e5 } as const;

/** Margin around the scene's bounding sphere when placing the clipping planes. */
const ClippingMargin = 1.1;

/** Smallest near / far ratio for a perspective camera inside the scene (depth precision). */
const MinNearRatio = 1e-4;

/**
 * Near and far planes that enclose the scene's bounding sphere, recomputed on every camera and
 * model change. An orthographic camera may have a negative near plane, so nothing is clipped even
 * when its target is deep inside a large model.
 */
export function clippingPlanes(
  projection: Projection,
  position: Vector3,
  forward: Vector3,
  sphere: Sphere | null,
): { near: number; far: number } {
  if (!sphere || sphere.isEmpty()) {
    return projection === 'orthographic' ? { near: -EmptyClipping.far, far: EmptyClipping.far } : { ...EmptyClipping };
  }
  const radius = Math.max(sphere.radius, 1e-6) * ClippingMargin;
  const depth = new Vector3().subVectors(sphere.center, position).dot(forward);
  const far = depth + radius;
  if (projection === 'orthographic') {
    return { near: depth - radius, far };
  }
  return { near: Math.max(depth - radius, far * MinNearRatio, 1e-6), far: Math.max(far, 1e-5) };
}
