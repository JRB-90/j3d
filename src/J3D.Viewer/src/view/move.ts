import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type Camera,
} from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { ModelId } from '../import/types';
import type { Placement } from './parts';

/** What the triad does (D149): its arrows and planes translate, its rings rotate (keys W and E, D166). */
export type MoveMode = 'translate' | 'rotate';

/** The frame the fields and the triad use (D148): the object's own, its parent's or the world's. */
export type MoveFrame = 'local' | 'parent' | 'world';

/** One object to move: a tree node, or a whole model as node -1 (D167, D169). */
export interface MoveTarget {
  id: ModelId;
  node: number;
}

/** Ctrl held while dragging snaps to these (D168): 1 mm and 15°. */
export const TranslationSnapMillimetres = 1;
export const RotationSnapDegrees = 15;

/** How long the origin frames' axes are on screen (D150), in CSS pixels. */
export const OriginFrameLength = 60;

/** What the Move tool needs of the viewer. */
export interface MoveHost {
  camera(): Camera;
  readonly domElement: HTMLElement;
  readonly overlays: Group;
  /** Where the target is now, or undefined when it's gone. */
  placement(target: MoveTarget): Placement | undefined;
  /** Millimetres per model unit (D105), for snapping in millimetres. */
  unitScale(target: MoveTarget): number;
  /** The triad is being dragged: show the target at this placement in its parent's frame. */
  preview(target: MoveTarget, local: Matrix4): void;
  /** A drag ended: the target went from one placement to another (one undo step, D149). */
  commit(target: MoveTarget, before: Matrix4, after: Matrix4): void;
  /** camera-controls stops while a handle is pressed and dragged (R26). */
  setCameraEnabled(enabled: boolean): void;
  requestRender(): void;
}

/**
 * The Move tool (M13, D149): three's TransformControls on a handle at the target's origin, turned
 * to the chosen frame. A drag moves the handle, and the target goes with it: its new world placement
 * is the handle's change applied to where it was, and its new placement in its parent's frame
 * follows from that (D148).
 */
export class MoveTool {
  private readonly controls: TransformControls;
  private readonly handle = new Object3D();
  private mode: MoveMode | null = null;
  private target: MoveTarget | undefined;
  private frame: MoveFrame = 'local';
  private snapping = false;
  /** While dragging: where the target and the handle started. */
  private start: { placement: Placement; world: Matrix4; handle: Matrix4; last: Matrix4 } | undefined;

  constructor(private readonly host: MoveHost) {
    this.controls = new TransformControls(host.camera(), host.domElement);
    this.controls.setSpace('local');
    this.controls.enabled = false;
    this.handle.matrixAutoUpdate = true;
    host.overlays.add(this.handle);
    this.controls.addEventListener('change', () => host.requestRender());
    this.controls.addEventListener('dragging-changed', (event) => this.onDragging(event.value as boolean));
    this.controls.addEventListener('objectChange', () => this.onObjectChange());
  }

  get isActive(): boolean {
    return this.mode !== null && this.target !== undefined;
  }

  get isDragging(): boolean {
    return this.controls.dragging;
  }

  /** The tool's mode (null when it's off), its target and frame, as .NET sets them. */
  set(mode: MoveMode | null, target: MoveTarget | undefined, frame: MoveFrame): void {
    if (this.controls.dragging) {
      this.controls.pointerUp(asPointer({ x: 0, y: 0, button: 0 }));
    }
    this.mode = mode;
    this.target = target;
    this.frame = frame;
    if (mode && target && this.place()) {
      this.controls.setMode(mode);
      this.applySnapping();
      if (!this.controls.object) {
        this.controls.attach(this.handle);
        this.host.overlays.add(this.controls.getHelper());
      }
      this.controls.enabled = true;
    } else {
      this.detach();
    }
    this.host.requestRender();
  }

  /** The target moved some other way (typed values, undo): the handle goes where it is now. */
  refresh(): void {
    if (this.isActive && !this.controls.dragging && !this.place()) {
      this.detach();
    }
  }

  /** The handle under a client point, if any: a press there drags the triad, not the camera. */
  handleAt(clientX: number, clientY: number): string | null {
    if (!this.isActive) {
      return null;
    }
    const rect = this.host.domElement.getBoundingClientRect();
    const pointer = { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1, button: 0 };
    this.controls.pointerHover(asPointer(pointer));
    return this.controls.axis;
  }

  /** Ctrl held or released (D168). */
  setSnapping(snapping: boolean): void {
    if (snapping !== this.snapping) {
      this.snapping = snapping;
      this.applySnapping();
    }
  }

