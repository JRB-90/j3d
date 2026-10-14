import CameraControls from 'camera-controls';
import {
  Box3,
  DirectionalLight,
  Matrix4,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Timer,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type InstancedMesh,
  type Mesh,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LoadedModel, ModelId, Vector3Tuple } from '../import/types';
import { buildBrepObject } from './brep-object';
import {
  clippingPlanes,
  fitBox,
  fitDistance,
  lookRotation,
  nearestAngle,
  OrthoFrustumHeight,
  orthoVisibleHeight,
  orthoZoom,
  perspectiveDistance,
  PerspectiveFov,
  perspectiveVisibleHeight,
  Up,
  type BoxFit,
  type Projection,
} from './camera-math';
import { MaterialCache } from './materials';
import { ViewCube } from './view-cube';
import { HomeRegion, regionView, type ViewRegion } from './view-regions';

CameraControls.install({ THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster } });

/**
 * Image-based light from three's RoomEnvironment, plus a headlight that follows the camera
 * (docs/plan.md §6.3), under Khronos PBR Neutral tone mapping, which keeps base colours true and
 * rolls off highlights instead of clipping them. Tuned so the neutral grey reads as itself on the
 * faces turned to the viewer and the top faces aren't blown out.
 */
const EnvironmentIntensity = 0.6;
const HeadlightIntensity = 2.5;
/** Where the headlight sits relative to the view: up and to the left of the viewer. */
const HeadlightDirection = new Vector3(-0.35, 0.5, 1).normalize();

/** Visible height and distance before the first model arrives. */
const InitialVisibleHeight = 100;

/** What the last frame drew of the scene (not the view cube), and what the renderer holds on the GPU. */
export interface RenderStats {
  drawCalls: number;
  triangles: number;
  lines: number;
  geometries: number;
  textures: number;
  /** Bytes of the scene's vertex and index arrays, each shared geometry once: what the GPU holds and JS keeps a copy of. */
  bufferBytes: number;
}

export interface CameraState {
  projection: Projection;
  position: Vector3Tuple;
  target: Vector3Tuple;
  azimuth: number;
  polar: number;
  distance: number;
  zoom: number;
  /** World height visible at the target. */
  visibleHeight: number;
  near: number;
  far: number;
  /** A transition or a drag is still moving the camera. */
  moving: boolean;
}

interface SceneModel {
  object: Object3D;
  bounds: Box3;
  /** BREP models are built here and freed here; mesh models are freed by their import task. */
  dispose?: () => void;
}

/**
 * The Three.js view (docs/plan.md §6.3): a Z-up scene of every loaded model, an orthographic and a
 * perspective camera driven by camera-controls with J3D's mouse mapping, fit-all, the view cube and
 * Home button, and rendering on demand only.
 */
export class Viewer {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly orthographic: OrthographicCamera;
  private readonly perspective: PerspectiveCamera;
  private readonly controls: CameraControls;
  private readonly headlight = new DirectionalLight(0xffffff, HeadlightIntensity);
  private readonly environment: Texture;
  private readonly materials = new MaterialCache();
  private readonly models = new Map<ModelId, SceneModel>();
  private readonly viewCube = new ViewCube();
  private readonly timer = new Timer();
  private readonly cleanup: (() => void)[] = [];
  private projectionMode: Projection = 'orthographic';
  private sceneBounds = new Box3();
  private sceneSphere: Sphere | null = null;
  private width = 1;
  private height = 1;
  private frameRequest = 0;
  private looping = false;
  private interacting = false;
  private needsRender = true;
  private frames = 0;
  private lastFrame = { drawCalls: 0, triangles: 0, lines: 0 };

