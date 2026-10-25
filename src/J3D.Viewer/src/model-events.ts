import type { ModelEdits } from './edit/structure';
import type { ModelManager } from './import/model-manager';
import type { Bounds, ModelStats, TreeNode } from './import/types';
import type { DotNetObjectReference } from './interop';

/**
 * A model's tree as one array per field, parents before children (mirrors TreeColumns in
 * J3D.Web.Client/Interop/ModelLoadedInfo.cs). .NET reads three arrays far faster than an object per
 * node: a 10,437-node tree took 850 ms as objects (decision D63).
 */
export interface TreeColumns {
  names: string[];
  parents: number[];
  prototypes: number[];
}

/** What .NET is told about a loaded model (mirrors J3D.Web.Client/Interop/ModelLoadedInfo.cs). */
export interface ModelLoadedInfo {
  /** The tree as the file gives it; `edits` change it. */
  tree: TreeColumns;
  /** A restored model's kept edits (M14), already applied in the view; null when it has none. */
  edits: ModelEdits | null;
  stats: ModelStats;
  bounds: Bounds;
  memoryBytes: number;
  warnings: string[];
}

/**
 * Relays the model manager's events to the Blazor `Viewport` (docs/plan.md §6.4). Only small DTOs
 * cross into .NET: summaries, progress, a loaded model's tree and stats, errors and rejections.
 * Reading a large tree takes .NET a while (about 140 ms for 10,000 nodes), so `OnModelLoaded` runs in
 * a task of its own, after the viewer has added the model, rather than lengthening that task (D63).
 * Calls made meanwhile wait behind it, so .NET still sees each model's events in order. Returns the
 * unsubscribe function, which also drops any calls still waiting.
 */
export function forwardModelEvents(models: Pick<ModelManager, 'subscribe'>, dotnet: DotNetObjectReference): () => void {
  let waiting: (() => void)[] | null = null;
  const call = (method: string, args: unknown[]) => () => {
    dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
  };
  const send = (method: string, ...args: unknown[]) => {
    if (waiting) {
      waiting.push(call(method, args));
    } else {
      call(method, args)();
    }
  };
  const sendInOwnTask = (method: string, ...args: unknown[]) => {
    if (!waiting) {
      const calls: (() => void)[] = [];
      waiting = calls;
      setTimeout(() => {
        if (waiting === calls) {
          waiting = null;
          calls.forEach((run) => run());
        }
      }, 0);
    }
    waiting.push(call(method, args));
  };

  const unsubscribe = models.subscribe({
    queued: (summary) => send('OnModelQueued', summary),
    progress: (id, phase, fraction) => send('OnModelProgress', id, phase, fraction),
    loaded: ({ summary, tree, stats, bounds, memoryBytes, warnings, restored }) => {
      const info: ModelLoadedInfo = { tree: toColumns(tree), edits: restored?.edits ?? null, stats, bounds, memoryBytes, warnings };
      sendInOwnTask('OnModelLoaded', summary.id, info);
    },
    failed: (id, error) => send('OnModelFailed', id, error),
    removed: (id) => send('OnModelRemoved', id),
    rejected: (fileName, reason) => send('OnImportRejected', fileName, reason),
  });
  return () => {
    unsubscribe();
    waiting = null;
  };
}

/** The tree as .NET receives it. */
export function toColumns(tree: readonly TreeNode[]): TreeColumns {
  return {
    names: tree.map((node) => node.name),
    parents: tree.map((node) => node.parent),
    prototypes: tree.map((node) => node.prototype),
  };
}