  /** The camera changed (projection toggle). */
  setCamera(camera: Camera): void {
    this.controls.camera = camera;
  }

  dispose(): void {
    this.detach();
    this.controls.dispose();
    this.handle.removeFromParent();
  }

  private detach(): void {
    if (this.controls.object) {
      this.controls.detach();
    }
    this.controls.getHelper().removeFromParent();
    this.controls.enabled = false;
    this.host.setCameraEnabled(true);
  }

  /** Puts the handle at the target's origin, turned to the frame; false when the target is gone. */
  private place(): boolean {
    const placement = this.target && this.host.placement(this.target);
    if (!placement) {
      return false;
    }
    const world = placement.parentWorld.clone().multiply(placement.local);
    const position = new Vector3().setFromMatrixPosition(world);
    const turn = this.frame === 'local' ? rotationOf(world) : this.frame === 'parent' ? rotationOf(placement.parentWorld) : new Quaternion();
    this.handle.position.copy(position);
    this.handle.quaternion.copy(turn);
    this.handle.scale.set(1, 1, 1);
    this.handle.updateMatrixWorld(true);
    return true;
  }

  private applySnapping(): void {
    const scale = this.target ? this.host.unitScale(this.target) : 1;
    this.controls.setTranslationSnap(this.snapping ? TranslationSnapMillimetres / scale : null);
    this.controls.setRotationSnap(this.snapping ? MathUtils.degToRad(RotationSnapDegrees) : null);
  }

  private onDragging(dragging: boolean): void {
    this.host.setCameraEnabled(!dragging);
    const target = this.target;
    if (dragging && target) {
      const placement = this.host.placement(target);
      if (placement) {
        this.handle.updateMatrixWorld(true);
        this.start = {
          placement,
          world: placement.parentWorld.clone().multiply(placement.local),
          handle: this.handle.matrixWorld.clone(),
          last: placement.local.clone(),
        };
      }
    } else if (!dragging && this.start && target) {
      const { placement, last } = this.start;
      this.start = undefined;
      if (!last.equals(placement.local)) {
        this.host.commit(target, placement.local, last);
      }
      this.place();
    }
  }

  private onObjectChange(): void {
    const target = this.target;
    if (!this.start || !target) {
      return;
    }
    this.handle.updateMatrixWorld(true);
    // The handle's change since the press, applied to where the target was.
    const change = this.handle.matrixWorld.clone().multiply(this.start.handle.clone().invert());
    const world = change.multiply(this.start.world);
    const local = this.start.placement.parentWorld.clone().invert().multiply(world);
    this.start.last = local;
    this.host.preview(target, local);
  }
}

/** TransformControls' pointer methods read only these (in device coordinates), whatever @types/three says. */
function asPointer(pointer: { x: number; y: number; button: number }): PointerEvent {
  return pointer as unknown as PointerEvent;
}

function rotationOf(matrix: Matrix4): Quaternion {
  const quaternion = new Quaternion();
  matrix.decompose(new Vector3(), quaternion, new Vector3());
  return quaternion;
}

/**
 * The origin frames (M13, D150): X, Y and Z axes in red, green and blue at each given placement's
 * origin, turned with it, drawn over everything at a constant length on screen.
 */
export class OriginFrames {
  readonly object = new Group();
  private readonly geometry: BufferGeometry;
  private readonly material = new LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });

  constructor() {
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], 3));
    this.geometry.setAttribute(
      'color',
      new Float32BufferAttribute([0.95, 0.26, 0.26, 0.95, 0.26, 0.26, 0.3, 0.85, 0.3, 0.3, 0.85, 0.3, 0.3, 0.55, 1, 0.3, 0.55, 1], 3),
    );
    this.object.renderOrder = 30;
  }

  /** The frames to draw, as world placements (their scale is ignored). */
  set(worlds: readonly Matrix4[]): void {
    this.object.clear();
    for (const world of worlds) {
      const axes = new LineSegments(this.geometry, this.material);
      axes.renderOrder = 30;
      axes.raycast = () => {};
      world.decompose(axes.position, axes.quaternion, new Vector3());
      this.object.add(axes);
    }
  }

  get count(): number {
    return this.object.children.length;
  }

  /** Before each frame: each frame's length in world units for {@link OriginFrameLength} pixels at its origin. */
  scale(worldPerPixel: (point: Vector3) => number): void {
    for (const axes of this.object.children) {
      axes.scale.setScalar(worldPerPixel(axes.position) * OriginFrameLength);
    }
  }

  dispose(): void {
    this.object.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
