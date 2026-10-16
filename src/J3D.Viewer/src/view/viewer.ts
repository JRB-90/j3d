import CameraControls from 'camera-controls';
import {
  Box3,
  DirectionalLight,
  Group,
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
  type Intersection,
  type Mesh,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { BrepMeasurer, LoadedModel, ModelId, TreeNode, Vector3Tuple } from '../import/types';
import type { CameraSnapshot } from '../store/types';
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
import { MeasureTool, type MeasureModel } from './measure';
import type { MeasureInfo } from './measure-format';
import { HighlightMaterials, MeshParts, type Highlight, type HighlightKind, type ModelParts, type ScreenSpace } from './parts';
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

/** A pointer moving less than this between press and release is a click, not a drag (pixels). */
const ClickTolerance = 4;

/** One part of one model: a tree node that draws something (D77). */
export interface PartRef {
  id: ModelId;
  node: number;
}

/** What the keyboard asks of .NET, which owns selection, visibility and the undo history (D95, D99). */
export type ViewerCommand = 'clearSelection' | 'hide' | 'isolate' | 'showAll' | 'undo' | 'redo' | 'measure';

export interface ViewerOptions {
  /** A click that didn't drag: the part under the pointer, or undefined on empty space. */
  onPick?: (part: PartRef | undefined, additive: boolean) => void;
  onCommand?: (command: ViewerCommand) => void;
  /** The Measure tool's first pick, or null when it's dropped or finished (M7, D101). */
  onMeasurePending?: (info: MeasureInfo | null) => void;
  /** A measurement the Measure tool has kept. */
  onMeasured?: (info: MeasureInfo) => void;
  onMeasureError?: (message: string) => void;
  /** The camera moved, zoomed or changed projection: drawn with a different view (M8, D82). */
  onCameraChange?: () => void;
}

interface SceneModel {
  object: Object3D;
  bounds: Box3;
  parts: ModelParts;
  hidden: Set<number>;
  selected: number[];
  selection?: Highlight | undefined;
  tree: readonly TreeNode[];
  /** BREP models' measurement channel (M7). */
  measure?: BrepMeasurer | undefined;
  prototypes?: MeasureModel['prototypes'];
  /** Model units to millimetres (D105). */
  unitScale: number;
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
  private readonly highlights = new HighlightMaterials();
  /** Selection and hover overlays (D93), drawn after the models. */
  private readonly overlays = new Group();
  private readonly raycaster = new Raycaster();
  private hovered: (PartRef & { highlight: Highlight | undefined }) | undefined;
  private hoverPoint: { x: number; y: number } | undefined;
  private hoverRequest = 0;
  private lastPick = { milliseconds: 0, count: 0, longest: 0 };
  private readonly labels: HTMLElement;
  private readonly measureTool: MeasureTool;
  /** The view last drawn, to report camera changes. */
  private drawnView = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly options: ViewerOptions = {},
  ) {
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
    this.scene.add(this.headlight, this.headlight.target, this.overlays);

    // Measurement labels: HTML over the canvas, moved after every frame (D103).
    this.labels = document.createElement('div');
    this.labels.className = 'j3d-measure-labels';
    host.append(this.labels);
    this.measureTool = new MeasureTool(
      {
        hitAt: (x, y) => this.hitAt(x, y),
        screenAt: (x, y, hitPoint) => this.screenAt(x, y, hitPoint),
        model: (id) => this.measureModel(id),
        toClient: (world) => {
          this.camera.updateMatrixWorld();
          const ndc = world.clone().project(this.camera);
          const rect = this.renderer.domElement.getBoundingClientRect();
          return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, visible: ndc.z <= 1 };
        },
        overlays: this.overlays,
        highlights: this.highlights,
        labels: this.labels,
        requestRender: () => this.requestRender(),
      },
      {
        ...(options.onMeasurePending ? { onPending: options.onMeasurePending } : {}),
        ...(options.onMeasured ? { onMeasured: options.onMeasured } : {}),
        ...(options.onMeasureError ? { onError: options.onMeasureError } : {}),
      },
    );

    this.orthographic = new OrthographicCamera();
    this.perspective = new PerspectiveCamera(PerspectiveFov);
    this.orthographic.up.copy(Up);
    this.perspective.up.copy(Up);

    const controls = new CameraControls(this.orthographic, canvas);
    // The wheel and pinch zoom toward the pointer (D74, amending D19).
    controls.dollyToCursor = true;
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
    this.installPartInput(canvas);
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

  /**
   * Adds a loaded model. The view fits only when it is the first model in an empty scene (D30), and
   * never to a model imported again from its kept files, which comes back where the view was left
   * (D111). Such a model's hidden parts are applied before it's first drawn.
   */
  add(model: LoadedModel): void {
    if (this.models.has(model.summary.id)) {
      return;
    }
    const wasEmpty = this.models.size === 0;
    const bounds = new Box3(new Vector3(...model.bounds.min), new Vector3(...model.bounds.max));
    let entry: SceneModel;
    if (model.content.kind === 'brep') {
      const built = buildBrepObject(model.summary.fileName, model.content.scene, this.materials);
      entry = {
        object: built.object,
        bounds,
        parts: built.parts,
        hidden: new Set(),
        selected: [],
        tree: model.tree,
        measure: model.content.measure,
        prototypes: model.content.scene.prototypes,
        unitScale: 1,
        dispose: built.dispose,
      };
    } else {
      model.content.root.updateMatrixWorld(true);
      const parts = new MeshParts(model.content.nodes, model.tree);
      // glTF is in metres by its specification; STL and OBJ are taken as millimetres (D105, assumption 13).
      entry = { object: model.content.root, bounds, parts, hidden: new Set(), selected: [], tree: model.tree, unitScale: model.summary.format === 'gltf' ? 1000 : 1 };
    }
    this.models.set(model.summary.id, entry);
    this.scene.add(entry.object);
    if (model.restored?.hidden.length) {
      this.setPartState(model.summary.id, model.restored.hidden, []);
    }
    this.updateSceneBounds();
    if (wasEmpty && !model.restored) {
      this.fitAll(false);
    }
    this.requestRender();
  }

  /**
   * Removes a model and frees what the viewer built for it. The camera doesn't move. A deleted model
   * that an undo can bring back keeps its measurements, hidden (M8).
   */
  remove(id: ModelId, keepMeasurements = false): void {
    const entry = this.models.get(id);
    if (!entry) {
      this.measureTool.removeModel(id, keepMeasurements);
      return;
    }
    this.models.delete(id);
    this.measureTool.removeModel(id, keepMeasurements);
    this.setSelectionHighlight(entry, undefined);
    if (this.hovered?.id === id) {
      this.setHovered(undefined);
    }
    entry.object.removeFromParent();
    entry.dispose?.();
    this.updateSceneBounds();
    this.requestRender();
  }

  /** Drops a removed model's measurements for good: it can't come back (M8). */
  forgetModel(id: ModelId): void {
    this.measureTool.forgetModel(id);
  }

  /** Drops every kept measurement (Clear all, D110). */
  forgetMeasurements(): void {
    this.measureTool.forgetAll();
  }

  /**
   * Where the camera is, as drawn, for keeping it (D82). Not camera-controls' end values: its
   * smoothing comes to rest a little short of them, so they'd put the view back slightly off.
   */
  cameraSnapshot(): CameraSnapshot {
    return {
      projection: this.projectionMode,
      position: this.controls.getPosition(new Vector3(), false).toArray(),
      target: this.controls.getTarget(new Vector3(), false).toArray(),
      focalOffset: this.controls.getFocalOffset(new Vector3(), false).toArray(),
      zoom: this.camera.zoom,
    };
  }

  /** Puts the camera where a snapshot says, at once: the stored view when the page opens (D111). */
  restoreCamera({ projection, position, target, focalOffset, zoom }: CameraSnapshot): void {
    this.setProjection(projection);
    this.controls.stop();
    void this.controls.setLookAt(...position, ...target, false);
    void this.controls.setFocalOffset(...focalOffset, false);
    if (projection === 'orthographic') {
      void this.controls.zoomTo(zoom, false);
    }
    this.controls.update(0);
    this.requestRender();
  }

  /** Frames every visible part without changing the view direction (button and `F` key; D78). */
  fitAll(animate = true): void {
    const bounds = new Box3();
    for (const { parts } of this.models.values()) {
      parts.addVisibleBounds(bounds);
    }
    if (bounds.isEmpty()) {
      return;
    }
    const position = this.controls.getPosition(new Vector3(), true);
    const target = this.controls.getTarget(new Vector3(), true);
    this.applyFit(fitBox(bounds, lookRotation(position, target), this.width / this.height), animate);
  }

  /**
   * Applies a model's hidden and selected part nodes, as .NET holds them (D95). Hidden parts aren't
   * drawn or picked; the selection is drawn as an overlay (D93) and never includes hidden parts (D98).
   */
  setPartState(id: ModelId, hidden: readonly number[], selected: readonly number[]): void {
    const entry = this.models.get(id);
    if (!entry) {
      return;
    }
    const hiddenSet = new Set(hidden);
    if (!sameSet(hiddenSet, entry.hidden)) {
      entry.hidden = hiddenSet;
      entry.parts.setHidden(hiddenSet);
      if (this.hovered?.id === id && hiddenSet.has(this.hovered.node)) {
        this.setHovered(undefined);
      }
    }
    const shown = selected.filter((node) => !hiddenSet.has(node));
    if (!sameSet(new Set(shown), new Set(entry.selected))) {
      entry.selected = shown;
      this.setSelectionHighlight(entry, shown.length > 0 ? entry.parts.highlight(shown, 'selected', this.highlights) : undefined);
    }
    this.requestRender();
  }

  /** The visible part under a client point, if any. */
  pickPart(clientX: number, clientY: number): PartRef | undefined {
    const found = this.hitAt(clientX, clientY);
    return found && { id: found.id, node: found.node };
  }

  /** Turns the Measure tool on or off (D79); .NET decides, from the toolbar or the M key. */
  setMeasureMode(active: boolean): void {
    if (active) {
      this.setHovered(undefined);
    }
    this.measureTool.setActive(active);
  }

  /** Shows exactly these kept measurements (D108). */
  setMeasurements(shown: readonly string[]): void {
    this.measureTool.setShown(shown);
  }

  /** The Measure tool's state, for tests: whether it's on, what it would pick, the pending pick and the kept measurements. */
  measureState(): {
    active: boolean;
    busy: boolean;
    hovered: { id: string; kind: string; node: number; index: number } | null;
    pending: { id: string; kind: string; node: number; index: number } | null;
    measurements: { id: string; label: string; shown: boolean }[];
  } {
    const brief = (picked: ReturnType<MeasureTool['entityAt']>) =>
      picked
        ? { id: picked.id, kind: picked.entity.kind, node: picked.entity.node, index: picked.entity.kind === 'point' ? -1 : picked.entity.ref.index }
        : null;
    return {
      active: this.measureTool.isActive,
      busy: this.measureTool.busy,
      hovered: brief(this.measureTool.hoveredEntity),
      pending: brief(this.measureTool.pendingEntity),
      measurements: this.measureTool.list(),
    };
  }

  /** What the Measure tool would pick at a client point (for tests). */
  entityAt(clientX: number, clientY: number): { id: string; kind: string; node: number; index: number } | null {
    const picked = this.measureTool.entityAt(clientX, clientY);
    return picked
      ? { id: picked.id, kind: picked.entity.kind, node: picked.entity.node, index: picked.entity.kind === 'point' ? -1 : picked.entity.ref.index }
      : null;
  }

  /** The nearest visible part surface under a client point, with the intersection. */
  private hitAt(clientX: number, clientY: number): { id: ModelId; node: number; hit: Intersection } | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const started = performance.now();
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const entries = [...this.models];
    const hits = this.raycaster.intersectObjects(
      entries.map(([, entry]) => entry.object),
      true,
    );
    let found: { id: ModelId; node: number; hit: Intersection } | undefined;
    for (const hit of hits) {
      const part = this.partOf(entries, hit);
      if (part) {
        found = { ...part, hit };
        break;
      }
    }
    const milliseconds = performance.now() - started;
    this.lastPick = { milliseconds, count: this.lastPick.count + 1, longest: Math.max(this.lastPick.longest, milliseconds) };
    return found;
  }

  /** Where world points land on screen around a client point, for picking vertices and edges (D107). */
  private screenAt(x: number, y: number, hitPoint: Vector3): ScreenSpace {
    const camera = this.camera;
    camera.updateMatrixWorld();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const view = camera.matrixWorldInverse;
    const depthOf = (world: Vector3) => -world.clone().applyMatrix4(view).z;
    return {
      x,
      y,
      hitDepth: depthOf(hitPoint),
      project: (world) => {
        const ndc = world.clone().project(camera);
        return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, depth: depthOf(world) };
      },
    };
  }

  private measureModel(id: ModelId): MeasureModel | undefined {
    const entry = this.models.get(id);
    if (!entry) {
      return undefined;
    }
    return {
      parts: entry.parts,
      measure: entry.measure,
      prototypes: entry.prototypes,
      unitScale: entry.unitScale,
      nameOf: (node) => entry.tree[node]?.name || '(unnamed)',
    };
  }

  /** The part under the pointer, faintly highlighted (D89). */
  get hoveredPart(): PartRef | undefined {
    return this.hovered && { id: this.hovered.id, node: this.hovered.node };
  }

  /** How long picks take (for the large-model measurements, D89). Reading it resets the longest. */
  takePickTimes(): { milliseconds: number; count: number; longest: number } {
    const times = this.lastPick;
    this.lastPick = { ...times, longest: 0 };
    return times;
  }

  /** What the viewer has applied to a model: its hidden and highlighted parts (for tests). */
  partState(id: ModelId): { parts: number[]; hidden: number[]; selected: number[] } | undefined {
    const entry = this.models.get(id);
    return entry && { parts: [...entry.parts.partNodes], hidden: [...entry.hidden], selected: [...entry.selected] };
  }

  /**
   * A client point where a part can be clicked: the first of a grid over its on-screen bounds that
   * picks it, or undefined when it's hidden or covered everywhere (for tests).
   */
  partPoint(id: ModelId, node: number): { x: number; y: number } | undefined {
    const entry = this.models.get(id);
    if (!entry || entry.hidden.has(node)) {
      return undefined;
    }
    const others = new Set(entry.parts.partNodes);
    others.delete(node);
    entry.parts.setHidden(new Set([...others, ...entry.hidden]));
    const bounds = entry.parts.addVisibleBounds(new Box3());
    entry.parts.setHidden(entry.hidden);
    if (bounds.isEmpty()) {
      return undefined;
    }
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((corner) =>
      this.projectToClient([
        corner & 1 ? bounds.max.x : bounds.min.x,
        corner & 2 ? bounds.max.y : bounds.min.y,
        corner & 4 ? bounds.max.z : bounds.min.z,
      ]),
    );
    const left = Math.min(...corners.map((c) => c.x));
    const right = Math.max(...corners.map((c) => c.x));
    const top = Math.min(...corners.map((c) => c.y));
    const bottom = Math.max(...corners.map((c) => c.y));
    const steps = 9;
    for (const fy of gridFractions(steps)) {
      for (const fx of gridFractions(steps)) {
        const point = { x: left + (right - left) * fx, y: top + (bottom - top) * fy };
        const picked = this.pickPart(point.x, point.y);
        if (picked?.id === id && picked.node === node && this.viewCubeRegionAt(point.x, point.y) === undefined) {
          return point;
        }
      }
    }
    return undefined;
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
    cancelAnimationFrame(this.hoverRequest);
    this.frameRequest = 0;
    this.hoverRequest = 0;
    for (const dispose of this.cleanup.splice(0)) {
      dispose();
    }
    this.controls.dispose();
    for (const id of [...this.models.keys()]) {
      this.remove(id);
    }
    this.measureTool.dispose();
    this.labels.remove();
    this.materials.dispose();
    this.highlights.dispose();
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
    this.measureTool.updateLabels();
    this.needsRender = false;
    this.frames++;

    const view = `${this.projectionMode} ${camera.zoom} ${camera.matrixWorld.elements.join(' ')}`;
    if (view !== this.drawnView) {
      this.drawnView = view;
      this.options.onCameraChange?.();
    }
  }

  /**
   * `F` fits; the rest are .NET's commands (D99). None applies while focus is in a text input, where
   * Ctrl+Z and Ctrl+Y stay the input's own.
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || isEditable(event.target)) {
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey ? keyCommand(key, event.shiftKey, true) : keyCommand(key, event.shiftKey, false);
    if (command === 'fit') {
      this.fitAll();
    } else if (command) {
      if (command === 'clearSelection') {
        this.measureTool.cancelPending(); // Esc also drops a half-done measurement (D101)
      }
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault(); // not the browser's own undo
      }
      this.options.onCommand?.(command);
    }
  }

  /** The part an intersection hit, unless the model hides it. */
  private partOf(entries: [ModelId, SceneModel][], hit: Intersection): PartRef | undefined {
    for (const [id, entry] of entries) {
      let object: Object3D | null = hit.object;
      while (object && object !== entry.object) {
        object = object.parent;
      }
      if (object) {
        const node = entry.parts.nodeOf(hit);
        return node >= 0 && !entry.hidden.has(node) ? { id, node } : undefined;
      }
    }
    return undefined;
  }

  private setSelectionHighlight(entry: SceneModel, highlight: Highlight | undefined): void {
    if (entry.selection) {
      this.overlays.remove(entry.selection.object);
      entry.selection.dispose();
    }
    entry.selection = highlight;
    if (highlight) {
      this.overlays.add(highlight.object);
    }
  }

  private setHovered(part: PartRef | undefined): void {
    if (part?.id === this.hovered?.id && part?.node === this.hovered?.node) {
      return;
    }
    if (this.hovered?.highlight) {
      this.overlays.remove(this.hovered.highlight.object);
      this.hovered.highlight.dispose();
    }
    const entry = part && this.models.get(part.id);
    const highlight = entry && part ? entry.parts.highlight([part.node], 'hovered' satisfies HighlightKind, this.highlights) : undefined;
    if (highlight) {
      this.overlays.add(highlight.object);
    }
    this.hovered = part && { ...part, highlight };
    this.renderer.domElement.style.cursor = part ? 'pointer' : '';
    this.requestRender();
  }

  /**
   * Hover pre-highlights the part under the pointer, with at most one pick per animation frame
   * (D89); a click that didn't drag picks a part, or empty space (D77). Pressing on the view cube
   * never gets here (see {@link installViewCubeInput}).
   */
  private installPartInput(canvas: HTMLCanvasElement): void {
    let press: { id: number; x: number; y: number } | undefined;
    this.listen(canvas, 'pointerdown', (event) => {
      press = event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined;
      this.hoverPoint = undefined;
      this.setHovered(undefined);
    });
    this.listen(canvas, 'pointerup', (event) => {
      const start = press;
      press = undefined;
      if (
        !start ||
        start.id !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > ClickTolerance ||
        this.viewCubeRegionAt(event.clientX, event.clientY) !== undefined
      ) {
        return;
      }
      if (this.measureTool.isActive) {
        void this.measureTool.click(event.clientX, event.clientY);
      } else {
        this.options.onPick?.(this.pickPart(event.clientX, event.clientY), event.ctrlKey || event.metaKey);
      }
    });
    this.listen(canvas, 'pointermove', (event) => {
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || this.interacting) {
        return;
      }
      this.hoverPoint = { x: event.clientX, y: event.clientY };
      if (this.hoverRequest === 0) {
        this.hoverRequest = requestAnimationFrame(() => {
          this.hoverRequest = 0;
          const point = this.hoverPoint;
          const over = point && this.viewCubeRegionAt(point.x, point.y) === undefined ? point : undefined;
          if (this.measureTool.isActive) {
            this.measureTool.hover(over?.x, over?.y);
          } else {
            this.setHovered(over && this.pickPart(over.x, over.y));
          }
        });
      }
    });
    this.listen(canvas, 'pointerleave', () => {
      this.hoverPoint = undefined;
      this.setHovered(undefined);
      this.measureTool.hover(undefined, undefined);
    });
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

/** D99's keys: `F` fits; Esc, H, I, Shift+H, Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z) go to .NET. */
export function keyCommand(key: string, shift: boolean, control: boolean): ViewerCommand | 'fit' | undefined {
  if (control) {
    if (key === 'z') {
      return shift ? 'redo' : 'undo';
    }
    return key === 'y' ? 'redo' : undefined;
  }
  switch (key) {
    case 'f':
      return 'fit';
    case 'escape':
      return 'clearSelection';
    case 'h':
      return shift ? 'showAll' : 'hide';
    case 'i':
      return shift ? undefined : 'isolate';
    case 'm':
      return shift ? undefined : 'measure';
    default:
      return undefined;
  }
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/** Fractions across a range, from the middle outwards: 0.5, then nearer the edges. */
function gridFractions(steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => (i + 0.5) / steps).sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  );
}
