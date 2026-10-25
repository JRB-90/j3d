import CameraControls from 'camera-controls';
import {
  Box3,
  DirectionalLight,
  Group,
  MathUtils,
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
import { editedStats } from '../edit/stats';
import { ModelStructure, sameEdits, type ModelEdits } from '../edit/structure';
import type { BrepMeasurer, KeptPlacement, LoadedModel, ModelId, ModelStats, Vector3Tuple } from '../import/types';
import type { CameraSnapshot } from '../store/types';
import { buildBrepObject } from './brep-object';
import { buildExportScene, exportFileName, type ExportSource } from './export-scene';
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
import { FeatureSelection, type FeatureSelectionInfo } from './features';
import { MeasureTool, type MeasureModel, type Picked } from './measure';
import type { MeasureInfo } from './measure-format';
import type { MeshExportFormat } from './mesh-export';
import { MoveTool, OriginFrames, type MoveFrame, type MoveMode, type MoveTarget } from './move';
import { OrderIndependentTransparency, sceneMaterials, type SceneMaterials } from './oit';
import {
  HighlightMaterials,
  MeshParts,
  ModelFrame,
  type Highlight,
  type HighlightKind,
  type ModelParts,
  type Placement,
  type ScreenSpace,
} from './parts';
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

/** What the keyboard asks of .NET, which owns selection, visibility and the undo history (D95, D99, D162). */
export type ViewerCommand =
  | 'clearSelection'
  | 'hide'
  | 'isolate'
  | 'showAll'
  | 'undo'
  | 'redo'
  | 'measure'
  | 'selectModels'
  | 'selectObjects'
  | 'selectFeatures'
  | 'moveTranslate'
  | 'moveRotate'
  | 'originFrames'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'delete'
  | 'group'
  | 'ungroup'
  | 'rename';

/**
 * The Move tool's target and where it is (M13, D148): its placement in its parent's frame and that
 * frame in the world, column-major, with the model's millimetres per unit (D105).
 */
export interface MoveTargetInfo {
  id: ModelId;
  node: number;
  local: number[];
  parentWorld: number[];
  unitScale: number;
}

/** How often the fields hear about a drag (D149: they follow it). */
const MoveReportInterval = 100;

/** What a click selects (M12, D146): whole models, placed parts, or BREP faces, edges and vertices. */
export type SelectionMode = 'model' | 'object' | 'feature';

/** A right click that didn't drag (D164): where, the part under it, and whether there's an entity to measure from. */
export interface ContextTarget {
  x: number;
  y: number;
  part: PartRef | undefined;
  canMeasure: boolean;
}

export interface ViewerOptions {
  /** A click that didn't drag: the part under the pointer, or undefined on empty space. */
  onPick?: (part: PartRef | undefined, additive: boolean) => void;
  onCommand?: (command: ViewerCommand) => void;
  /** The Measure tool's reference, or null when there's none (D147). */
  onMeasureReference?: (info: MeasureInfo | null) => void;
  /** The reference against the last click, or null. */
  onMeasureResult?: (info: MeasureInfo | null) => void;
  onMeasureError?: (message: string) => void;
  /** The features selected in Feature mode, once their values are known (D146, D163). */
  onFeatures?: (selection: FeatureSelectionInfo) => void;
  /** A right click that didn't drag, for the context menu (D164). */
  onContextMenu?: (target: ContextTarget) => void;
  /** The camera moved, zoomed or changed projection: drawn with a different view (M8, D82). */
  onCameraChange?: () => void;
  /** The Move tool's target and where it is, or null when there's none (M13, D148). */
  onMoveTarget?: (info: MoveTargetInfo | null) => void;
  /** A drag of the triad ended: one undo step (D149), placements in the parent's frame. */
  onMoved?: (target: MoveTarget, before: number[], after: number[]) => void;
}

interface SceneModel {
  object: Object3D;
  bounds: Box3;
  parts: ModelParts;
  hidden: Set<number>;
  selected: number[];
  selection?: Highlight | undefined;
  /** Its tree as edited (M14). */
  structure: ModelStructure;
  /** Its file name and geometry as edited, for exports (M9). */
  name: string;
  content: () => ExportSource['content'];
  /** What it draws as imported, which edits change (M14). */
  stats: ModelStats;
  /** Its import's content, for its counts once edited. */
  imported: LoadedModel['content'];
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
  private hovered: (PartRef & { whole: boolean; highlight: Highlight | undefined }) | undefined;
  private hoverPoint: { x: number; y: number } | undefined;
  private hoverRequest = 0;
  private lastPick = { milliseconds: 0, count: 0, longest: 0 };
  private readonly labels: HTMLElement;
  private readonly measureTool: MeasureTool;
  private readonly features: FeatureSelection;
  private selectionMode: SelectionMode = 'object';
  /** The entity under the last right click, for "Measure from here" (D164). */
  private contextEntity: Picked | undefined;
  /** The object the Move tool moves (M13). */
  private moveTarget: MoveTarget | undefined;
  /** A press on the triad's handles: not a click on a part. */
  private handlePress = false;
  /** The view last drawn, to report camera changes. */
  private drawnView = '';
  /** Weighted blended OIT where the GPU supports it (D90, D130), and whether the last frame used it. */
  private readonly oit: OrderIndependentTransparency | undefined;
  private oitEnabled = true;
  private oitUsed = false;
  /** The models' materials, sorted again when a model comes or goes. */
  private sortedMaterials: SceneMaterials | undefined;
  /** The Move tool (M13, D149) and the origin frames (D150) with the objects they're drawn at. */
  private readonly moveTool: MoveTool;
  private readonly originFrames = new OriginFrames();
  private originTargets: MoveTarget[] = [];
  private lastMoveReport = 0;

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
    this.oit = OrderIndependentTransparency.isSupported(renderer) ? new OrderIndependentTransparency(renderer) : undefined;
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
    const measureHost = {
      hitAt: (x: number, y: number) => this.hitAt(x, y),
      screenAt: (x: number, y: number, hitPoint: Vector3) => this.screenAt(x, y, hitPoint),
      model: (id: ModelId) => this.measureModel(id),
      toClient: (world: Vector3) => {
        this.camera.updateMatrixWorld();
        const ndc = world.clone().project(this.camera);
        const rect = this.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, visible: ndc.z <= 1 };
      },
      overlays: this.overlays,
      highlights: this.highlights,
      labels: this.labels,
      requestRender: () => this.requestRender(),
    };
    this.measureTool = new MeasureTool(measureHost, {
      ...(options.onMeasureReference ? { onReference: options.onMeasureReference } : {}),
      ...(options.onMeasureResult ? { onResult: options.onMeasureResult } : {}),
      ...(options.onMeasureError ? { onError: options.onMeasureError } : {}),
    });
    this.features = new FeatureSelection(
      measureHost,
      (selection) => options.onFeatures?.(selection),
      (message) => options.onMeasureError?.(message),
    );

    this.orthographic = new OrthographicCamera();
    this.perspective = new PerspectiveCamera(PerspectiveFov);
    this.overlays.add(this.originFrames.object);
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

    this.moveTool = new MoveTool({
      camera: () => this.camera,
      domElement: canvas,
      overlays: this.overlays,
      placement: (target) => this.placementOf(target),
      unitScale: (target) => this.models.get(target.id)?.unitScale ?? 1,
      preview: (target, local) => this.applyPlacement(target, local, true),
      commit: (target, before, after) => {
        this.applyPlacement(target, after, false);
        this.options.onMoved?.(target, before.toArray(), after.toArray());
      },
      setCameraEnabled: (enabled) => (this.controls.enabled = enabled),
      requestRender: () => this.requestRender(),
    });

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
    // Ctrl snaps the triad while it's held (D168).
    this.listen(window, 'keydown', (event) => this.moveTool.setSnapping(event.ctrlKey || event.key === 'Control'));
    this.listen(window, 'keyup', (event) => this.moveTool.setSnapping(event.ctrlKey && event.key !== 'Control'));
    this.listen(window, 'blur', () => this.moveTool.setSnapping(false));
    this.installViewCubeInput(canvas);
    this.installMoveInput(canvas);
    this.installPartInput(canvas);
    this.installHomeButton();
    this.requestRender();
  }

  get projection(): Projection {
    return this.projectionMode;
  }

  /**
   * How the last frame drew translucent surfaces: order-independently (D90), sorted (nothing
   * translucent, or turned off), or sorted because the GPU can't (D130).
   */
  get transparency(): 'oit' | 'sorted' | 'unsupported' {
    return !this.oit ? 'unsupported' : this.oitUsed ? 'oit' : 'sorted';
  }

  /** Turns order-independent transparency off and on again, for tests that compare the two (D130). */
  setOrderIndependentTransparency(enabled: boolean): void {
    this.oitEnabled = enabled;
    this.requestRender();
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
    const structure = new ModelStructure(model.tree);
    if (model.content.kind === 'brep') {
      const built = buildBrepObject(model.summary.fileName, model.content.scene, this.materials);
      entry = {
        object: built.object,
        bounds,
        parts: built.parts,
        hidden: new Set(),
        selected: [],
        structure,
        name: model.summary.fileName,
        content: () => ({ kind: 'brep', scene: built.parts.exportScene() }),
        stats: model.stats,
        imported: model.content,
        measure: model.content.measure,
        prototypes: model.content.scene.prototypes,
        unitScale: 1,
        dispose: built.dispose,
      };
    } else {
      // The model's frame (D169) is a group around the import's root, which keeps its own placement
      // (glTF's turn to Z-up); an STL's or OBJ's root is its first node, so copies of it go beside it here.
      const frame = new Group();
      frame.name = model.summary.fileName;
      frame.add(model.content.root);
      frame.updateMatrixWorld(true);
      const parts = new MeshParts(model.content.nodes, model.tree, frame);
      const sceneRoot = model.summary.format === 'gltf';
      entry = {
        object: frame,
        bounds,
        parts,
        hidden: new Set(),
        selected: [],
        structure,
        name: model.summary.fileName,
        content: () => ({ kind: 'mesh', nodes: parts.nodeObjects, sceneRoot }),
        stats: model.stats,
        imported: model.content,
        // glTF is in metres by its specification, unless it's J3D's own (D123); STL and OBJ are taken as
        // millimetres (D105, assumption 13).
        unitScale: model.content.unitScale ?? 1,
      };
    }
    this.models.set(model.summary.id, entry);
    this.scene.add(entry.object);
    this.sortedMaterials = undefined;
    // A kept model's edits (M14), checked as it loaded (R25), then its moves (M13, D145), which since
    // M14 include the placements its edits worked out.
    if (model.restored?.edits) {
      entry.structure = new ModelStructure(model.tree, model.restored.edits);
      entry.parts.setStructure(entry.structure);
    }
    for (const { node, matrix } of [...(model.restored?.placements ?? [])].sort((a, b) => a.node - b.node)) {
      entry.parts.setPlacement(node, new Matrix4().fromArray(matrix));
    }
    if (model.restored?.placements?.length || model.restored?.edits) {
      const moved = entry.parts.addVisibleBounds(new Box3());
      entry.bounds = moved.isEmpty() ? entry.bounds : moved;
    }
    if (model.restored?.hidden.length) {
      this.setPartState(model.summary.id, model.restored.hidden, []);
    }
    this.updateSceneBounds();
    if (wasEmpty && !model.restored) {
      this.fitAll(false);
    }
    this.requestRender();
  }

  /** Removes a model and frees what the viewer built for it, with any measurement or feature on it. The camera doesn't move. */
  remove(id: ModelId): void {
    this.measureTool.removeModel(id);
    this.features.removeModel(id);
    if (this.contextEntity?.id === id) {
      this.contextEntity = undefined;
    }
    const entry = this.models.get(id);
    if (!entry) {
      return;
    }
    this.models.delete(id);
    this.setSelectionHighlight(entry, undefined);
    if (this.hovered?.id === id) {
      this.setHovered(undefined);
    }
    entry.object.removeFromParent();
    this.sortedMaterials = undefined;
    entry.dispose?.();
    this.updateSceneBounds();
    if (this.originTargets.some((target) => target.id === id)) {
      this.setOriginFrames(this.originTargets.filter((target) => target.id !== id));
    }
    this.moveTool.refresh();
    this.reportMoveTarget(true);
    this.requestRender();
  }

  /**
   * The Move tool (M13, D149): .NET turns it on with its mode, the one object it moves and the frame
   * the triad and fields use (D148, D167), or off with a null mode or no target.
   */
  setMoveTool(mode: MoveMode | null, target: MoveTarget | undefined, frame: MoveFrame): void {
    this.moveTarget = mode && target && this.placementOf(target) ? target : undefined;
    this.moveTool.set(mode, this.moveTarget, frame);
    this.reportMoveTarget(true);
  }

  /** Gives a node (or a model, node -1) a placement in its parent's frame: a typed move, an undo or a redo. */
  setPlacement(id: ModelId, node: number, matrix: readonly number[]): void {
    this.applyPlacement({ id, node }, new Matrix4().fromArray(matrix), false);
  }

  /** Where a node (or a model) is, for .NET's fields and for tests (M13). */
  placementOf(target: MoveTarget): Placement | undefined {
    const entry = this.models.get(target.id);
    if (!entry || (target.node !== ModelFrame && !entry.structure.isLive(target.node))) {
      return undefined;
    }
    return entry.parts.placement(target.node);
  }

  /**
   * A model's tree as edited (M14), as .NET holds it: copies and new assemblies are added, moved nodes
   * stay where they are in the world, removed ones go from view, and the selection, measurements and
   * tools let go of what's gone. Returns the placements worked out again, to keep, and what the model
   * now draws; undefined when the edits don't fit the model or nothing changed.
   */
  setStructure(id: ModelId, edits: ModelEdits): { placements: KeptPlacement[]; stats: ModelStats } | undefined {
    const entry = this.models.get(id);
    if (!entry || sameEdits(entry.structure.edits, edits)) {
      return undefined;
    }
    let structure: ModelStructure;
    try {
      structure = new ModelStructure(entry.structure.fileTree, edits);
    } catch (error) {
      console.error(`J3D: ${entry.name}'s edits don't fit its tree.`, error);
      return undefined;
    }
    entry.structure = structure;
    const placements = entry.parts.setStructure(structure);
    const gone = new Set(structure.nodes.flatMap((_, node) => (structure.isLive(node) ? [] : [node])));
    this.measureTool.dropHidden(id, gone);
    this.features.dropHidden(id, gone);
    if (this.hovered?.id === id) {
      this.setHovered(undefined);
    }
    // Nothing selected moves in an edit, so the overlay changes only when a selected part went.
    const selected = entry.selected.filter((node) => structure.isLive(node));
    if (selected.length !== entry.selected.length) {
      entry.selected = selected;
      this.setSelectionHighlight(entry, selected.length > 0 ? entry.parts.highlight(selected, 'selected', this.highlights) : undefined);
    }
    const bounds = entry.parts.addVisibleBounds(new Box3());
    entry.bounds = bounds.isEmpty() ? entry.bounds : bounds;
    this.updateSceneBounds();
    if (this.originTargets.length > 0) {
      this.setOriginFrames(this.originTargets);
    }
    this.moveTool.refresh();
    this.reportMoveTarget(true);
    this.requestRender();
    return { placements, stats: editedStats(entry.imported, structure, entry.stats) };
  }

  /** Draws the origin frames at these objects (D150), or none. */
  setOriginFrames(targets: readonly MoveTarget[]): void {
    this.originTargets = targets.filter((target) => this.placementOf(target));
    this.originFrames.set(
      this.originTargets.map((target) => {
        const { local, parentWorld } = this.placementOf(target)!;
        return parentWorld.multiply(local);
      }),
    );
    this.requestRender();
  }

  /** The triad's handle under a client point ('X', 'XY', 'Z', 'E'…), or null: for tests that drag it. */
  moveHandleAt(clientX: number, clientY: number): string | null {
    return this.moveTool.handleAt(clientX, clientY);
  }

  /** The Move tool and the origin frames, for tests. */
  moveState(): { active: boolean; dragging: boolean; target: MoveTarget | null; originFrames: number } {
    return {
      active: this.moveTool.isActive,
      dragging: this.moveTool.isDragging,
      target: this.moveTool.isActive && this.moveTarget ? this.moveTarget : null,
      originFrames: this.originFrames.count,
    };
  }

  /**
   * Moves a target to a placement in its parent's frame. While the triad is dragged only the drawing
   * follows; afterwards (and for typed moves, undo and redo) the selection overlay, bounds, frames
   * and anything measured on the moved parts catch up, and .NET hears where the target is.
   */
  private applyPlacement(target: MoveTarget, local: Matrix4, dragging: boolean): void {
    const entry = this.models.get(target.id);
    if (!entry || !this.placementOf(target)) {
      return;
    }
    const moved = entry.parts.setPlacement(target.node, local);
    if (dragging) {
      entry.selection?.object.removeFromParent();
    } else {
      const movedSet = new Set(moved);
      this.measureTool.dropHidden(target.id, movedSet);
      this.features.dropHidden(target.id, movedSet);
      if (this.hovered?.id === target.id) {
        this.setHovered(undefined);
      }
      if (entry.selected.length > 0) {
        this.setSelectionHighlight(entry, entry.parts.highlight(entry.selected, 'selected', this.highlights));
      }
      const bounds = entry.parts.addVisibleBounds(new Box3());
      entry.bounds = bounds.isEmpty() ? entry.bounds : bounds;
      this.updateSceneBounds();
      this.moveTool.refresh();
    }
    if (this.originTargets.length > 0) {
      this.setOriginFrames(this.originTargets);
    }
    this.reportMoveTarget(!dragging);
    this.requestRender();
  }

  /** Tells .NET where the Move tool's target is: at once, or at most every 100 ms during a drag. */
  private reportMoveTarget(now: boolean): void {
    const time = performance.now();
    if (!now && time - this.lastMoveReport < MoveReportInterval) {
      return;
    }
    this.lastMoveReport = time;
    const target = this.moveTool.isActive ? this.moveTarget : undefined;
    const placement = target && this.placementOf(target);
    this.options.onMoveTarget?.(
      target && placement
        ? {
            ...target,
            local: placement.local.toArray(),
            parentWorld: placement.parentWorld.toArray(),
            unitScale: this.models.get(target.id)?.unitScale ?? 1,
          }
        : null,
    );
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

  /**
   * The visible scene, or only the selection, as a GLB or STL file (M9, D83, D119), in millimetres
   * and Z-up (D118, D122), named after its model when it all comes from one (D128). Rejects when
   * there's nothing to save.
   */
  async exportMesh(format: MeshExportFormat, selection: boolean): Promise<{ fileName: string; bytes: Uint8Array<ArrayBuffer> }> {
    const sources: ExportSource[] = [...this.models.values()].map(({ name, structure, content, hidden, selected, unitScale }) => ({
      name,
      tree: structure.nodes,
      order: structure.order(),
      content: content(),
      hidden,
      selected,
      unitScale,
    }));
    const built = buildExportScene(sources, selection, format === 'glb' ? 'gltf' : 'stl');
    try {
      if (built.models.length === 0) {
        throw new Error(selection ? 'Nothing is selected.' : 'There are no visible parts to export.');
      }
      const { writeMeshFile } = await import('./mesh-export');
      const bytes = await writeMeshFile(built.scene, format, this.renderer);
      return { fileName: exportFileName(built.models, selection, format === 'glb' ? 'glb' : 'stl'), bytes };
    } finally {
      built.dispose();
    }
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
      if (this.hovered?.id === id && (this.hovered.whole || hiddenSet.has(this.hovered.node))) {
        this.setHovered(undefined);
      }
      this.measureTool.dropHidden(id, hiddenSet);
      this.features.dropHidden(id, hiddenSet);
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

  /**
   * Turns the Measure tool on or off (D79, D147); .NET decides, from the toolbar, the M key or the
   * context menu. It starts from the entity under the last right click ("Measure from here") or
   * else the last selected feature, which then leaves the feature selection.
   */
  setMeasureMode(active: boolean, fromContext = false): void {
    const reference = active ? (fromContext ? this.contextEntity : this.features.entities.at(-1)) : undefined;
    if (active) {
      this.setHovered(undefined);
      this.features.hover(undefined, undefined);
      this.features.clear();
    }
    this.measureTool.setActive(active, reference);
  }

  /** What a click selects (D146): .NET decides, from the toolbar or the keys 1, 2 and 3 (D162). */
  setSelectionMode(mode: SelectionMode): void {
    if (mode === this.selectionMode) {
      return;
    }
    this.selectionMode = mode;
    this.setHovered(undefined);
    this.features.hover(undefined, undefined);
    if (mode !== 'feature') {
      this.features.clear();
    }
  }

  /** Drops the selected features (Esc, or a switch of mode). */
  clearFeatures(): void {
    this.features.clear();
  }

  /** The Measure tool's state, for tests: whether it's on, what it would pick, the reference and the labels drawn. */
  measureState(): {
    active: boolean;
    busy: boolean;
    hovered: EntityBrief | null;
    reference: EntityBrief | null;
    result: string | null;
    labels: { role: 'reference' | 'result'; label: string }[];
  } {
    return {
      active: this.measureTool.isActive,
      busy: this.measureTool.busy,
      hovered: brief(this.measureTool.hoveredEntity),
      reference: brief(this.measureTool.referenceEntity),
      result: this.measureTool.resultLabel ?? null,
      labels: this.measureTool.labels(),
    };
  }

  /** Feature selection's state, for tests: the mode, the feature under the pointer and those selected. */
  selectionState(): { mode: SelectionMode; hoveredFeature: EntityBrief | null; features: EntityBrief[] } {
    return {
      mode: this.selectionMode,
      hoveredFeature: brief(this.features.hoveredEntity),
      features: this.features.entities.map((picked) => brief(picked)!),
    };
  }

  /** What the Measure tool would pick at a client point (for tests). */
  entityAt(clientX: number, clientY: number): EntityBrief | null {
    return brief(this.measureTool.entityAt(clientX, clientY));
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
      nameOf: (node) => entry.structure.nodes[node]?.name || '(unnamed)',
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
      this.moveTool.setCamera(this.perspective);
      void this.controls.zoomTo(1, false);
      void this.controls.dollyTo(perspectiveDistance(visibleHeight), false);
    } else {
      this.controls.camera = this.orthographic;
      this.moveTool.setCamera(this.orthographic);
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
    this.oit?.dispose();
    this.measureTool.dispose();
    this.features.dispose();
    this.moveTool.dispose();
    this.originFrames.dispose();
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

  private sceneMaterials(): SceneMaterials {
    if (!this.sortedMaterials) {
      this.sortedMaterials = sceneMaterials([...this.models.values()].map(({ object }) => object));
      this.oit?.prune(this.sortedMaterials);
    }
    return this.sortedMaterials;
  }

  /** How long a pixel is in world units at a point, in the current view. */
  private worldPerPixel(point: Vector3): number {
    const camera = this.camera;
    if (this.projectionMode === 'orthographic') {
      return this.visibleHeight() / this.height;
    }
    camera.updateMatrixWorld();
    const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    return (2 * Math.max(depth, 1e-9) * Math.tan(MathUtils.degToRad(PerspectiveFov / 2))) / this.height;
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

    if (this.originFrames.count > 0) {
      this.originFrames.scale((point) => this.worldPerPixel(point));
    }
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.clear();
    const materials = this.oit && this.oitEnabled ? this.sceneMaterials() : undefined;
    this.oitUsed = materials !== undefined && materials.translucent.size > 0;
    if (this.oitUsed) {
      const models = [...this.models.values()].map(({ object }) => object);
      this.lastFrame = this.oit!.render(this.scene, camera, models, this.overlays, materials!);
    } else {
      this.renderer.render(this.scene, camera);
      // Read before the view cube draws: the renderer's counts reset on every render call.
      const { calls, triangles, lines } = this.renderer.info.render;
      this.lastFrame = { drawCalls: calls, triangles, lines };
    }
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
    // A menu is open over the page: its keys are the menu's, and Escape closes it rather than
    // clearing the selection or ending a tool behind it.
    if (openMenu()) {
      if (event.key === 'Escape') {
        closeMenu();
      }
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey ? keyCommand(key, event.shiftKey, true) : keyCommand(key, event.shiftKey, false);
    if ((command === 'copy' || command === 'cut') && !(window.getSelection()?.isCollapsed ?? true)) {
      return; // text selected on the page: the browser's own copy
    }
    if (command === 'fit') {
      this.fitAll();
    } else if (command) {
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

  /** The part under the pointer, faintly highlighted (D89); in Model mode, its whole model (D146). */
  private setHovered(part: PartRef | undefined): void {
    const whole = this.selectionMode === 'model';
    if (part?.id === this.hovered?.id && (part === undefined || (whole && this.hovered?.whole) || (!whole && part.node === this.hovered?.node))) {
      return;
    }
    if (this.hovered?.highlight) {
      this.overlays.remove(this.hovered.highlight.object);
      this.hovered.highlight.dispose();
    }
    const entry = part && this.models.get(part.id);
    const nodes = entry && part ? (whole ? entry.parts.partNodes.filter((node) => !entry.hidden.has(node)) : [part.node]) : [];
    const highlight = entry && nodes.length > 0 ? entry.parts.highlight(nodes, 'hovered' satisfies HighlightKind, this.highlights) : undefined;
    if (highlight) {
      this.overlays.add(highlight.object);
    }
    this.hovered = part && { ...part, whole, highlight };
    this.renderer.domElement.style.cursor = part ? 'pointer' : '';
    this.requestRender();
  }

  /**
   * Hover pre-highlights the part under the pointer, with at most one pick per animation frame
   * (D89); a click that didn't drag picks a part, or empty space (D77). Pressing on the view cube
   * never gets here (see {@link installViewCubeInput}).
   */
  private installPartInput(canvas: HTMLCanvasElement): void {
    let press: { id: number; button: number; x: number; y: number } | undefined;
    this.listen(canvas, 'pointerdown', (event) => {
      press = event.button === 0 || event.button === 2 ? { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY } : undefined;
      this.hoverPoint = undefined;
      this.setHovered(undefined);
    });
    this.listen(canvas, 'pointerup', (event) => {
      const start = press;
      press = undefined;
      if (
        !start ||
        this.handlePress ||
        start.id !== event.pointerId ||
        start.button !== event.button ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > ClickTolerance ||
        this.viewCubeRegionAt(event.clientX, event.clientY) !== undefined
      ) {
        return;
      }
      const additive = event.ctrlKey || event.metaKey;
      if (start.button === 2) {
        this.openContextMenu(event.clientX, event.clientY);
      } else if (this.measureTool.isActive) {
        void this.measureTool.click(event.clientX, event.clientY);
      } else if (this.selectionMode === 'feature') {
        this.features.click(event.clientX, event.clientY, additive);
      } else {
        this.options.onPick?.(this.pickPart(event.clientX, event.clientY), additive);
      }
    });
    this.listen(canvas, 'pointermove', (event) => {
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || this.interacting || this.moveTool.isDragging) {
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
          } else if (this.selectionMode === 'feature') {
            this.features.hover(over?.x, over?.y);
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
      this.features.hover(undefined, undefined);
    });
  }

  /**
   * A right click that didn't drag (D164): .NET opens the menu and selects the part, if it isn't
   * selected; in Feature mode the feature under the pointer is selected here. The entity under it
   * is kept for "Measure from here".
   */
  private openContextMenu(x: number, y: number): void {
    this.contextEntity = this.measureTool.entityAt(x, y);
    if (this.selectionMode === 'feature' && !this.measureTool.isActive) {
      const feature = this.features.featureAt(x, y);
      if (feature && !this.features.has(feature)) {
        this.features.select(feature, false);
      }
    }
    this.options.onContextMenu?.({ x, y, part: this.pickPart(x, y), canMeasure: this.contextEntity !== undefined });
  }

  /**
   * Clicks on the view cube turn the view; they must not also start a camera-controls drag, so the
   * host intercepts them in the capture phase, before they reach the canvas.
   */
  /**
   * A press on the triad's handles drags it, not the camera, and isn't a click on a part (R26): the
   * host sees it first, in the capture phase, and pauses camera-controls until the drag ends.
   */
  private installMoveInput(canvas: HTMLCanvasElement): void {
    this.listen(
      this.host,
      'pointerdown',
      (event) => {
        this.handlePress = event.target === canvas && event.button === 0 && this.moveTool.handleAt(event.clientX, event.clientY) !== null;
        this.moveTool.setSnapping(event.ctrlKey || event.metaKey);
        if (this.handlePress) {
          this.controls.enabled = false;
        }
      },
      { capture: true },
    );
    this.listen(canvas, 'pointerup', () => {
      if (this.handlePress && !this.moveTool.isDragging) {
        this.controls.enabled = true;
      }
    });
    // Ctrl snaps (D168), as each pointer event says, before TransformControls reads it on the canvas.
    this.listen(this.host, 'pointermove', (event) => this.moveTool.setSnapping(event.ctrlKey || event.metaKey), { capture: true });
  }

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

/**
 * D99's keys: `F` fits; Esc, H, I, Shift+H, M, Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z), 1, 2 and 3 (D162),
 * W, E and O (M13, D166, D171), and Ctrl+X, Ctrl+C, Ctrl+V, Delete, Ctrl+G, Ctrl+Shift+G and F2 (M14,
 * D152, D183) go to .NET.
 */
export function keyCommand(key: string, shift: boolean, control: boolean): ViewerCommand | 'fit' | undefined {
  if (control) {
    switch (key) {
      case 'z':
        return shift ? 'redo' : 'undo';
      case 'y':
        return 'redo';
      case 'x':
        return shift ? undefined : 'cut';
      case 'c':
        return shift ? undefined : 'copy';
      case 'v':
        return shift ? undefined : 'paste';
      case 'g':
        return shift ? 'ungroup' : 'group';
      default:
        return undefined;
    }
  }
  switch (key) {
    case 'delete':
      return 'delete';
    case 'f2':
      return 'rename';
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
    case '1':
      return 'selectModels';
    case '2':
      return 'selectObjects';
    case '3':
      return 'selectFeatures';
    case 'w':
      return shift ? undefined : 'moveTranslate';
    case 'e':
      return shift ? undefined : 'moveRotate';
    case 'o':
      return shift ? undefined : 'originFrames';
    default:
      return undefined;
  }
}

/** An entity, briefly, for tests. */
export interface EntityBrief {
  id: string;
  kind: string;
  node: number;
  index: number;
}

function brief(picked: Picked | undefined): EntityBrief | null {
  return picked
    ? { id: picked.id, kind: picked.entity.kind, node: picked.entity.node, index: picked.entity.kind === 'point' ? -1 : picked.entity.ref.index }
    : null;
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

/**
 * A menu open in the page's popover layer (the page's UI library draws menus there, with an overlay that
 * closes them when it's clicked). Tooltips use the same layer, so only a list counts.
 */
function openMenu(): Element | null {
  return document.querySelector('.mud-popover-open .mud-list');
}

/** Closes the open menu as a click beside it would. */
function closeMenu(): void {
  const overlay = document.querySelector('.mud-overlay');
  if (overlay instanceof HTMLElement) {
    overlay.click();
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  );
}
