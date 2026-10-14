// Development-only hook for the Playwright tests (docs/plan.md §6.3). It records model events and
// exposes the model list, because iteration 1's UI for both arrives in later milestones.

import type { ModelEntry, ModelManager } from './import/model-manager';
import { liveWorkers } from './import/runner';
import type { Bounds, ImportError, ImportPhase, ModelStats, TreeNode } from './import/types';

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

