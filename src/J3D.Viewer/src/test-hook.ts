// Development-only hook for the Playwright tests (docs/plan.md §6.3). It records model events,
// exposes the model list (whose UI arrives in M4) and reports the camera and rendering state.

import type { ModelEntry, ModelManager } from './import/model-manager';
import { liveWorkers } from './import/runner';
import type { Bounds, ImportError, ImportPhase, ModelStats, TreeNode } from './import/types';
import type { ModelStore } from './store/model-store';
import { findRegion } from './view/view-regions';
import type { CameraState, PartRef, RenderStats, Viewer } from './view/viewer';

/** Present only when the host renders `<meta name="j3d-test-hook">` (the Development environment). */
export function isTestHookEnabled(): boolean {
  return document.querySelector('meta[name="j3d-test-hook"]') !== null;
}

export type TestEvent =
  | { type: 'queued'; id: string; fileName: string }
  | { type: 'progress'; id: string; phase: ImportPhase; fraction: number | null }
  | { type: 'loaded'; id: string }
  | { type: 'failed'; id: string; error: ImportError }
  | { type: 'removed'; id: string }
  | { type: 'rejected'; fileName: string; reason: string }
  | { type: 'held'; fileName: string };

/** A JSON-friendly view of a model for assertions. */
export interface TestModel {
  id: string;
  fileName: string;
  format: string;
  kind: string;
  status: string;
  phase?: ImportPhase;
  error?: ImportError;
  stats?: ModelStats;
  bounds?: Bounds;
  tree?: TreeNode[];
  warnings?: string[];
  memoryBytes?: number;
  /** Mesh models: names of the texture maps found on the materials. */
  textureMaps?: string[];
}

export interface TestHook {
  readonly events: TestEvent[];
  readonly input: HTMLInputElement;
  /** Hold OCCT imports after instantiation until they are cancelled. */
  holdImports: boolean;
  models(): TestModel[];
  remove(id: string): boolean;
  liveWorkers(): number;
  /** False when the browser has no WebGL2, so nothing is drawn. */
  readonly rendering: boolean;
  /** The camera, or null without WebGL2. */
  camera(): CameraState | null;
  /** Frames drawn so far: rendering is on demand, so this stays still while nothing changes. */
  frames(): number;
  /** Where a view cube region (e.g. `top-front-right`) is on screen, or null when it faces away. */
  viewCubePoint(region: string): { x: number; y: number } | null;
  /** The highlighted view cube region, if any. */
  hoveredRegion(): string | null;
  /** Where a world point is on screen (client coordinates), or null without WebGL2. */
  project(point: [number, number, number]): { x: number; y: number } | null;
  /** Whether the browser has taken the renderer's WebGL context away (null without WebGL2). */
  contextLost(): boolean | null;
  /** The models the viewer has in its scene, with their object counts. */
  scene(): { id: string; name: string; objects: number; visible: boolean }[];
  /** Draws a frame and reads its RGBA under client points: what the canvas draws, whatever a screenshot shows. */
  canvasPixels(points: [number, number][]): (number[] | null)[];
  /** The last frame's scene draw calls and primitives and the GPU objects held, or null without WebGL2. */
  renderStats(): RenderStats | null;
  /** Ends any camera transition at once and draws, where animation frames don't run (a hidden page). */
  settleCamera(): void;
  /** The visible part under a client point, or null (M6). */
  partAt(x: number, y: number): PartRef | null;
  /** A client point where a part can be clicked, or null when it's hidden or covered (M6). */
  partPoint(id: string, node: number): { x: number; y: number } | null;
  /** The hovered part, or null. */
  hoveredPart(): PartRef | null;
  /** What the viewer has applied to a model: its parts, hidden parts and highlighted selection. */
  partState(id: string): { parts: number[]; hidden: number[]; selected: number[] } | null;
  /** Pick timings since the last call (D89): the last pick, how many, and the longest. */
  pickTimes(): { milliseconds: number; count: number; longest: number } | null;
  /**
   * Applies hidden and selected parts straight to the viewer and returns how long that took in ms,
   * for measuring large selections (D89). .NET doesn't hear of it, so restore the state after.
   */
  timePartState(id: string, hidden: number[], selected: number[]): number | null;
  /** The Measure tool's state (M7), or null without WebGL2. */
  measureState(): ReturnType<Viewer['measureState']> | null;
  /** What the Measure tool would pick at a client point. */
  entityAt(x: number, y: number): ReturnType<Viewer['entityAt']>;
  /** What the store keeps (M8): this tab's status, the kept models, the order .NET gave and the camera. */
  store(): ModelStore['state'];
  /** Resolves once the store has written everything asked of it so far, the manifest included. */
  storeIdle(): Promise<void>;
}