  constructor(private readonly host: HTMLElement) {
    // Z up (decision D18): set before any camera exists, and on each camera before camera-controls reads it.
    Object3D.DEFAULT_UP.copy(Up);

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // transparent over the viewport's CSS gradient
    renderer.autoClear = false; // the view cube is drawn over the scene in the same frame
    renderer.toneMapping = NeutralToneMapping;
    this.renderer = renderer;
    const canvas = renderer.domElement;
    canvas.dataset['testid'] = 'viewer-canvas';
    host.prepend(canvas);

    const pmrem = new PMREMGenerator(renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = EnvironmentIntensity;
    this.scene.add(this.headlight, this.headlight.target);

    this.orthographic = new OrthographicCamera();
    this.perspective = new PerspectiveCamera(PerspectiveFov);
    this.orthographic.up.copy(Up);
    this.perspective.up.copy(Up);

    const controls = new CameraControls(this.orthographic, canvas);
    controls.dollyToCursor = false;
    controls.minZoom = 1e-9;
    controls.maxZoom = Infinity;
    controls.minDistance = 1e-9;
    this.controls = controls;
    this.applyInputMapping();

    const { azimuth, polar } = regionView(HomeRegion);
    void controls.rotateTo(azimuth, polar, false);
    void controls.dollyTo(perspectiveDistance(InitialVisibleHeight), false);
    void controls.zoomTo(orthoZoom(InitialVisibleHeight), false);
    controls.update(0);

    this.listen(controls, 'controlstart', () => {
      this.interacting = true;
      this.requestFrame();
    });
    this.listen(controls, 'controlend', () => (this.interacting = false));
    this.listen(controls, 'control', () => this.requestFrame());
    this.listen(controls, 'transitionstart', () => this.requestFrame());

    this.resize(host.clientWidth, host.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        this.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(host);
    this.cleanup.push(() => observer.disconnect());

    this.listen(canvas, 'contextmenu', (event) => event.preventDefault());
    this.listen(window, 'keydown', (event) => this.onKeyDown(event));
    this.installViewCubeInput(canvas);
    this.installHomeButton();
    this.requestRender();
  }

  get projection(): Projection {
    return this.projectionMode;
  }

  /** Frames drawn so far, for tests of on-demand rendering. */
  get frameCount(): number {
    return this.frames;
  }

  /**
   * Finishes any camera transition at once and draws, for measurements in a page whose animation
   * frames don't run (a hidden tab or pane). Steps of 10 s take camera-controls' smoothing to its end.
   */
  settleCamera(): void {
    for (let step = 0; step < 100 && this.controls.update(10); step++) {
      // converging
    }
    this.render();
  }

  /** The last frame's scene draw calls and primitives, and the GPU objects held (for large-model measurements). */
  get renderStats(): RenderStats {
    const { geometries, textures } = this.renderer.info.memory;
    const arrays = new Set<ArrayBufferView>();
    this.scene.traverse((object) => {
      const geometry = (object as Partial<Mesh>).geometry;
      if (geometry) {
        Object.values(geometry.attributes).forEach((attribute) => arrays.add(attribute.array as ArrayBufferView));
        if (geometry.index) {
          arrays.add(geometry.index.array as ArrayBufferView);
        }
      }
      const matrix = (object as Partial<InstancedMesh>).instanceMatrix;
      if (matrix) {
        arrays.add(matrix.array);
      }
    });
    const bufferBytes = [...arrays].reduce((sum, array) => sum + array.byteLength, 0);
    return { ...this.lastFrame, geometries, textures, bufferBytes };
  }

  /** Adds a loaded model. The view fits only when it is the first model in an empty scene (D30). */
  add(model: LoadedModel): void {
    if (this.models.has(model.summary.id)) {
      return;
    }
    const wasEmpty = this.models.size === 0;
    const bounds = new Box3(new Vector3(...model.bounds.min), new Vector3(...model.bounds.max));
    let entry: SceneModel;
    if (model.content.kind === 'brep') {
      const built = buildBrepObject(model.summary.fileName, model.content.scene, this.materials);
      entry = { object: built.object, bounds, dispose: built.dispose };
    } else {
      entry = { object: model.content.root, bounds };
    }
    this.models.set(model.summary.id, entry);
    this.scene.add(entry.object);
    this.updateSceneBounds();
    if (wasEmpty) {
      this.fitAll(false);
    }
    this.requestRender();
  }

  /** Removes a model and frees what the viewer built for it. The camera doesn't move. */
  remove(id: ModelId): void {
    const entry = this.models.get(id);
    if (!entry) {
      return;
    }
    this.models.delete(id);
    entry.object.removeFromParent();
    entry.dispose?.();
    this.updateSceneBounds();
    this.requestRender();
  }

  /** Frames every model without changing the view direction (button and `F` key). */
  fitAll(animate = true): void {
    if (this.sceneBounds.isEmpty()) {
      return;
    }
    const position = this.controls.getPosition(new Vector3(), true);
    const target = this.controls.getTarget(new Vector3(), true);
    this.applyFit(fitBox(this.sceneBounds, lookRotation(position, target), this.width / this.height), animate);
  }

  /** Turns to a view cube region's view, keeping the distance and zoom (D31). */
  viewFrom(region: ViewRegion, animate = true): void {
    const { azimuth, polar } = regionView(region);
    const current = this.controls.getSpherical(new Spherical(), true).theta;
    void this.controls.rotateTo(nearestAngle(current, azimuth), polar, animate);
    this.requestRender();
  }

  /** Home: the isometric view, fitting everything. */
  home(): void {
    this.viewFrom(HomeRegion);
    this.fitAll();
  }

  /** Switches between orthographic and perspective, keeping the height visible at the target. */
  setProjection(projection: Projection): void {
    if (projection === this.projectionMode) {
      return;
    }
    this.controls.stop();
    this.controls.update(0);
    const visibleHeight = this.visibleHeight();
    this.projectionMode = projection;
    if (projection === 'perspective') {
      this.controls.camera = this.perspective;
      void this.controls.zoomTo(1, false);
      void this.controls.dollyTo(perspectiveDistance(visibleHeight), false);
    } else {
      this.controls.camera = this.orthographic;
      void this.controls.zoomTo(orthoZoom(visibleHeight), false);
    }
    this.applyInputMapping();
    this.controls.update(0);
    this.requestRender();
  }

  cameraState(): CameraState {
    const camera = this.camera;
    const spherical = this.controls.getSpherical(new Spherical(), false);
    return {
      projection: this.projectionMode,
      position: camera.position.toArray(),
      target: this.controls.getTarget(new Vector3(), false).toArray(),
      azimuth: spherical.theta,
      polar: spherical.phi,
      distance: spherical.radius,
      zoom: camera.zoom,
      visibleHeight: this.visibleHeight(),
      near: camera.near,
      far: camera.far,
      moving: this.looping || this.interacting || this.frameRequest !== 0,
    };
  }

  /** The view cube region under a client point, and where a region is on screen (for tests). */
  viewCubeRegionAt(clientX: number, clientY: number): ViewRegion | undefined {
    return this.viewCube.pick(clientX, clientY, this.renderer.domElement.getBoundingClientRect());
  }

  viewCubePointOf(region: ViewRegion): { x: number; y: number } | undefined {
    return this.viewCube.pointOf(region, this.renderer.domElement.getBoundingClientRect());
  }

  get hoveredRegion(): ViewRegion | undefined {
    return this.viewCube.hoveredRegion;
  }

  /** The models in the scene and how many objects each has, for test diagnostics. */
  sceneSummary(): { id: ModelId; name: string; objects: number; visible: boolean }[] {
    return [...this.models].map(([id, { object }]) => {
      let objects = 0;
      object.traverse(() => objects++);
      return { id, name: object.name, objects, visible: object.visible && object.parent === this.scene };
    });
  }

  /** Where a world point appears on screen, in client coordinates (for tests). */
  projectToClient(point: Vector3Tuple): { x: number; y: number } {
    const camera = this.camera;
    camera.updateMatrixWorld();
    const ndc = new Vector3(...point).project(camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
  }

  /**
   * Draws a frame and returns its premultiplied RGBA under each client point, or undefined outside
   * the canvas (for test diagnostics). The pixels are read in the same task as the draw, since the
   * drawing buffer isn't kept once the frame has been composited.
   */
  pixelsAt(points: readonly (readonly [number, number])[]): (number[] | undefined)[] {
    this.render();
    this.renderer.setRenderTarget(null);
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const gl = this.renderer.getContext();
    return points.map(([clientX, clientY]) => {
      const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
      const y = canvas.height - 1 - Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        return undefined;
      }
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    });
  }

  /** Schedules a redraw (scene changes, resize, hover). Idle cost is zero: nothing runs between requests. */
  requestRender(): void {
    this.needsRender = true;
    this.requestFrame();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    for (const dispose of this.cleanup.splice(0)) {
      dispose();
    }
    this.controls.dispose();
    for (const id of [...this.models.keys()]) {
      this.remove(id);
    }
    this.materials.dispose();
    this.viewCube.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private get camera(): OrthographicCamera | PerspectiveCamera {
    return this.projectionMode === 'orthographic' ? this.orthographic : this.perspective;
  }

  private visibleHeight(): number {
    return this.projectionMode === 'orthographic'
      ? orthoVisibleHeight(this.orthographic.zoom)
      : perspectiveVisibleHeight(this.controls.distance);
  }

  private applyFit(fit: BoxFit, animate: boolean): void {
    const { x, y, z } = fit.target;
    void this.controls.setFocalOffset(0, 0, 0, animate);
    void this.controls.moveTo(x, y, z, animate);
    void this.controls.dollyTo(fitDistance(fit), animate);
    if (this.projectionMode === 'orthographic') {
      void this.controls.zoomTo(orthoZoom(fit.visibleHeight), animate);
    }
    this.requestRender();
  }

  /** D16: left and middle drag pan, right drag rotates, the wheel zooms (ortho) or dollies (perspective). */
  private applyInputMapping(): void {
    const { ACTION } = CameraControls;
    const orthographic = this.projectionMode === 'orthographic';
    Object.assign(this.controls.mouseButtons, {
      left: ACTION.TRUCK,
      middle: ACTION.TRUCK,
      right: ACTION.ROTATE,
      wheel: orthographic ? ACTION.ZOOM : ACTION.DOLLY,
    });
    Object.assign(this.controls.touches, {
      one: ACTION.TOUCH_ROTATE,
      two: orthographic ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK,
      three: ACTION.TOUCH_TRUCK,
    });
  }

  private updateSceneBounds(): void {
    this.sceneBounds = new Box3();
    for (const { bounds } of this.models.values()) {
      this.sceneBounds.union(bounds);
    }
    this.sceneSphere = this.sceneBounds.isEmpty() ? null : this.sceneBounds.getBoundingSphere(new Sphere());
  }

  private resize(width: number, height: number): void {
    if (width < 1 || height < 1) {
      return;
    }
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const half = OrthoFrustumHeight / 2;
    Object.assign(this.orthographic, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.orthographic.updateProjectionMatrix();
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    // Draw now rather than on the next frame, so the canvas never shows a stretched image.
    this.render();
  }

  private requestFrame(): void {
    if (this.frameRequest === 0) {
      if (!this.looping) {
        this.timer.reset(); // don't let the idle time count as one long frame
      }
      this.frameRequest = requestAnimationFrame(this.tick);
    }
  }

  private readonly tick = (time: number): void => {
    this.frameRequest = 0;
    const moved = this.controls.update(Math.min(this.timer.update(time).getDelta(), 0.1));
    if (moved || this.needsRender) {
      this.render();
    }
    this.looping = moved || this.interacting;
    if (this.looping) {
      this.requestFrame();
    }
  };

  private render(): void {
    const camera = this.camera;
    const target = this.controls.getTarget(new Vector3(), false);
    const forward = camera.getWorldDirection(new Vector3());
    const { near, far } = clippingPlanes(this.projectionMode, camera.position, forward, this.sceneSphere);
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    this.headlight.position.copy(HeadlightDirection).applyQuaternion(camera.quaternion).add(target);
    this.headlight.target.position.copy(target);

    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    // Read before the view cube draws: the renderer's counts reset on every render call.
    const { calls, triangles, lines } = this.renderer.info.render;
    this.lastFrame = { drawCalls: calls, triangles, lines };
    this.viewCube.render(this.renderer, camera, this.width, this.height);
    this.needsRender = false;
    this.frames++;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target)) {
      this.fitAll();
    }
  }

  /**
   * Clicks on the view cube turn the view; they must not also start a camera-controls drag, so the
   * host intercepts them in the capture phase, before they reach the canvas.
   */
  private installViewCubeInput(canvas: HTMLCanvasElement): void {
    let pressed: ViewRegion | undefined;
    this.listen(
      this.host,
      'pointerdown',
      (event) => {
        pressed = event.target === canvas && event.button === 0 ? this.viewCubeRegionAt(event.clientX, event.clientY) : undefined;
        if (pressed) {
          event.stopPropagation();
        }
      },
      { capture: true },
    );
    this.listen(canvas, 'pointerup', (event) => {
      if (pressed && this.viewCubeRegionAt(event.clientX, event.clientY) === pressed) {
        this.viewFrom(pressed);
      }
      pressed = undefined;
    });
    const hover = (region: ViewRegion | undefined) => {
      if (this.viewCube.setHovered(region)) {
        canvas.style.cursor = region ? 'pointer' : '';
        this.requestRender();
      }
    };
    this.listen(canvas, 'pointermove', (event) =>
      hover(event.buttons === 0 || pressed ? this.viewCubeRegionAt(event.clientX, event.clientY) : undefined),
    );
    this.listen(canvas, 'pointerleave', () => hover(undefined));
  }

  private installHomeButton(): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'j3d-home-button';
    button.title = 'Home: isometric view, fit all';
    button.setAttribute('aria-label', 'Home view');
    button.dataset['testid'] = 'home-button';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';
    this.listen(button, 'click', () => this.home());
    this.host.append(button);
    this.cleanup.push(() => button.remove());
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  private listen<K extends keyof WindowEventMap>(target: Window, type: K, listener: (event: WindowEventMap[K]) => void): void;
  private listen(target: CameraControls, type: string, listener: () => void): void;
  private listen(
    target: HTMLElement | Window | CameraControls,
    type: string,
    listener: (event: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    const handler = listener as unknown as (event: unknown) => void;
    if (target instanceof CameraControls) {
      target.addEventListener(type as 'update', handler);
      this.cleanup.push(() => target.removeEventListener(type as 'update', handler));
    } else {
      target.addEventListener(type, handler, options);
      this.cleanup.push(() => target.removeEventListener(type, handler, options));
    }
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  );
}