export interface TestHookControls {
  /** Read by the OCCT runner for each new import. */
  holdImports(): boolean;
  /** Called by the OCCT runner when a held import is waiting. */
  onHeld(fileName: string): void;
}

declare global {
  interface Window {
    __j3dTest?: TestHook;
  }
}

/** Creates the controls first, since the runners need them before the manager exists. */
export function createTestHookControls(): TestHookControls & { hook?: TestHook } {
  const controls: TestHookControls & { hook?: TestHook } = {
    holdImports: () => controls.hook?.holdImports ?? false,
    onHeld: (fileName) => controls.hook?.events.push({ type: 'held', fileName }),
  };
  return controls;
}

export function installTestHook(
  manager: ModelManager,
  controls: ReturnType<typeof createTestHookControls>,
  attachFileInput: (input: HTMLInputElement) => () => void,
  viewer: Viewer | undefined,
  store: ModelStore,
): () => void {
  const events: TestEvent[] = [];
  const unsubscribe = manager.subscribe({
    queued: ({ id, fileName }) => events.push({ type: 'queued', id, fileName }),
    progress: (id, phase, fraction) => events.push({ type: 'progress', id, phase, fraction }),
    loaded: ({ summary }) => events.push({ type: 'loaded', id: summary.id }),
    failed: (id, error) => events.push({ type: 'failed', id, error }),
    removed: (id) => events.push({ type: 'removed', id }),
    rejected: (fileName, reason) => events.push({ type: 'rejected', fileName, reason }),
  });

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.dataset['testid'] = 'j3d-test-input';
  document.body.append(input);
  const detachInput = attachFileInput(input);

  const hook: TestHook = {
    events,
    input,
    holdImports: false,
    models: () => manager.models.map(toTestModel),
    remove: (id) => manager.remove(id),
    liveWorkers: () => liveWorkers.count,
    rendering: viewer !== undefined,
    camera: () => viewer?.cameraState() ?? null,
    frames: () => viewer?.frameCount ?? 0,
    viewCubePoint: (id) => {
      const region = findRegion(id);
      return (region && viewer?.viewCubePointOf(region)) ?? null;
    },
    hoveredRegion: () => viewer?.hoveredRegion?.id ?? null,
    project: (point) => viewer?.projectToClient(point) ?? null,
    contextLost: () => viewer?.renderer.getContext().isContextLost() ?? null,
    scene: () => viewer?.sceneSummary() ?? [],
    canvasPixels: (points) => viewer?.pixelsAt(points).map((pixel) => pixel ?? null) ?? points.map(() => null),
    renderStats: () => viewer?.renderStats ?? null,
    settleCamera: () => viewer?.settleCamera(),
    partAt: (x, y) => viewer?.pickPart(x, y) ?? null,
    partPoint: (id, node) => viewer?.partPoint(id, node) ?? null,
    hoveredPart: () => viewer?.hoveredPart ?? null,
    partState: (id) => viewer?.partState(id) ?? null,
    pickTimes: () => viewer?.takePickTimes() ?? null,
    measureState: () => viewer?.measureState() ?? null,
    entityAt: (x, y) => viewer?.entityAt(x, y) ?? null,
    store: () => store.state,
    storeIdle: () => store.idle(),
    timePartState: (id, hidden, selected) => {
      if (!viewer) return null;
      const start = performance.now();
      viewer.setPartState(id, hidden, selected);
      return performance.now() - start;
    },
  };
  controls.hook = hook;
  window.__j3dTest = hook;

  return () => {
    unsubscribe();
    detachInput();
    input.remove();
    delete controls.hook;
    delete window.__j3dTest;
  };
}

function toTestModel(entry: ModelEntry): TestModel {
  const { summary, status, phase, error, model } = entry;
  const result: TestModel = { ...summary, status };
  if (phase) result.phase = phase;
  if (error) result.error = error;
  if (model) {
    result.stats = model.stats;
    result.bounds = model.bounds;
    result.tree = model.tree;
    result.warnings = model.warnings;
    result.memoryBytes = model.memoryBytes;
    if (model.content.kind === 'mesh') {
      const maps = new Set<string>();
      model.content.root.traverse((object) => {
        const material = (object as { material?: unknown }).material;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          for (const [key, value] of Object.entries(m as object)) {
            if ((value as { isTexture?: boolean } | null)?.isTexture) maps.add(key);
          }
        }
      });
      result.textureMaps = [...maps].sort();
    }
  }
  return result;
}

